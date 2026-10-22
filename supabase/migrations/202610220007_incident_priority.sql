-- Incident Priority Index.
--
--   Priority Index = Severity + Urgency + Affected Population
--
-- Each factor is an integer from 1 to 4, so the index runs from 3 to 12:
--   3-5 Low, 6-8 Moderate, 9-11 High, 12 Critical.
-- The index and class are generated columns, so the formula lives in one
-- place. Responders (Security, DRRM, School Admin) set the factors through
-- set_incident_priority(); clients still have no direct UPDATE on incidents.

alter table public.incidents
  add column if not exists priority_severity smallint,
  add column if not exists priority_urgency smallint,
  add column if not exists priority_affected smallint,
  add column if not exists priority_set_by uuid references public.profiles(id) on delete set null,
  add column if not exists priority_set_at timestamptz;

alter table public.incidents drop constraint if exists incidents_priority_factors_check;
alter table public.incidents add constraint incidents_priority_factors_check check (
  (priority_severity is null and priority_urgency is null and priority_affected is null)
  or (priority_severity between 1 and 4 and priority_urgency between 1 and 4 and priority_affected between 1 and 4)
);

alter table public.incidents
  add column if not exists priority_index smallint
    generated always as (priority_severity + priority_urgency + priority_affected) stored;

alter table public.incidents
  add column if not exists priority_level text
    generated always as (
      case
        when priority_severity + priority_urgency + priority_affected between 3 and 5 then 'low'
        when priority_severity + priority_urgency + priority_affected between 6 and 8 then 'moderate'
        when priority_severity + priority_urgency + priority_affected between 9 and 11 then 'high'
        when priority_severity + priority_urgency + priority_affected = 12 then 'critical'
      end
    ) stored;

create or replace function public.set_incident_priority(
  p_incident_id uuid,
  p_severity int,
  p_urgency int,
  p_affected int
)
returns public.incidents
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_incident public.incidents%rowtype;
  v_actor uuid := auth.uid();
begin
  select * into v_incident from public.incidents where id = p_incident_id for update;
  if not found then
    raise exception 'incident not found';
  end if;
  if v_incident.school_id is distinct from public.my_school_id() then
    raise exception 'incident belongs to a different school';
  end if;
  if not public.is_reviewer() then
    raise exception 'only Security, DRRM, or School Admin can set an incident priority';
  end if;
  if v_incident.status in ('closed', 'cancelled') then
    raise exception 'a % incident cannot be re-prioritized', v_incident.status;
  end if;
  if p_severity not between 1 and 4 or p_urgency not between 1 and 4 or p_affected not between 1 and 4 then
    raise exception 'severity, urgency, and affected population must each be 1 to 4';
  end if;

  update public.incidents
     set priority_severity = p_severity,
         priority_urgency = p_urgency,
         priority_affected = p_affected,
         priority_set_by = v_actor,
         priority_set_at = now()
   where id = p_incident_id
  returning * into v_incident;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'incident_prioritized', 'incidents', p_incident_id::text,
          jsonb_build_object('case_ref', v_incident.case_ref,
                             'severity', p_severity, 'urgency', p_urgency, 'affected', p_affected,
                             'priority_index', v_incident.priority_index,
                             'priority_level', v_incident.priority_level));
  return v_incident;
end;
$function$;

revoke all on function public.set_incident_priority(uuid, int, int, int) from public, anon;
grant execute on function public.set_incident_priority(uuid, int, int, int) to authenticated;
