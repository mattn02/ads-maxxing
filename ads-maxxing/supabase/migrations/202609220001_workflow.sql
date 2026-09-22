-- Exactly five application entities. All mutations are server-only; browser roles read through RLS.
create table public.brands (
 id uuid primary key, user_id uuid not null references auth.users(id), normalized_hostname text not null,
 name text not null, brand_kit_schema_version integer not null default 1, brand_kit jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id, normalized_hostname), unique(id,user_id)
);
create table public.research_snapshots (
 id uuid primary key, user_id uuid not null references auth.users(id), brand_id uuid not null,
 schema_version integer not null check(schema_version>0), data jsonb not null,
 created_at timestamptz not null default now(), unique(id,user_id), unique(id,user_id,brand_id),
 foreign key(brand_id,user_id) references public.brands(id,user_id)
);
create table public.campaigns (
 id uuid primary key, user_id uuid not null references auth.users(id), brand_id uuid,
 name text not null default 'New session', status text not null default 'active' check(status in ('active','archived')),
 current_research_id uuid, current_version_id uuid, preferences jsonb not null default '{}', messages jsonb not null default '[]',
 events jsonb not null default '[]', workflow_state jsonb, last_error text,
 revision integer not null default 0, lease_token uuid, lease_expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id), foreign key(brand_id,user_id) references public.brands(id,user_id),
 foreign key(current_research_id,user_id,brand_id) references public.research_snapshots(id,user_id,brand_id),
 check(jsonb_typeof(messages)='array'), check(jsonb_typeof(events)='array')
);
create table public.assets (
 id uuid primary key, user_id uuid not null references auth.users(id), brand_id uuid not null, campaign_id uuid,
 kind text not null check(kind in ('product_photo','logo','generated_visual','generated_background','generated_scene','composed_ad')),
 source_url text, source_research_id uuid, bucket text not null default 'creative-assets', storage_path text not null,
 storage_state text not null default 'pending' check(storage_state in ('pending','ready','failed')), storage_error text,
 mime_type text, width integer, height integer, byte_size integer, content_hash text, metadata jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id), unique(bucket,storage_path),
 foreign key(brand_id,user_id) references public.brands(id,user_id),
 foreign key(campaign_id,user_id) references public.campaigns(id,user_id),
 foreign key(source_research_id,user_id,brand_id) references public.research_snapshots(id,user_id,brand_id)
);
create table public.ad_versions (
 id uuid primary key, user_id uuid not null references auth.users(id), campaign_id uuid not null, research_snapshot_id uuid not null,
 parent_version_id uuid, reference_asset_id uuid, background_asset_id uuid, scene_asset_id uuid, visual_asset_id uuid, final_asset_id uuid,
 brief jsonb not null, generation jsonb,
 brief_approved_at timestamptz, approved_at timestamptz,
 generation_state text not null default 'not_started' check(generation_state in ('not_started','submitted','outcome_unknown','failed','output_pending_storage','visual_ready','complete')),
 review_status text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), generated_at timestamptz,
 unique(id,user_id), unique(id,campaign_id,user_id),
 foreign key(campaign_id,user_id) references public.campaigns(id,user_id),
 foreign key(research_snapshot_id,user_id) references public.research_snapshots(id,user_id),
 foreign key(parent_version_id,campaign_id,user_id) references public.ad_versions(id,campaign_id,user_id),
 foreign key(reference_asset_id,user_id) references public.assets(id,user_id),
 foreign key(background_asset_id,user_id) references public.assets(id,user_id),
 foreign key(scene_asset_id,user_id) references public.assets(id,user_id),
 foreign key(visual_asset_id,user_id) references public.assets(id,user_id),
 foreign key(final_asset_id,user_id) references public.assets(id,user_id)
);
alter table public.campaigns add foreign key(current_version_id,id,user_id) references public.ad_versions(id,campaign_id,user_id);
create index campaigns_owner_updated on public.campaigns(user_id,updated_at desc);
create index snapshots_brand_created on public.research_snapshots(brand_id,created_at);
create index versions_campaign_created on public.ad_versions(campaign_id,created_at);
create index versions_parent on public.ad_versions(parent_version_id);
create index assets_campaign on public.assets(campaign_id);
create index assets_source on public.assets(source_research_id);
create index assets_brand on public.assets(brand_id);

do $$ declare t text; begin
 foreach t in array array['brands','research_snapshots','campaigns','ad_versions','assets'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy owner_read on public.%I for select to authenticated using (user_id=(select auth.uid()))',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('creative-assets','creative-assets',false,20971520,array['image/png','image/jpeg','image/webp','image/gif']) on conflict(id) do nothing;
create policy creative_owner_read on storage.objects for select to authenticated using (
 bucket_id='creative-assets' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.assets a where a.bucket=bucket_id and a.storage_path=name and a.user_id=(select auth.uid()) and a.storage_state='ready')
);

