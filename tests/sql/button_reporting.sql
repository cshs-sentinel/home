-- Acceptance tests for button-based reporting: the ten incident categories,
-- Pending Evaluation and its workflow, default Priority Index factors, help
-- request routing and triage, the new feelings, duplicate protection, location
-- validation, permissions, and visibility for responders. Everything runs in
-- the shared rolled-back transaction (see tests/database.test.mjs).

-- Fixtures -------------------------------------------------------------------
insert into zz_test.fx select 'school_a', id::text from public.schools where status = 'active' order by created_at limit 1;
insert into public.locations (school_id, parent_id, category_id, name)
select zz_test.f('school_a')::uuid, f.id, (select id from public.location_categories where school_id = f.school_id and name = 'Classroom'), 'ZZ Room ' || n
from (select f.id, f.school_id from public.locations f join public.location_categories fc on fc.id = f.category_id where f.school_id = zz_test.f('school_a')::uuid and f.status = 'active' and fc.level = 3 order by f.name limit 1) f, generate_series(1, 3) n;
insert into zz_test.fx select 'room' || right(name, 1), id::text from public.locations where name like 'ZZ Room %' and school_id = zz_test.f('school_a')::uuid;
update public.locations set status = 'inactive' where id = zz_test.f('room3')::uuid;
insert into zz_test.fx select 'student', id::text from public.user_types where name = 'Student' and school_id = zz_test.f('school_a')::uuid;
update public.user_types set selectable_at_signup = true where id = zz_test.f('student')::uuid;

insert into public.schools (name) values ('ZZ Test School B');
insert into zz_test.fx select 'school_b', id::text from public.schools where name = 'ZZ Test School B';
insert into public.location_categories (school_id, name, level) values (zz_test.f('school_b')::uuid, 'Campus', 1);
insert into public.locations (school_id, category_id, name)
select zz_test.f('school_b')::uuid, id, 'ZZ B Campus' from public.location_categories where school_id = zz_test.f('school_b')::uuid;
insert into zz_test.fx select 'loc_b', id::text from public.locations where school_id = zz_test.f('school_b')::uuid;

select zz_test.reg('zz-ra@test.invalid', zz_test.meta('student', 'room1'));
select zz_test.reg('zz-rb@test.invalid', zz_test.meta('student', 'room1'));
select zz_test.reg('zz-rc@test.invalid', zz_test.meta('student', 'room1'));
select zz_test.reg('zz-rd@test.invalid', zz_test.meta('student', 'room1'));
select zz_test.reg('zz-pending@test.invalid', zz_test.meta('student', 'room1'), '{}'::jsonb, false);

-- Helpers specific to this script ----------------------------------------------
create function zz_test.own(p_sql text) returns text language plpgsql security definer as $f$
begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;

create table zz_test.expect (category text primary key, s int, u int, a int, lvl text);
insert into zz_test.expect values
  ('fire_smoke', 4, 4, 4, 'critical'), ('threat_violence', 4, 4, 3, 'high'), ('suspicious_person', 3, 4, 3, 'high'),
  ('injury_accident', 3, 4, 2, 'high'), ('structural_damage', 3, 3, 3, 'high'), ('electrical_hazard', 3, 3, 2, 'moderate'),
  ('water_chemical_spill', 2, 3, 2, 'moderate'), ('bullying', 3, 2, 1, 'moderate'), ('unsafe_facility', 2, 2, 2, 'moderate'),
  ('other_concern', 2, 2, 1, 'low');
create table zz_test.hexpect (t text primary key, triage text);
insert into zz_test.hexpect values
  ('emergency_help', 'urgent'), ('medical_assistance', 'urgent'), ('safety_assistance', 'urgent'),
  ('counseling_support', 'awaiting_triage'), ('accessibility_assistance', 'awaiting_triage'), ('other_help', 'awaiting_triage');
create table zz_test.fexpect (f text primary key, stress int);
insert into zz_test.fexpect values ('good', 1), ('okay', 2), ('not_good', 3), ('upset', 4), ('unsafe', 5), ('need_support', 5);
grant all on all tables in schema zz_test to public;

