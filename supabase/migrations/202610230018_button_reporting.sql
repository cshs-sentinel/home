-- Button-based reporting for Community Members and Classroom Advisers.
-- Additive only: every existing category, status, and feeling stays valid, no
-- table is created or dropped, and no existing row is deleted.
--
-- 1. Incident categories: ten new buttons, the four legacy values kept.
-- 2. incidents.status gains 'pending_evaluation', the initial status of any
--    incident raised by someone who is not a reviewer. A School Admin validates
--    it (-> acknowledged, the normal workflow continues) or dismisses it
--    (-> cancelled, kept for the audit trail rather than hard-deleted).
-- 3. Default Priority Index factors (Severity, Urgency, Affected population,
--    each 1-4) are applied by the database on every insert, so P = S + U + A
--    exists from the first second and nobody can pre-rate their own report.
-- 4. Help requests (check_ins with status need_help) gain a type and an initial
--    triage status, routed by the database, plus a triage RPC for responders.
-- 5. New feelings (Good, Okay, Not Good, Upset, Unsafe, Need Support). The
--    stress level is derived from the feeling when it is not supplied.
-- 6. Realtime for incidents, help requests, and submissions, so the map and the
--    queue update the moment a report lands.

-- ---------------------------------------------------------------------------
-- 1 and 2. Categories and statuses
-- ---------------------------------------------------------------------------

alter table public.incidents drop constraint if exists incidents_category;
alter table public.incidents add constraint incidents_category check (category = any (array[
  'emergency', 'medical', 'security', 'other',
  'bullying', 'suspicious_person', 'fire_smoke', 'electrical_hazard', 'structural_damage',
  'injury_accident', 'threat_violence', 'water_chemical_spill', 'unsafe_facility', 'other_concern'
]));

alter table public.incidents drop constraint if exists incidents_status;
alter table public.incidents add constraint incidents_status check (status = any (array[
  'pending_evaluation', 'new', 'acknowledged', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled'
]));

-- ---------------------------------------------------------------------------
-- 3. Default priority factors per category
-- ---------------------------------------------------------------------------
-- Conservative on purpose: when the true extent is unknown at report time the
-- default errs towards the higher class, and a responder confirms or changes it
-- (set_incident_priority) while evaluating. Returns {severity, urgency, affected}.

create or replace function public.default_incident_priority(p_category text)
returns smallint[]
language sql immutable set search_path to ''
as $function$
  select case p_category
    when 'fire_smoke'            then array[4, 4, 4]
    when 'threat_violence'       then array[4, 4, 3]
    when 'suspicious_person'     then array[3, 4, 3]
    when 'injury_accident'       then array[3, 4, 2]
    when 'structural_damage'     then array[3, 3, 3]
    when 'electrical_hazard'     then array[3, 3, 2]
    when 'water_chemical_spill'  then array[2, 3, 2]
    when 'bullying'              then array[3, 2, 1]
    when 'unsafe_facility'       then array[2, 2, 2]
    when 'other_concern'         then array[2, 2, 1]
    when 'emergency'             then array[4, 4, 2]
    when 'medical'               then array[3, 4, 1]
    when 'security'              then array[3, 3, 2]
    else                              array[2, 2, 1]
  end::smallint[];
$function$;