create function public.create_campaign(p_owner uuid,p_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into campaigns(id,user_id) values(p_id,p_owner); end $$;
create function public.claim_campaign(p_owner uuid,p_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result campaigns; token uuid:=gen_random_uuid(); begin
 update campaigns set lease_token=token,lease_expires_at=clock_timestamp()+interval '6 minutes'
 where id=p_id and user_id=p_owner and (lease_token is null or lease_expires_at<clock_timestamp()) returning * into result;
 if not found then raise exception 'WORKFLOW:Campaign unavailable or busy. Wait for the current turn to finish.'; end if;
 update ad_versions set generation_state='outcome_unknown' where campaign_id=p_id and user_id=p_owner and generation_state='submitted';
 return jsonb_build_object('token',token,'revision',result.revision);
end $$;
create function public.release_campaign(p_owner uuid,p_id uuid,p_token uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin update campaigns set lease_token=null,lease_expires_at=null where id=p_id and user_id=p_owner and lease_token=p_token; end $$;
create function public.assert_lease(p_owner uuid,p_id uuid,p_token uuid,p_revision integer) returns public.campaigns language plpgsql security definer set search_path=public,pg_temp as $$
declare c campaigns; begin
 select * into c from campaigns where id=p_id and user_id=p_owner for update;
 if not found or c.lease_token is distinct from p_token or c.lease_expires_at<=clock_timestamp() or c.revision<>p_revision then
 raise exception 'WORKFLOW:Campaign lease expired or revision changed. Reload before continuing; no further provider request was made.'; end if;
 return c;
end $$;
create function public.assert_asset(p_owner uuid,p_brand uuid,p_campaign uuid,p_asset uuid,p_kind text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_asset is null or not exists(select 1 from assets where id=p_asset and user_id=p_owner and brand_id=p_brand and (campaign_id is null or campaign_id=p_campaign) and storage_state='ready' and kind=p_kind) then
 raise exception 'WORKFLOW:Asset is missing, unready, or outside this campaign.'; end if;
end $$;

-- Content is immutable per version; only fixed execution/review metadata may change.
create function public.brief_content(b jsonb) returns jsonb language sql immutable as $$
 select b - array['approvedAt','generationAttemptedAt','visualCheckpoint','backgroundCheckpoint','sceneCheckpoint','generationError'];
$$;
create function public.commit_campaign(p_owner uuid,p_id uuid,p_token uuid,p_revision integer,p_session jsonb,p_hostname text,p_schema_version integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c campaigns; b brands; r jsonb; rr jsonb; item jsonb; v jsonb; prior ad_versions; rid uuid; vid uuid; parent uuid; source uuid; bg uuid; scene uuid; final_id uuid; stage text; old_stage jsonb; new_stage jsonb; generation_state_value text;
begin
 c:=assert_lease(p_owner,p_id,p_token,p_revision);
 r:=p_session->'research';
 if r is not null and r<>'null'::jsonb then
  if p_schema_version not in (1,2) then raise exception 'WORKFLOW:Unsupported research schema.'; end if;
  select * into b from brands where user_id=p_owner and normalized_hostname=p_hostname;
  if not found then insert into brands(id,user_id,normalized_hostname,name,brand_kit_schema_version,brand_kit)
   values(gen_random_uuid(),p_owner,p_hostname,coalesce(r#>>'{brandKit,name}',r#>>'{sources,0,title}',p_hostname),p_schema_version,coalesce(r->'brandKit','{}')) returning * into b; end if;
  if c.brand_id is not null and c.brand_id<>b.id then raise exception 'WORKFLOW:Start a new campaign for a different store.'; end if;
  if r->'brandKit' is not null then update brands set brand_kit=r->'brandKit',brand_kit_schema_version=p_schema_version,updated_at=now() where id=b.id; end if;
  c.brand_id:=b.id; rid:=(r->>'id')::uuid;
  rr:=r-'schemaVersion';
  if exists(select 1 from research_snapshots where id=rid) then
   if not exists(select 1 from research_snapshots where id=rid and user_id=p_owner and brand_id=b.id and schema_version=p_schema_version and data=rr) then raise exception 'WORKFLOW:Research snapshots are immutable. Save refreshed research under a new ID.'; end if;
  else insert into research_snapshots(id,user_id,brand_id,schema_version,data) values(rid,p_owner,b.id,p_schema_version,rr); end if;
 end if;
 -- Historical variants and current brief share version rows. Never independently upsert a stale session.
 for item in select value from jsonb_array_elements(coalesce(p_session->'variants','[]')) union all
  select jsonb_build_object('brief',p_session->'brief') where p_session->'brief' is not null and p_session->'brief'<>'null'::jsonb
 loop
  v:=item->'brief'; vid:=(v->>'id')::uuid; parent:=nullif(v->>'parentVariantId','')::uuid; source:=nullif(v->>'sourceAssetId','')::uuid;
  if not exists(select 1 from research_snapshots where id=(v->>'researchId')::uuid and user_id=p_owner and brand_id=c.brand_id) then raise exception 'WORKFLOW:Version research must belong to the campaign brand.'; end if;
  if v->>'saleId' is not null and not exists(select 1 from research_snapshots s,jsonb_array_elements(s.data->'sales') sale where s.id=(v->>'researchId')::uuid and sale->>'id'=v->>'saleId') then raise exception 'WORKFLOW:Offer does not belong to this research snapshot.'; end if;
  select * into prior from ad_versions where id=vid;
  if found then
   if prior.user_id<>p_owner or prior.campaign_id<>p_id or brief_content(prior.brief)<>brief_content(v) then raise exception 'WORKFLOW:Saved creative content is immutable. Create a new brief revision.'; end if;
  elsif parent is not null and not exists(select 1 from ad_versions where id=parent and campaign_id=p_id and user_id=p_owner and generation_state='complete') then raise exception 'WORKFLOW:Parent must be a completed version in this campaign.'; end if;
  if v->>'approvedAt' is not null and not (coalesce((v->>'legacyImported')::boolean,false) and exists(select 1 from assets where id=vid and user_id=p_owner and campaign_id=p_id and kind='composed_ad' and storage_state='ready')) then
   perform assert_asset(p_owner,c.brand_id,p_id,source,'product_photo');
   if prior.brief_approved_at is null and ((v->>'researchId')::uuid is distinct from rid or vid is distinct from (p_session#>>'{brief,id}')::uuid) then raise exception 'WORKFLOW:Only the current brief can be approved.'; end if;
  end if;
  foreach stage in array array['backgroundCheckpoint','sceneCheckpoint'] loop
   new_stage:=v->stage; old_stage:=prior.brief->stage;
   if old_stage->>'attemptedAt' is not null and (new_stage->>'attemptedAt') is distinct from (old_stage->>'attemptedAt') then raise exception 'WORKFLOW:An attempted paid stage cannot be reset or resubmitted.'; end if;
   if old_stage->>'state'='output_pending_storage' and new_stage->>'state' not in ('output_pending_storage','saved') then raise exception 'WORKFLOW:Recover the recorded provider result without another paid submission.'; end if;
   if old_stage->>'state'='saved' and new_stage is distinct from old_stage then raise exception 'WORKFLOW:A saved stage checkpoint is immutable.'; end if;
   if new_stage->>'state'='attempted' and old_stage->>'attemptedAt' is null then
    if v->>'approvedAt' is null or vid is distinct from (p_session#>>'{brief,id}')::uuid or (v->>'researchId')::uuid is distinct from rid then raise exception 'WORKFLOW:Approve the current brief before paid generation.'; end if;
    perform assert_asset(p_owner,c.brand_id,p_id,source,'product_photo');
    if c.preferences is distinct from coalesce(p_session->'preferences','{}') then raise exception 'WORKFLOW:Preference changes require a new brief approval.'; end if;
   end if;
   if new_stage->>'state'='output_pending_storage' and old_stage->>'attemptedAt' is null then raise exception 'WORKFLOW:Persist the paid attempt before its provider result.'; end if;
  end loop;
  bg:=nullif(coalesce(v#>>'{backgroundCheckpoint,asset,id}',case when v#>>'{executionPlan,background,action}'='reuse' then v#>>'{executionPlan,background,assetId}' end),'')::uuid; scene:=nullif(coalesce(v#>>'{sceneCheckpoint,asset,id}',case when v#>>'{executionPlan,scene,action}'='reuse' then v#>>'{executionPlan,scene,assetId}' end),'')::uuid;
  if bg is not null then perform assert_asset(p_owner,c.brand_id,p_id,bg,'generated_background'); end if;
  if scene is not null then perform assert_asset(p_owner,c.brand_id,p_id,scene,'generated_scene'); end if;
  final_id:=prior.final_asset_id;
  if item->>'imageUrl' is not null then
   select id into final_id from assets where user_id=p_owner and campaign_id=p_id and kind='composed_ad' and metadata->>'versionId'=vid::text and storage_state='ready';
   perform assert_asset(p_owner,c.brand_id,p_id,final_id,'composed_ad');
  end if;
  generation_state_value:=case when final_id is not null then 'complete' when scene is not null then 'visual_ready'
    when v#>>'{sceneCheckpoint,state}'='output_pending_storage' or v#>>'{backgroundCheckpoint,state}'='output_pending_storage' then 'output_pending_storage'
    when v#>>'{sceneCheckpoint,state}'='attempted' or v#>>'{backgroundCheckpoint,state}'='attempted' or v->>'generationAttemptedAt' is not null then 'submitted' else 'not_started' end;
  if item->>'status'='approved' and item#>>'{review,verdict}' is distinct from 'pass' then raise exception 'WORKFLOW:Only a passing reviewed ad can be approved.'; end if;
  insert into ad_versions(id,user_id,campaign_id,research_snapshot_id,parent_version_id,reference_asset_id,background_asset_id,scene_asset_id,final_asset_id,brief,generation,brief_approved_at,approved_at,generation_state,review_status,generated_at)
   values(vid,p_owner,p_id,(v->>'researchId')::uuid,parent,source,bg,scene,final_id,v,case when item->>'imageUrl' is not null then item-array['brief','research'] else null end,(v->>'approvedAt')::timestamptz,case when item->>'status'='approved' then now() end,generation_state_value,item->>'status',case when final_id is not null then now() end)
  on conflict(id) do update set brief=excluded.brief,background_asset_id=excluded.background_asset_id,scene_asset_id=excluded.scene_asset_id,final_asset_id=coalesce(excluded.final_asset_id,ad_versions.final_asset_id),generation=coalesce(excluded.generation,ad_versions.generation),brief_approved_at=excluded.brief_approved_at,approved_at=case when excluded.generation is not null then excluded.approved_at else ad_versions.approved_at end,generation_state=excluded.generation_state,review_status=coalesce(excluded.review_status,ad_versions.review_status),generated_at=coalesce(ad_versions.generated_at,excluded.generated_at),updated_at=now();
 end loop;
 if (c.preferences is distinct from coalesce(p_session->'preferences','{}') or c.current_research_id is distinct from rid) and p_session#>>'{brief,approvedAt}' is not null and exists(select 1 from ad_versions where id=(p_session#>>'{brief,id}')::uuid and generation_state<>'complete') then raise exception 'WORKFLOW:Changed research or preferences invalidates pending approval.'; end if;
 update campaigns set brand_id=c.brand_id,name=coalesce(r#>>'{brandKit,name}',r#>>'{sources,0,title}',name),current_research_id=rid,current_version_id=(p_session#>>'{brief,id}')::uuid,preferences=coalesce(p_session->'preferences','{}'),messages=coalesce(p_session->'messages','[]'),events=coalesce(p_session->'events','[]'),workflow_state=p_session->'researchState',last_error=p_session->>'lastError',revision=revision+1,updated_at=now() where id=p_id;
 return jsonb_build_object('revision',p_revision+1,'brand_id',c.brand_id);
end $$;

-- Register pending bytes and finish upload under the same lease protocol as workflow changes.
create function public.register_asset(p_owner uuid,p_id uuid,p_token uuid,p_revision integer,p_asset jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c campaigns; a assets; aid uuid:=(p_asset->>'id')::uuid; begin
 c:=assert_lease(p_owner,p_id,p_token,p_revision);
 if c.brand_id is null then raise exception 'WORKFLOW:Save brand research before capturing assets.'; end if;
 select * into a from assets where id=aid;
 if found then
  if a.user_id<>p_owner or a.brand_id<>c.brand_id or a.campaign_id is distinct from p_id or a.kind<>p_asset->>'kind' or a.storage_path<>p_asset->>'storage_path' then raise exception 'WORKFLOW:Conflicting asset registration.'; end if;
  if a.storage_state='ready' and (coalesce(p_asset->>'storage_state','pending')<>'ready' or a.metadata is distinct from coalesce(p_asset->'metadata','{}') or a.content_hash is distinct from p_asset->>'content_hash' or a.byte_size is distinct from (p_asset->>'byte_size')::integer) then raise exception 'WORKFLOW:Ready asset bytes are immutable.'; end if;
 else
  insert into assets(id,user_id,brand_id,campaign_id,kind,source_url,source_research_id,storage_path,metadata)
   values(aid,p_owner,c.brand_id,p_id,p_asset->>'kind',p_asset->>'source_url',(p_asset->>'source_research_id')::uuid,p_asset->>'storage_path',coalesce(p_asset->'metadata','{}'));
 end if;
 update assets set storage_state=coalesce(p_asset->>'storage_state','pending'),content_hash=p_asset->>'content_hash',mime_type=p_asset->>'mime_type',width=(p_asset->>'width')::integer,height=(p_asset->>'height')::integer,byte_size=(p_asset->>'byte_size')::integer,updated_at=now() where id=aid;
 update campaigns set revision=revision+1 where id=p_id;
 return jsonb_build_object('revision',p_revision+1);
end $$;
-- No client role can execute protected transitions, including helpers.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_campaign','claim_campaign','release_campaign','assert_lease','assert_asset','brief_content','commit_campaign','register_asset') loop
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