-- One incident per category as the current account; reports anything that was
-- refused or got the wrong status or default factors. Earlier ones are cancelled
-- first so the one-open-incident rule does not get in the way.
create function zz_test.incident_loop() returns text language plpgsql as $f$
declare e record; r text; v_fail text := ''; v_row text;
begin
  for e in select * from zz_test.expect order by category loop
    perform zz_test.own(format('update public.incidents set status = ''cancelled'' where created_by = %L and status <> ''cancelled''', auth.uid()));
    r := zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, %L, %L, %L) $q$,
      zz_test.f('school_a'), e.category, zz_test.f('room1'), 'ZZ ' || e.category));
    if r <> 'ok' then v_fail := v_fail || e.category || ' refused: ' || r || '; '; continue; end if;
    v_row := zz_test.sval(format($q$ select priority_severity || '/' || priority_urgency || '/' || priority_affected || '/' || priority_level || '/' || status from public.incidents where description = %L $q$, 'ZZ ' || e.category));
    if v_row <> format('%s/%s/%s/%s/pending_evaluation', e.s, e.u, e.a, e.lvl) then v_fail := v_fail || e.category || ' got ' || v_row || '; '; end if;
  end loop;
  return coalesce(nullif(v_fail, ''), 'ok');
end $f$;

create function zz_test.help_loop() returns text language plpgsql as $f$
declare e record; r text; v_fail text := ''; v_row text;
begin
  for e in select * from zz_test.hexpect order by t loop
    perform zz_test.own(format('update public.check_ins set checked_in_at = now() - interval ''1 hour'' where profile_id = %L', auth.uid()));
    -- the browser asks for "resolved"; routing is decided by the database
    r := zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status, help_type, triage_status) values (%L, %L, 'self_selected', 'need_help', %L, 'resolved') $q$,
      zz_test.f('school_a'), zz_test.f('room1'), e.t));
    if r <> 'ok' then v_fail := v_fail || e.t || ' refused: ' || r || '; '; continue; end if;
    v_row := zz_test.sval(format($q$ select triage_status from public.check_ins where profile_id = %L and help_type = %L $q$, auth.uid(), e.t));
    if v_row <> e.triage then v_fail := v_fail || e.t || ' got ' || v_row || '; '; end if;
  end loop;
  return coalesce(nullif(v_fail, ''), 'ok');
end $f$;

create function zz_test.feeling_loop() returns text language plpgsql as $f$
declare e record; r text; v_fail text := ''; v_row text;
begin
  for e in select * from zz_test.fexpect order by f loop
    r := zz_test.try(format($q$ insert into public.submissions (school_id, kind, sub_type, location_id, message) values (%L, 'sentiment', %L, %L, %L) $q$,
      zz_test.f('school_a'), e.f, zz_test.f('room1'), 'Feeling ' || e.f));
    if r <> 'ok' then v_fail := v_fail || e.f || ' refused: ' || r || '; '; continue; end if;
    v_row := zz_test.sval(format($q$ select stress_level::text from public.submissions where message = %L $q$, 'Feeling ' || e.f));
    if v_row <> e.stress::text then v_fail := v_fail || e.f || ' stress ' || v_row || '; '; end if;
  end loop;
  return coalesce(nullif(v_fail, ''), 'ok');
end $f$;
grant execute on all functions in schema zz_test to public;

select zz_test.rec('B00 fixtures: school, rooms, second school, five accounts',
  zz_test.f('school_a') is not null and zz_test.f('room1') is not null and zz_test.f('room3') is not null and zz_test.f('loc_b') is not null
  and zz_test.uid('zz-ra@test.invalid') is not null and zz_test.uid('zz-pending@test.invalid') is not null, '');

