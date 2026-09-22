begin;

-- Keep the paid-attempt, ownership and immutable-content guards from 004 intact.
-- Fail closed if the deployed function differs from the reviewed predecessor.
do $migration$
declare definition text; old_guard text; new_guard text;
begin
 select pg_get_functiondef('public.commit_campaign(uuid,uuid,uuid,integer,jsonb,text,integer)'::regprocedure) into definition;
 old_guard := $old$if item->>'status'='approved' and item#>>'{review,verdict}' is distinct from 'pass' then raise exception 'WORKFLOW:Only a passing reviewed ad can be approved.'; end if;$old$;
 new_guard := $new$
  -- Acceptance is a human decision about an already durable, unchanged review.
  if item->'acceptance' is not null and item->'acceptance'<>'null'::jsonb and item->>'status' is distinct from 'approved' then
   raise exception 'WORKFLOW:Clear acceptance when re-reviewing or changing approval status.';
  end if;
  if item->>'status'='approved' then
   if (item->'acceptance' is null or item->'acceptance'='null'::jsonb)
      and prior.generation->>'status'='approved' and prior.generation#>>'{review,verdict}'='pass'
      and (prior.generation->'acceptance' is null or prior.generation->'acceptance'='null'::jsonb)
      and item->'review' is not distinct from prior.generation->'review' then
    null; -- Previously approved legacy pass records remain saveable without fabricated acceptance.
   else
    if prior.generation->>'status' is null or prior.generation->>'status' not in ('reviewed','needs_human','approved')
       or item->'review' is distinct from prior.generation->'review' then
     raise exception 'WORKFLOW:Save a completed review before accepting this ad; acceptance cannot change its review.';
    end if;
    if item#>>'{review,verdict}' is null or item#>>'{review,verdict}' not in ('pass','needs_human') then
     raise exception 'WORKFLOW:Failed reviews cannot be accepted.';
    end if;
    if jsonb_typeof(item#>'{review,checks}') is distinct from 'array' then
     raise exception 'WORKFLOW:Acceptance requires nonempty passing deterministic checks.';
    end if;
    if jsonb_array_length(item#>'{review,checks}')=0 or exists(
       select 1 from jsonb_array_elements(item#>'{review,checks}') as checks(value) where value->'passed' is distinct from 'true'::jsonb) then
     raise exception 'WORKFLOW:Acceptance requires nonempty passing deterministic checks.';
    end if;
    if jsonb_typeof(item->'acceptance') is distinct from 'object'
       or jsonb_typeof(item#>'{acceptance,acceptedAt}') is distinct from 'string'
       or nullif(item#>>'{acceptance,acceptedAt}','') is null
       or nullif(item#>>'{review,createdAt}','') is null
       or item#>>'{acceptance,reviewedAt}' is distinct from item#>>'{review,createdAt}' then
     raise exception 'WORKFLOW:Acceptance must identify the current saved review and acceptance time.';
    end if;
    if not isfinite((item#>>'{acceptance,acceptedAt}')::timestamptz) or not isfinite((item#>>'{acceptance,reviewedAt}')::timestamptz) then
     raise exception 'WORKFLOW:Acceptance timestamps must be finite.';
    end if;
    if prior.generation->>'status'='approved' and prior.generation->'acceptance' is not null
       and prior.generation->'acceptance'<>'null'::jsonb and item->'acceptance' is distinct from prior.generation->'acceptance' then
     raise exception 'WORKFLOW:An existing acceptance timestamp cannot be changed.';
    end if;
   end if;
  end if;$new$;
 if position(old_guard in definition)=0
    or position($needle$prior.generation-array['status','review','reviewError']$needle$ in definition)=0
    or position($needle$item-array['brief','research','status','review','reviewError']$needle$ in definition)=0
    or position($needle$case when item->>'status'='approved' then now() end$needle$ in definition)=0 then
  raise exception 'Unexpected commit_campaign definition; review acceptance migration before applying.';
 end if;
 definition := replace(definition,old_guard,new_guard);
 definition := replace(definition,$needle$prior.generation-array['status','review','reviewError']$needle$,$replacement$prior.generation-array['status','review','reviewError','acceptance']$replacement$);
 definition := replace(definition,$needle$item-array['brief','research','status','review','reviewError']$needle$,$replacement$item-array['brief','research','status','review','reviewError','acceptance']$replacement$);
 definition := replace(definition,$needle$case when item->>'status'='approved' then now() end$needle$,$replacement$case when item->>'status'='approved' then coalesce((item#>>'{acceptance,acceptedAt}')::timestamptz,prior.approved_at,now()) end$replacement$);
 execute definition;
end $migration$;

commit;
