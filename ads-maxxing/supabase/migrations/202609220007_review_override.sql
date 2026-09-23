begin;

-- Patch both persistence entry points, preserving ownership, durable assets,
-- immutable reviews/content, timestamps, leases and re-review revocation.
do $migration$
declare definition text; target text; old_guard text; new_guard text;
begin
 old_guard := $old$    if item#>>'{review,verdict}' is null or item#>>'{review,verdict}' not in ('pass','needs_human') then
     raise exception 'WORKFLOW:Failed reviews cannot be accepted.';
    end if;
    if jsonb_typeof(item#>'{review,checks}') is distinct from 'array' then
     raise exception 'WORKFLOW:Acceptance requires nonempty passing deterministic checks.';
    end if;
    if jsonb_array_length(item#>'{review,checks}')=0 or exists(
       select 1 from jsonb_array_elements(item#>'{review,checks}') as checks(value) where value->'passed' is distinct from 'true'::jsonb) then
     raise exception 'WORKFLOW:Acceptance requires nonempty passing deterministic checks.';
    end if;
$old$;
 new_guard := $new$    if item#>>'{review,verdict}' is null or item#>>'{review,verdict}' not in ('pass','needs_human','needs_changes') then
     raise exception 'WORKFLOW:Save a completed review before accepting this ad.';
    end if;
    if jsonb_typeof(item#>'{review,checks}') is distinct from 'array' then
     raise exception 'WORKFLOW:Acceptance requires nonempty boolean deterministic checks.';
    end if;
    if jsonb_array_length(item#>'{review,checks}')=0 or exists(
       select 1 from jsonb_array_elements(item#>'{review,checks}') as checks(value) where jsonb_typeof(value->'passed') is distinct from 'boolean') then
     raise exception 'WORKFLOW:Acceptance requires nonempty boolean deterministic checks.';
    end if;
    if item#>'{acceptance,reviewOverridden}' is not null and jsonb_typeof(item#>'{acceptance,reviewOverridden}') is distinct from 'boolean' then
     raise exception 'WORKFLOW:Review override must be a boolean.';
    end if;
    if (item#>>'{review,verdict}'='needs_changes' or exists(
       select 1 from jsonb_array_elements(item#>'{review,checks}') as checks(value) where value->'passed'='false'::jsonb))
       and item#>'{acceptance,reviewOverridden}' is distinct from 'true'::jsonb then
     raise exception 'WORKFLOW:Explicitly override the review recommendation to accept this ad.';
    end if;
$new$;
 foreach target in array array['commit_campaign','commit_campaign_v2'] loop
  select pg_get_functiondef(to_regprocedure('public.' || target || '(uuid,uuid,uuid,integer,jsonb,text,integer)')) into definition;
  if definition is null or position(old_guard in definition)=0
     or position($needle$not in ('reviewed','needs_human','approved')$needle$ in definition)=0 then
   raise exception 'Unexpected % definition; apply migrations through 006 before review override.', target;
  end if;
  definition := replace(definition,old_guard,new_guard);
  definition := replace(definition,$needle$not in ('reviewed','needs_human','approved')$needle$,$replacement$not in ('reviewed','needs_human','needs_changes','approved')$replacement$);
  execute definition;
 end loop;
end $migration$;

commit;