-- Incident categories, Pending Evaluation, default priority --------------------
-- Test accounts, created inside this rolled-back transaction (demo logins are retired).
reset role;
select zz_test.reg('zz-sa@test.invalid', jsonb_build_object('provision_secret', zz_test.sval('select secret from public._provision_secrets'), 'designation_id', (select id from public.user_types where name = 'School Admin' and school_id = zz_test.f('school_a')::uuid), 'display_name', 'ZZ School Admin'));
select zz_test.use('zz-ra@test.invalid');
insert into zz_test.fx values ('r_incident_loop', zz_test.incident_loop());
select zz_test.rec('B01 all ten category buttons save, start as Pending Evaluation, and get their default S/U/A',
  zz_test.f('r_incident_loop') = 'ok', zz_test.f('r_incident_loop'));

select zz_test.rec('B02 Fire / Smoke defaults to 4+4+4 = 12 (critical)',
  zz_test.sval($q$ select priority_index || '/' || priority_level from public.incidents where description = 'ZZ fire_smoke' $q$) = '12/critical',
  zz_test.sval($q$ select priority_index || '/' || priority_level from public.incidents where description = 'ZZ fire_smoke' $q$));

select zz_test.use('zz-rc@test.invalid');
select zz_test.rec('B03 the reporter cannot choose the status or the priority (sent: new, 1/1/1 -> pending, 4/4/4)',
  zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description, status, priority_severity, priority_urgency, priority_affected, priority_set_by) values (%L, 'fire_smoke', %L, 'ZZ cheat', 'new', 1, 1, 1, auth.uid()) $q$, zz_test.f('school_a'), zz_test.f('room2'))) = 'ok'
  and zz_test.val($q$ select status || '/' || priority_severity || priority_urgency || priority_affected || '/' || coalesce(priority_set_by::text, 'system') from public.incidents where description = 'ZZ cheat' $q$) = 'pending_evaluation/444/system',
  zz_test.val($q$ select status || '/' || priority_severity || priority_urgency || priority_affected || '/' || coalesce(priority_set_by::text, 'system') from public.incidents where description = 'ZZ cheat' $q$));

select zz_test.use('zz-rd@test.invalid');
select zz_test.rec('B04 a category that is not one of the buttons (Severe Weather) is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'severe_weather', %L, 'ZZ weather') $q$, zz_test.f('school_a'), zz_test.f('room1'))), ''), '');
select zz_test.rec('B05 a button incident without a location is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.incidents (school_id, category, description) values (%L, 'bullying', 'ZZ nowhere') $q$, zz_test.f('school_a'))), 'choose where'), '');
select zz_test.rec('B06 an incident at an inactive place is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'bullying', %L, 'ZZ inactive') $q$, zz_test.f('school_a'), zz_test.f('room3'))), 'not active'), '');
select zz_test.rec('B07 an incident at another school''s place is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'bullying', %L, 'ZZ other school') $q$, zz_test.f('school_a'), zz_test.f('loc_b'))), 'different school'), '');
select zz_test.rec('B08 the actual place is stored; the default place is not assumed',
  zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'unsafe_facility', %L, 'ZZ elsewhere') $q$, zz_test.f('school_a'), zz_test.f('room2'))) = 'ok'
  and zz_test.val($q$ select location_id::text from public.incidents where description = 'ZZ elsewhere' $q$) = zz_test.f('room2')
  and zz_test.sval($q$ select primary_location_id::text from public.profiles where id = auth.uid() $q$) = zz_test.f('room1'), '');
select zz_test.rec('B09 duplicate protection: a second open incident within five minutes is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'bullying', %L, 'ZZ twice') $q$, zz_test.f('school_a'), zz_test.f('room1'))), 'already have an open incident'), '');

-- Pending accounts cannot report ------------------------------------------------
select zz_test.use('zz-pending@test.invalid');
select zz_test.rec('B10 an account still waiting for approval cannot report an incident',
  zz_test.refused(zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'bullying', %L, 'ZZ pending') $q$, zz_test.f('school_a'), zz_test.f('room1'))), 'row-level security'), '');