grant execute on function public.default_incident_priority(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Incident validation: categories, initial status, location, default priority
-- ---------------------------------------------------------------------------

create or replace function public.validate_incident()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_location public.locations%rowtype;
  v_open record;
  v_defaults smallint[];
  v_button_category boolean;
begin
  -- Case reference is always generated server-side
  new.case_ref := public.next_case_ref();

  if auth.uid() is not null then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.created_by is distinct from auth.uid() then
      raise exception 'incident must be raised by yourself';
    end if;
  end if;

  if new.category not in (
    'emergency', 'medical', 'security', 'other',
    'bullying', 'suspicious_person', 'fire_smoke', 'electrical_hazard', 'structural_damage',
    'injury_accident', 'threat_violence', 'water_chemical_spill', 'unsafe_facility', 'other_concern'
  ) then
    raise exception 'invalid incident category';
  end if;
  v_button_category := new.category not in ('emergency', 'medical', 'security', 'other');

  if char_length(new.description) < 3 or char_length(new.description) > 2000 then
    raise exception 'description must be between 3 and 2000 characters';
  end if;
  if new.status not in ('new', 'pending_evaluation') then
    raise exception 'new incidents must start as new or pending evaluation';
  end if;

  -- Whatever the browser sent, a report from anyone but a School Admin waits
  -- for evaluation; a School Admin's own report goes straight into the workflow.
  new.status := case when public.is_reviewer() then 'new' else 'pending_evaluation' end;

  if v_button_category and new.location_id is null then
    raise exception 'choose where this happened';
  end if;
  if new.location_id is not null then
    select * into v_location from public.locations where id = new.location_id;
    if not found then
      raise exception 'location not found';
    end if;
    if v_location.school_id <> new.school_id then
      raise exception 'location belongs to a different school';
    end if;
    if v_location.status <> 'active' then
      raise exception 'that location is not active; choose another place';
    end if;
  end if;

  -- Default Priority Index factors are applied by the system, never the reporter.
  v_defaults := public.default_incident_priority(new.category);
  new.priority_severity := v_defaults[1];
  new.priority_urgency := v_defaults[2];
  new.priority_affected := v_defaults[3];
  new.priority_set_by := null;
  new.priority_set_at := null;

  -- Duplicate protection: one open incident per person per 5 minutes
  select i.id, i.case_ref into v_open
  from public.incidents i
  where i.created_by = new.created_by
    and i.status in ('pending_evaluation', 'new', 'acknowledged', 'assigned', 'in_progress')
    and i.created_at > now() - interval '5 minutes'
  order by i.created_at desc
  limit 1;

  if found then
    raise exception 'you already have an open incident (%); please wait before raising another', v_open.case_ref;
  end if;

  return new;
end;
$function$;

-- Staff are told as soon as a report lands, whichever state it starts in.
create or replace function public.notify_new_incident()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  if new.status in ('new', 'pending_evaluation') then
    insert into public.incident_notifications (school_id, incident_id, case_ref, title, body)
    values (
      new.school_id,
      new.id,
      new.case_ref,
      case when new.status = 'pending_evaluation' then 'Report to evaluate ' || new.case_ref else 'New case ' || new.case_ref end,
      left(new.description, 200)
    );
  end if;
  return new;
end;
$function$;

-- Workflow: pending_evaluation -> acknowledged (validate) or cancelled (dismiss),
-- then the existing steps. Everything that already worked still works.
create or replace function public.transition_incident(incident_id uuid, new_status text, note text default null)
returns public.incidents
language plpgsql security definer set search_path to ''
as $function$
declare
  v_incident_id uuid := incident_id;
  v_new_status text := new_status;
  v_note text := note;
  v_incident public.incidents%rowtype;
  v_old_status text;
  v_actor uuid := auth.uid();
  v_allowed boolean := false;
begin
  select * into v_incident from public.incidents where id = v_incident_id for update;
  if not found then
    raise exception 'incident not found';
  end if;
  if v_incident.school_id <> public.my_school_id() then
    raise exception 'incident belongs to a different school';
  end if;

  if v_new_status = 'acknowledged' and v_incident.status in ('pending_evaluation', 'new') and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'assigned' and v_incident.status = 'acknowledged' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'in_progress' and v_incident.status = 'assigned' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'resolved' and v_incident.status = 'in_progress' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'closed' and v_incident.status = 'resolved' and public.is_reviewer() then
    v_allowed := true;
  elsif v_new_status = 'cancelled'
        and v_incident.status in ('pending_evaluation', 'new', 'acknowledged', 'assigned', 'in_progress')
        and (v_incident.created_by = v_actor or public.is_admin()) then
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'transition % -> % is not allowed for your role', v_incident.status, v_new_status;
  end if;

  v_old_status := v_incident.status;

  update public.incidents
     set status = v_new_status,
         acknowledged_by = case when v_new_status = 'acknowledged' then v_actor else acknowledged_by end,
         acknowledged_at = case when v_new_status = 'acknowledged' then now() else acknowledged_at end,
         assigned_to = case when v_new_status = 'assigned' then coalesce(assigned_to, v_actor) else assigned_to end,
         assigned_at = case when v_new_status = 'assigned' then now() else assigned_at end,
         resolved_at = case when v_new_status = 'resolved' then now() else resolved_at end,
         resolution_notes = case when v_new_status = 'resolved' then coalesce(v_note, resolution_notes) else resolution_notes end,
         closed_at = case when v_new_status = 'closed' then now() else closed_at end,
         closed_by = case when v_new_status = 'closed' then v_actor else closed_by end,
         cancelled_at = case when v_new_status = 'cancelled' then now() else cancelled_at end,
         cancelled_by = case when v_new_status = 'cancelled' then v_actor else cancelled_by end,
         cancelled_reason = case when v_new_status = 'cancelled' then coalesce(v_note, 'no reason given') else cancelled_reason end,
         updated_at = now()
   where id = v_incident_id
  returning * into v_incident;

  insert into public.incident_status_history (incident_id, from_status, to_status, actor_id, note)
  values (v_incident_id, v_old_status, v_new_status, v_actor, v_note);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    v_actor,
    'incident_transition',
    'incidents',
    v_incident_id::text,
    jsonb_build_object('case_ref', v_incident.case_ref, 'from', v_old_status, 'to', v_new_status)
  );

  return v_incident;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Help requests: type, initial triage status, responder triage
