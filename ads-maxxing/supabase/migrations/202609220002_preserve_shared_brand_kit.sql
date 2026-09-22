-- Saving messages/reviews in an older campaign must not overwrite newer shared brand corrections.
-- Only a newly attached immutable research snapshot can update the owner's current brand kit.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.commit_campaign(uuid,uuid,uuid,integer,jsonb,text,integer)'::regprocedure) into definition;
 if position('if r->''brandKit'' is not null then update brands' in definition)>0 then
  definition:=replace(definition,
   'if r->''brandKit'' is not null then update brands',
   'if r->''brandKit'' is not null and (r->>''id'')::uuid is distinct from c.current_research_id then update brands');
  execute definition;
 elsif position('if r->''brandKit'' is not null and (r->>''id'')::uuid is distinct from c.current_research_id then update brands' in definition)=0 then
  raise exception 'Unexpected commit_campaign definition; review the shared brand-kit migration before applying.';
 end if;
end $$;