select zz_test.rec('B11 ... or ask for help, or share a feeling',
  zz_test.refused(zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status, help_type) values (%L, %L, 'self_selected', 'need_help', 'other_help') $q$, zz_test.f('school_a'), zz_test.f('room1'))), 'row-level security')
  and zz_test.refused(zz_test.try(format($q$ insert into public.submissions (school_id, kind, sub_type, location_id, message) values (%L, 'sentiment', 'good', %L, 'ZZ pending feeling') $q$, zz_test.f('school_a'), zz_test.f('room1'))), 'row-level security'), '');

-- Help requests -----------------------------------------------------------------
select zz_test.use('zz-ra@test.invalid');
insert into zz_test.fx values ('r_help_loop', zz_test.help_loop());
select zz_test.rec('B12 all six help buttons save and are routed: emergency, medical, safety -> urgent; the rest -> awaiting triage',
  zz_test.f('r_help_loop') = 'ok', zz_test.f('r_help_loop'));
select zz_test.use('zz-rb@test.invalid');
select zz_test.rec('B13 a typed help request without a location is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.check_ins (school_id, location_source, status, help_type) values (%L, 'self_selected', 'need_help', 'medical_assistance') $q$, zz_test.f('school_a'))), 'choose where'), '');
select zz_test.rec('B14 a help request at an inactive place is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status, help_type) values (%L, %L, 'self_selected', 'need_help', 'medical_assistance') $q$, zz_test.f('school_a'), zz_test.f('room3'))), 'not active'), '');
select zz_test.rec('B15 a help request is saved with the chosen place and Emergency Help is urgent',
  zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status, help_type) values (%L, %L, 'self_selected', 'need_help', 'emergency_help') $q$, zz_test.f('school_a'), zz_test.f('room2'))) = 'ok'
  and zz_test.val($q$ select location_id::text || '/' || triage_status from public.check_ins where profile_id = auth.uid() and help_type = 'emergency_help' $q$) = zz_test.f('room2') || '/urgent', '');
select zz_test.rec('B16 duplicate protection: a second help request within two minutes is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status, help_type) values (%L, %L, 'self_selected', 'need_help', 'other_help') $q$, zz_test.f('school_a'), zz_test.f('room2'))), 'already asked for help'), '');
select zz_test.use('zz-rd@test.invalid');
select zz_test.rec('B17 the older untyped "I need help" is treated as Emergency Help (urgent)',
  zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status) values (%L, %L, 'self_selected', 'need_help') $q$, zz_test.f('school_a'), zz_test.f('room1'))) = 'ok'
  and zz_test.val($q$ select help_type || '/' || triage_status from public.check_ins where profile_id = auth.uid() and status = 'need_help' $q$) = 'emergency_help/urgent', '');
select zz_test.rec('B18 a safe check-in carries no help type or triage status, whatever was sent',
  zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status, help_type, triage_status) values (%L, %L, 'self_selected', 'safe', 'emergency_help', 'urgent') $q$, zz_test.f('school_a'), zz_test.f('room1'))) = 'ok'
  and zz_test.val($q$ select coalesce(help_type, 'none') || '/' || coalesce(triage_status, 'none') from public.check_ins where profile_id = auth.uid() and status = 'safe' $q$) = 'none/none', '');

-- Feelings ----------------------------------------------------------------------
select zz_test.use('zz-ra@test.invalid');
insert into zz_test.fx values ('r_feeling_loop', zz_test.feeling_loop());
select zz_test.rec('B19 the six feelings save with no stress question; stress is derived (1, 2, 3, 4, 5, 5)',
  zz_test.f('r_feeling_loop') = 'ok', zz_test.f('r_feeling_loop'));
select zz_test.rec('B20 a feeling that is not one of the buttons is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.submissions (school_id, kind, sub_type, location_id, message) values (%L, 'sentiment', 'ecstatic', %L, 'ZZ bad feeling') $q$, zz_test.f('school_a'), zz_test.f('room1'))), '')
  and zz_test.sval($q$ select count(*) from public.submissions where message = 'ZZ bad feeling' $q$) = '0', '');
