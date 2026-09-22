begin;

-- New onboarding lifecycle. Existing demo rows are retained without legacy backfill.
alter table public.campaigns add column purpose text not null default 'campaign' check(purpose in ('brand_setup','campaign'));
alter table public.campaigns add column setup_state jsonb;
alter table public.campaigns add column creation_key uuid;
create unique index campaign_creation_key on public.campaigns(user_id,creation_key);
create unique index brand_setup_draft on public.campaigns(user_id,brand_id) where purpose='brand_setup';
alter table public.brands add column completed_context_id uuid;
alter table public.brands add column context_revision integer not null default 0;
alter table public.brands add foreign key(completed_context_id,user_id,id) references public.research_snapshots(id,user_id,brand_id);

create or replace function public.commit_campaign(p_owner uuid,p_id uuid,p_token uuid,p_revision integer,p_session jsonb,p_hostname text,p_schema_version integer) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
  -- Campaign writes never mutate the shared brand context.
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
  if v->>'logoSourceAssetId' is not null then perform assert_asset(p_owner,c.brand_id,p_id,(v->>'logoSourceAssetId')::uuid,'logo'); end if;
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
  if prior.generation is not null and item->>'imageUrl' is not null and prior.generation-array['status','review','reviewError'] is distinct from item-array['brief','research','status','review','reviewError'] then raise exception 'WORKFLOW:Completed creative content is immutable.'; end if;
  if item->>'status'='approved' and item#>>'{review,verdict}' is distinct from 'pass' then raise exception 'WORKFLOW:Only a passing reviewed ad can be approved.'; end if;
  insert into ad_versions(id,user_id,campaign_id,research_snapshot_id,parent_version_id,reference_asset_id,background_asset_id,scene_asset_id,final_asset_id,brief,generation,brief_approved_at,approved_at,generation_state,review_status,generated_at)
   values(vid,p_owner,p_id,(v->>'researchId')::uuid,parent,source,bg,scene,final_id,v,case when item->>'imageUrl' is not null then item-array['brief','research'] else null end,(v->>'approvedAt')::timestamptz,case when item->>'status'='approved' then now() end,generation_state_value,item->>'status',case when final_id is not null then now() end)
  on conflict(id) do update set brief=excluded.brief,background_asset_id=excluded.background_asset_id,scene_asset_id=excluded.scene_asset_id,final_asset_id=coalesce(excluded.final_asset_id,ad_versions.final_asset_id),generation=coalesce(excluded.generation,ad_versions.generation),brief_approved_at=excluded.brief_approved_at,approved_at=case when excluded.generation is not null then excluded.approved_at else ad_versions.approved_at end,generation_state=excluded.generation_state,review_status=coalesce(excluded.review_status,ad_versions.review_status),generated_at=coalesce(ad_versions.generated_at,excluded.generated_at),updated_at=now();
 end loop;
 if (c.preferences is distinct from coalesce(p_session->'preferences','{}') or c.current_research_id is distinct from rid) and p_session#>>'{brief,approvedAt}' is not null and exists(select 1 from ad_versions where id=(p_session#>>'{brief,id}')::uuid and generation_state<>'complete') then raise exception 'WORKFLOW:Changed research or preferences invalidates pending approval.'; end if;
 update campaigns set setup_state=coalesce(p_session->'setup',setup_state),brand_id=c.brand_id,name=case when c.purpose='campaign' then coalesce(nullif(p_session#>>'{preferences,campaignName}',''),left(nullif(r#>>'{campaign,direction,text}',''),120),name) else coalesce(r#>>'{brandKit,name}',name) end,current_research_id=rid,current_version_id=(p_session#>>'{brief,id}')::uuid,preferences=coalesce(p_session->'preferences','{}'),messages=coalesce(p_session->'messages','[]'),events=coalesce(p_session->'events','[]'),workflow_state=p_session->'researchState',last_error=p_session->>'lastError',revision=revision+1,updated_at=now() where id=p_id;

 if c.purpose='brand_setup' and p_session#>>'{setup,state}'='ready' and rid is not null then
  if jsonb_typeof(r->'brandKit')<>'object' or jsonb_array_length(r->'sources')=0 then raise exception 'WORKFLOW:No usable brand context.'; end if;
  update brands set completed_context_id=rid,context_revision=context_revision+1,name=r#>>'{brandKit,name}',brand_kit=r->'brandKit',brand_kit_schema_version=2,updated_at=now()
   where id=c.brand_id and user_id=p_owner and completed_context_id is null;
 end if;
 return jsonb_build_object('revision',p_revision+1,'brand_id',c.brand_id);
end $$;


create function public.create_brand_setup(p_owner uuid,p_key uuid,p_hostname text,p_url text,p_original text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare b brands; cid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select id into cid from campaigns where user_id=p_owner and creation_key=p_key;
 if found then return cid; end if;
 insert into brands(id,user_id,normalized_hostname,name) values(gen_random_uuid(),p_owner,p_hostname,p_hostname) on conflict(user_id,normalized_hostname) do nothing;
 select * into b from brands where user_id=p_owner and normalized_hostname=p_hostname for update;
 select id into cid from campaigns where user_id=p_owner and brand_id=b.id and (purpose='brand_setup' or setup_state->>'state'='ready') order by created_at asc limit 1;
 if found then return cid; end if;
 cid:=gen_random_uuid();
 insert into campaigns(id,user_id,brand_id,purpose,creation_key,setup_state) values(cid,p_owner,b.id,'brand_setup',p_key,jsonb_build_object('state','needs_url','storeUrl',p_url,'originalUrl',p_original));
 return cid;
end $$;

-- A single transaction copies the completed context and seeds the assistant opening.
create function public.start_brand_campaign(p_owner uuid,p_brand uuid,p_key uuid,p_setup uuid,p_context uuid,p_research jsonb,p_message jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare b brands; c campaigns; cid uuid; rid uuid:=(p_research->>'id')::uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select * into c from campaigns where user_id=p_owner and creation_key=p_key and purpose='campaign';
 if found then
  if c.brand_id<>p_brand then raise exception 'WORKFLOW:This request key belongs to another brand.'; end if;
  return c.id;
 end if;
 select * into b from brands where id=p_brand and user_id=p_owner for update;
 if not found or b.completed_context_id is null then raise exception 'WORKFLOW:Finish brand setup first.'; end if;
 if p_setup is not null then
  select * into c from campaigns where id=p_setup and user_id=p_owner and brand_id=b.id for update;
  if not found then raise exception 'WORKFLOW:Brand setup not found.'; end if;
  if c.purpose='campaign' then return c.id; end if;
  if c.setup_state->>'state'<>'ready' or (c.lease_token is not null and c.lease_expires_at>clock_timestamp()) then raise exception 'WORKFLOW:Brand setup is still running.'; end if;
 end if;
 if b.completed_context_id<>p_context then raise exception 'WORKFLOW:Brand changed. Reload before starting a campaign.'; end if;
 insert into research_snapshots(id,user_id,brand_id,schema_version,data) values(rid,p_owner,b.id,2,p_research-'schemaVersion');
 if p_setup is not null then
  cid:=c.id;
  update campaigns set purpose='campaign',creation_key=p_key,name='Campaign '||(select count(*)+1 from campaigns where user_id=p_owner and brand_id=b.id and purpose='campaign')::text,current_research_id=rid,workflow_state='{"stage":"awaiting_direction"}',messages=messages||jsonb_build_array(p_message),events='[]',last_error=null,preferences='{}',revision=revision+1,updated_at=now() where id=cid;
 else
  cid:=gen_random_uuid();
  insert into campaigns(id,user_id,brand_id,purpose,creation_key,name,current_research_id,workflow_state,messages) values(cid,p_owner,b.id,'campaign',p_key,'Campaign '||(select count(*)+1 from campaigns where user_id=p_owner and brand_id=b.id and purpose='campaign')::text,rid,'{"stage":"awaiting_direction"}',jsonb_build_array(p_message));
 end if;
 return cid;
end $$;

create function public.correct_brand_context(p_owner uuid,p_brand uuid,p_revision integer,p_research jsonb) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b brands; rid uuid:=(p_research->>'id')::uuid;
begin
 select * into b from brands where id=p_brand and user_id=p_owner for update;
 if not found or b.completed_context_id is null then raise exception 'WORKFLOW:Finish brand setup first.'; end if;
 if b.context_revision<>p_revision then raise exception 'WORKFLOW:Brand changed in another window. Reload before saving your corrections.'; end if;
 insert into research_snapshots(id,user_id,brand_id,schema_version,data) values(rid,p_owner,b.id,2,p_research-'schemaVersion');
 update brands set completed_context_id=rid,context_revision=context_revision+1,name=coalesce(p_research#>>'{brandKit,overrides,name}',p_research#>>'{brandKit,name}'),brand_kit=p_research->'brandKit',updated_at=now() where id=b.id;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_brand_setup','start_brand_campaign','correct_brand_context','commit_campaign') loop
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

commit;
