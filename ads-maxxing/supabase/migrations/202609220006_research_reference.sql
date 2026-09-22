begin;

-- New service-only RPC: old clients retain commit_campaign unchanged.
-- Copy the reviewed 005 function, then replace only research persistence with a reference branch.
do $migration$
declare definition text; old_research text; new_research text;
begin
 if to_regprocedure('public.commit_campaign_v2(uuid,uuid,uuid,integer,jsonb,text,integer)') is not null then
  raise exception 'commit_campaign_v2 already exists; review migration before applying.';
 end if;
 select pg_get_functiondef('public.commit_campaign(uuid,uuid,uuid,integer,jsonb,text,integer)'::regprocedure) into definition;
 old_research := $old$ r:=p_session->'research';
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
$old$;
 new_research := $new$ if p_session ? 'researchReference' then
  if p_session ? 'research' then raise exception 'WORKFLOW:Send either research or its saved reference, never both.'; end if;
  if jsonb_typeof(p_session->'researchReference') is distinct from 'object'
     or jsonb_typeof(p_session#>'{researchReference,id}') is distinct from 'string'
     or p_session#>'{researchReference,schemaVersion}' not in ('1'::jsonb,'2'::jsonb)
     or p_session#>'{researchReference,schemaVersion}' is null
     or (p_session#>>'{researchReference,schemaVersion}')::integer is distinct from p_schema_version then
   raise exception 'WORKFLOW:Invalid saved research reference.';
  end if;
  rid:=(p_session#>>'{researchReference,id}')::uuid;
  select s.data into r from research_snapshots s
   join brands owner_brand on owner_brand.id=s.brand_id and owner_brand.user_id=p_owner
   where s.id=rid and s.user_id=p_owner and s.brand_id=c.brand_id
     and s.schema_version=p_schema_version and owner_brand.normalized_hostname=p_hostname;
  if not found then raise exception 'WORKFLOW:Saved research reference must belong to this owner, campaign brand and schema.'; end if;
  -- Canonical saved data supplies campaign metadata; do not reconstruct or compare a full client payload.
 else
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
 end if;
$new$;
 if position(old_research in definition)=0
    or position('c:=assert_lease(p_owner,p_id,p_token,p_revision);' in definition)=0
    or position('Acceptance requires nonempty passing deterministic checks.' in definition)=0
    or position($needle$prior.generation-array['status','review','reviewError','acceptance']$needle$ in definition)=0
    or position($needle$coalesce((item#>>'{acceptance,acceptedAt}')::timestamptz,prior.approved_at,now())$needle$ in definition)=0 then
  raise exception 'Unexpected commit_campaign definition; apply and review migrations through 005 first.';
 end if;
 definition := replace(definition,'CREATE OR REPLACE FUNCTION public.commit_campaign(', 'CREATE OR REPLACE FUNCTION public.commit_campaign_v2(');
 definition := replace(definition,old_research,new_research);
 execute definition;
end $migration$;

revoke all on function public.commit_campaign_v2(uuid,uuid,uuid,integer,jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.commit_campaign_v2(uuid,uuid,uuid,integer,jsonb,text,integer) to service_role;

-- Make the new RPC available through PostgREST after this transaction commits.
notify pgrst, 'reload schema';

commit;