select zz_test.rec('B21 an older feeling with a stress level still saves',
  zz_test.try(format($q$ insert into public.submissions (school_id, kind, sub_type, emotion, stress_level, location_id, message) values (%L, 'sentiment', 'stressed', 'stressed', 4, %L, 'ZZ legacy feeling') $q$, zz_test.f('school_a'), zz_test.f('room1'))) = 'ok', '');

-- Permissions: community members only see their own ------------------------------
select zz_test.use('zz-rb@test.invalid');
select zz_test.rec('B22 a Community Member sees only their own incidents and help requests',
  zz_test.val($q$ select count(*) from public.incidents where created_by is distinct from auth.uid() $q$) = '0'
  and zz_test.val($q$ select count(*) from public.check_ins where profile_id is distinct from auth.uid() $q$) = '0', '');
select zz_test.rec('B23 a Community Member cannot read submissions, triage help, or set a priority',
  zz_test.val($q$ select count(*) from public.submissions $q$) = '0'
  and zz_test.refused(zz_test.try($q$ select public.triage_help_request((select id from public.check_ins where help_type = 'emergency_help' limit 1), 'responding') $q$), '')
  and zz_test.refused(zz_test.try($q$ select public.set_incident_priority((select id from public.incidents limit 1), 1, 1, 1) $q$), ''), '');
select zz_test.use('zz-rd@test.invalid');
select zz_test.rec('B24 a Community Member cannot validate an incident',
  zz_test.refused(zz_test.try($q$ select public.transition_incident((select id from public.incidents where description = 'ZZ elsewhere'), 'acknowledged', null) $q$), 'not allowed'), '');
select zz_test.use('zz-rc@test.invalid');
select zz_test.rec('B25 the reporter can cancel their own report while it is pending',
  zz_test.try($q$ select public.transition_incident((select id from public.incidents where description = 'ZZ cheat'), 'cancelled', 'Cancelled by reporter') $q$) = 'ok', '');

-- Responders: notification, visibility, validate, dismiss, triage ----------------
select zz_test.use('zz-sa@test.invalid');
select zz_test.rec('B26 a School Admin sees every pending report, including other people''s',
  zz_test.val($q$ select count(*) from public.incidents where status = 'pending_evaluation' $q$)::int >= 2, zz_test.val($q$ select count(*) from public.incidents where status = 'pending_evaluation' $q$));
select zz_test.rec('B27 a School Admin sees help requests, with their type and triage status, at once',
  zz_test.val($q$ select count(*) from public.check_ins where status = 'need_help' and help_type is not null and triage_status = 'urgent' $q$)::int >= 4, zz_test.val($q$ select count(*) from public.check_ins where status = 'need_help' and triage_status = 'urgent' $q$));
select zz_test.rec('B28 staff are notified of every report waiting for evaluation',
  zz_test.val($q$ select count(*) from public.incident_notifications where title like 'Report to evaluate%' $q$)::int >= 10, zz_test.val($q$ select count(*) from public.incident_notifications where title like 'Report to evaluate%' $q$));
select zz_test.rec('B29 the dashboard counts Pending Evaluation separately',
  zz_test.val($q$ select (public.dashboard_counts() ->> 'school_pending_evaluation') $q$)::int >= 1, zz_test.val($q$ select (public.dashboard_counts() ->> 'school_pending_evaluation') $q$));
select zz_test.rec('B30 a School Admin validates a pending report: it becomes acknowledged and the history is kept',
  zz_test.try($q$ select public.transition_incident((select id from public.incidents where description = 'ZZ water_chemical_spill'), 'acknowledged', 'Validated') $q$) = 'ok'
  and zz_test.val($q$ select status from public.incidents where description = 'ZZ water_chemical_spill' $q$) = 'acknowledged'
  and zz_test.val($q$ select count(*) from public.incident_status_history h join public.incidents i on i.id = h.incident_id where i.description = 'ZZ water_chemical_spill' and h.from_status = 'pending_evaluation' $q$) = '1', '');