-- ---------------------------------------------------------------------------

alter table public.check_ins add column if not exists help_type text;
alter table public.check_ins add column if not exists triage_status text;
alter table public.check_ins add column if not exists triage_by uuid references public.profiles(id);
alter table public.check_ins add column if not exists triage_at timestamptz;

alter table public.check_ins drop constraint if exists check_ins_help_type;
alter table public.check_ins add constraint check_ins_help_type check (help_type is null or help_type = any (array[
  'emergency_help', 'medical_assistance', 'safety_assistance', 'counseling_support', 'accessibility_assistance', 'other_help'
]));
alter table public.check_ins drop constraint if exists check_ins_triage_status;
alter table public.check_ins add constraint check_ins_triage_status check (triage_status is null or triage_status = any (array[
  'urgent', 'awaiting_triage', 'responding', 'resolved'
]));

-- Requests made before this change have no type: treat them as waiting for triage.
update public.check_ins set triage_status = 'awaiting_triage' where status = 'need_help' and triage_status is null;

create or replace function public.validate_check_in()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_location public.locations%rowtype;
  v_typed boolean := new.help_type is not null;
begin
  if auth.uid() is not null then
    new.profile_id := coalesce(new.profile_id, auth.uid());
    if new.profile_id is distinct from auth.uid() then
      raise exception 'check-in must be recorded for yourself';
    end if;
  end if;

  if new.period is not null and char_length(new.period) > 60 then
    raise exception 'period label is too long';
  end if;

  -- staff_verified may only be set by reviewers
  if new.location_source = 'staff_verified' and not public.is_reviewer() then
    raise exception 'only responders or administrators can record a staff-verified location';
  end if;

  -- Optional location: must exist, be in the same school, and be active
  if new.location_id is not null then
    select * into v_location from public.locations where id = new.location_id;
    if not found then
      raise exception 'location not found';
    end if;
    if v_location.school_id <> new.school_id then
      raise exception 'location belongs to a different school';
    end if;
    if v_location.status <> 'active' then
      raise exception 'that location is not active; choose another place';
    end if;
  end if;

  -- A schedule-derived check-in must match an active schedule for today
  if new.location_source = 'schedule_derived' then
    if new.location_id is null then
      raise exception 'a schedule-derived check-in needs a location';
    end if;
    if not exists (
      select 1 from public.schedules s
      where s.location_id = new.location_id
        and s.status = 'active'
        and s.day_of_week = extract(dow from current_date)::int
        and s.effective_from <= current_date
        and (s.effective_until is null or s.effective_until >= current_date)
    ) then
      raise exception 'no active schedule for that location today';
    end if;
  end if;

  if new.status = 'need_help' then
    -- A typed help request (the Get Help buttons) must say where.
    if v_typed and new.location_id is null then
      raise exception 'choose where you need help';
    end if;
    -- The older untyped "I need help" button is treated as Emergency Help.
    if new.help_type is null then
      new.help_type := 'emergency_help';
    end if;
    -- Routing is decided here, never by the browser.
    new.triage_status := case
      when new.help_type in ('emergency_help', 'medical_assistance', 'safety_assistance') then 'urgent'
      else 'awaiting_triage'
    end;
    new.triage_by := null;
    new.triage_at := null;
    -- Duplicate protection: one help request per person per 2 minutes
    if exists (
      select 1 from public.check_ins c
      where c.profile_id = new.profile_id and c.status = 'need_help' and c.checked_in_at > now() - interval '2 minutes'
    ) then
      raise exception 'you already asked for help a moment ago; responders have it';
    end if;
  else
    new.help_type := null;
    new.triage_status := null;
    new.triage_by := null;
    new.triage_at := null;
  end if;

  return new;
