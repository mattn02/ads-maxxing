-- JSON null is distinct from SQL NULL. Only an actual validated kit object may replace the shared kit.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.commit_campaign(uuid,uuid,uuid,integer,jsonb,text,integer)'::regprocedure) into definition;
 definition:=replace(definition,
  'if r->''brandKit'' is not null and (r->>''id'')::uuid is distinct from c.current_research_id then update brands',
  'if jsonb_typeof(r->''brandKit'')=''object'' and (r->>''id'')::uuid is distinct from c.current_research_id then update brands');
 execute definition;
end $$;