select zz_test.rec('B31 a School Admin dismisses an invalid report: it is cancelled with a reason, not deleted',
  zz_test.try($q$ select public.transition_incident((select id from public.incidents where description = 'ZZ elsewhere'), 'cancelled', 'Dismissed after evaluation') $q$) = 'ok'
  and zz_test.val($q$ select status || '/' || cancelled_reason from public.incidents where description = 'ZZ elsewhere' $q$) = 'cancelled/Dismissed after evaluation', '');
select zz_test.rec('B32 a dismissed report cannot be validated afterwards',
  zz_test.refused(zz_test.try($q$ select public.transition_incident((select id from public.incidents where description = 'ZZ elsewhere'), 'acknowledged', null) $q$), 'not allowed'), '');
select zz_test.rec('B33 a School Admin can confirm or change the default priority',
  zz_test.try($q$ select public.set_incident_priority((select id from public.incidents where description = 'ZZ water_chemical_spill'), 4, 3, 2) $q$) = 'ok'
  and zz_test.val($q$ select priority_index || '/' || priority_level || '/' || (priority_set_by is not null)::text from public.incidents where description = 'ZZ water_chemical_spill' $q$) = '9/high/true', '');
select zz_test.rec('B34 a School Admin takes a help request: responding, then resolved; resolved cannot reopen',
  zz_test.try($q$ select public.triage_help_request((select id from public.check_ins where help_type = 'emergency_help' and profile_id = zz_test.uid('zz-ra@test.invalid')), 'responding') $q$) = 'ok'
  and zz_test.val($q$ select triage_status from public.check_ins where help_type = 'emergency_help' and profile_id = zz_test.uid('zz-ra@test.invalid') $q$) = 'responding'
  and zz_test.try($q$ select public.triage_help_request((select id from public.check_ins where help_type = 'emergency_help' and profile_id = zz_test.uid('zz-ra@test.invalid')), 'resolved') $q$) = 'ok'
  and zz_test.refused(zz_test.try($q$ select public.triage_help_request((select id from public.check_ins where help_type = 'emergency_help' and profile_id = zz_test.uid('zz-ra@test.invalid')), 'responding') $q$), 'already resolved'), '');
select zz_test.rec('B35 triage accepts only responding or resolved',
  zz_test.refused(zz_test.try($q$ select public.triage_help_request((select id from public.check_ins where help_type = 'other_help' and profile_id = zz_test.uid('zz-ra@test.invalid')), 'urgent') $q$), 'responding or resolved'), '');
select zz_test.rec('B36 a School Admin''s own report goes straight into the workflow (new), not pending',
  zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'electrical_hazard', %L, 'ZZ admin report') $q$, zz_test.f('school_a'), zz_test.f('room2'))) = 'ok'
  and zz_test.val($q$ select status from public.incidents where description = 'ZZ admin report' $q$) = 'new', '');
select zz_test.rec('B37 a School Admin reads the new feelings, including Unsafe and Need Support',
  zz_test.val($q$ select count(*) from public.submissions where sub_type in ('unsafe', 'need_support') and kind = 'sentiment' $q$)::int >= 2, '');

-- Plumbing ----------------------------------------------------------------------
reset role;
select zz_test.rec('B38 incidents, help requests, and submissions are published to realtime (the map updates at once)',
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('incidents', 'check_ins', 'submissions')) = 3,
  (select string_agg(tablename, ',') from pg_publication_tables where pubname = 'supabase_realtime'));
select zz_test.rec('B39 legacy categories keep sensible default factors (emergency 4+4+2, medical 3+4+1)',
  public.default_incident_priority('emergency') = array[4, 4, 2]::smallint[] and public.default_incident_priority('medical') = array[3, 4, 1]::smallint[]
  and public.default_incident_priority('other') = array[2, 2, 1]::smallint[], '');
select zz_test.rec('B40 every default stays inside the 1-4 scale and the class matches 3-5 / 6-8 / 9-11 / 12',
  (select count(*) from zz_test.expect where s not between 1 and 4 or u not between 1 and 4 or a not between 1 and 4
     or lvl <> case when s + u + a >= 12 then 'critical' when s + u + a >= 9 then 'high' when s + u + a >= 6 then 'moderate' else 'low' end) = 0, '');