end;
$function$;

create or replace function public.triage_help_request(p_check_in_id uuid, p_status text)
returns public.check_ins
language plpgsql security definer set search_path to ''
as $function$
declare
  v_row public.check_ins%rowtype;
  v_actor uuid := auth.uid();
begin
  if not public.is_reviewer() then
    raise exception 'only a School Admin can triage a help request';
  end if;
  if p_status not in ('responding', 'resolved') then
    raise exception 'a help request can move to responding or resolved';
  end if;
  select * into v_row from public.check_ins where id = p_check_in_id for update;
  if not found or v_row.status <> 'need_help' then
    raise exception 'help request not found';
  end if;
  if v_row.school_id is distinct from public.my_school_id() then
    raise exception 'help request belongs to a different school';
  end if;
  if v_row.triage_status = 'resolved' then
    raise exception 'this help request is already resolved';
  end if;

  update public.check_ins
     set triage_status = p_status, triage_by = v_actor, triage_at = now()
   where id = p_check_in_id
  returning * into v_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'help_request_triaged', 'check_ins', p_check_in_id::text,
          jsonb_build_object('help_type', v_row.help_type, 'to', p_status));
  return v_row;
end;
$function$;

revoke all on function public.triage_help_request(uuid, text) from public, anon;
grant execute on function public.triage_help_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Feelings: Good, Okay, Not Good, Upset, Unsafe, Need Support
-- ---------------------------------------------------------------------------

alter table public.submissions drop constraint if exists submissions_sub_type;
alter table public.submissions add constraint submissions_sub_type check (
  (kind = 'sentiment' and sub_type = any (array[
    'joy', 'calm', 'worried', 'sad', 'angry', 'stressed', 'hopeless', 'lonely',
    'good', 'okay', 'not_good', 'upset', 'unsafe', 'need_support'
  ]))
  or (kind = 'incident_hazard' and sub_type = any (array['bullying', 'unsafe_condition', 'suspicious_activity']))
  or (kind = 'observation' and sub_type = any (array['suggestion', 'report', 'safety_concern']))
);

-- A feeling no longer asks for a stress level: it is derived from the button so
-- the stress analytics and the Sentiment heatmap keep working.
create or replace function public.validate_submission()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  if auth.uid() is not null then
    new.submitted_by := coalesce(new.submitted_by, auth.uid());
    if new.submitted_by is distinct from auth.uid() then
      raise exception 'a submission must be sent by yourself';
    end if;
  end if;

  if new.kind = 'sentiment' then
    if new.stress_level is null then
      new.stress_level := case new.sub_type
        when 'good' then 1 when 'okay' then 2 when 'not_good' then 3
        when 'upset' then 4 when 'unsafe' then 5 when 'need_support' then 5
        else null
      end;
    end if;
    if new.stress_level is null then
      raise exception 'a sentiment submission needs a stress level';
    end if;
    if new.stress_level < 1 or new.stress_level > 5 then
      raise exception 'stress level must be between 1 and 5';
    end if;
  elsif new.stress_level is not null then
    raise exception 'a stress level only applies to sentiment submissions';
  end if;

  if char_length(new.message) < 3 or char_length(new.message) > 2000 then
    raise exception 'message must be between 3 and 2000 characters';
  end if;

  if new.status <> 'new' then
    raise exception 'new submissions must start as new';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Dashboard counts know about the new status
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_counts()
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school uuid := public.my_school_id();
  v_role public.app_role;
  v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if v_school is null then
    raise exception 'no school is assigned to this account';
  end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid();

  v_out := v_out || jsonb_build_object(
    'role', coalesce(v_role::text, 'unknown'),
    'my_check_ins_today', (select count(*) from public.check_ins c where c.school_id = v_school and c.profile_id = auth.uid() and c.checked_in_at >= current_date),
    'my_need_help', (select count(*) from public.check_ins c where c.school_id = v_school and c.profile_id = auth.uid() and c.status = 'need_help'),
    'my_open_incidents', (select count(*) from public.incidents i where i.school_id = v_school and i.created_by = auth.uid() and i.status in ('pending_evaluation', 'new', 'acknowledged', 'assigned', 'in_progress'))
  );

  if v_role = 'school_admin' then
    v_out := v_out || jsonb_build_object(
      'submissions_open', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved'),
      'submissions_hazard_open', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'incident_hazard'),
      'submissions_observation_open', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'observation'),
      'submissions_sentiment_open', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'sentiment'),
      'school_open_reports', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved'),
      'school_open_incidents', (select count(*) from public.incidents i where i.school_id = v_school and i.status in ('pending_evaluation', 'new', 'acknowledged', 'assigned', 'in_progress')),
      'school_pending_evaluation', (select count(*) from public.incidents i where i.school_id = v_school and i.status = 'pending_evaluation'),
      'school_unacknowledged_incidents', (select count(*) from public.incidents i where i.school_id = v_school and i.status in ('pending_evaluation', 'new')),
      'school_oldest_unacknowledged_minutes', (select coalesce(floor(extract(epoch from (now() - min(i.created_at))) / 60)::bigint, 0) from public.incidents i where i.school_id = v_school and i.status in ('pending_evaluation', 'new')),
      'school_check_ins_today', (select count(*) from public.check_ins c where c.school_id = v_school and c.checked_in_at >= current_date),
      'school_need_help', (select count(*) from public.check_ins c where c.school_id = v_school and c.status = 'need_help'),
      'users_total', (select count(*) from public.profiles p where p.school_id = v_school),
      'users_by_role', (select coalesce(jsonb_object_agg(r.role::text, r.n), '{}'::jsonb) from (select p.role, count(*) as n from public.profiles p where p.school_id = v_school group by p.role) r),
      'audit_rows_30d', (select count(*) from public.audit_logs a where a.created_at > now() - interval '30 days')
    );
  end if;
  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Realtime: the map and queue update as soon as a report is saved. Row-level
-- security still applies, so people only receive rows they could already read.
-- ---------------------------------------------------------------------------

do $do$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  begin
    alter publication supabase_realtime add table public.incidents;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.check_ins;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.submissions;
  exception when duplicate_object then null;
  end;
end
$do$;
