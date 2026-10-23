-- Acceptance tests for the Classroom Adviser: approving pending sign-ups for
-- their own location only, and nothing else. Runs in the shared rolled-back
-- transaction (see tests/database.test.mjs).

-- Fixtures -------------------------------------------------------------------
insert into zz_test.fx select 'school_a', id::text from public.schools where status = 'active' order by created_at limit 1;
insert into public.locations (school_id, parent_id, category_id, name)
select zz_test.f('school_a')::uuid, f.id, (select id from public.location_categories where school_id = f.school_id and name = 'Classroom'), 'ZZ Room ' || n
from public.locations f, generate_series(1, 2) n
where f.school_id = zz_test.f('school_a')::uuid and f.name = '1st Floor';
insert into zz_test.fx select 'room' || right(name, 1), id::text from public.locations where name like 'ZZ Room %' and school_id = zz_test.f('school_a')::uuid;
insert into zz_test.fx select 'student', id::text from public.user_types where name = 'Student' and school_id = zz_test.f('school_a')::uuid;
insert into zz_test.fx select 'adviser', id::text from public.user_types where name = 'Classroom Adviser' and school_id = zz_test.f('school_a')::uuid;
update public.user_types set selectable_at_signup = true where id = zz_test.f('student')::uuid;

-- The adviser is added the way Add Person does it: the provision secret in user metadata.
select zz_test.reg('zz-adviser@test.invalid', jsonb_build_object(
  'provision_secret', zz_test.sval('select secret from public._provision_secrets'),
  'designation_id', zz_test.f('adviser'), 'default_location_id', zz_test.f('room1'), 'display_name', 'ZZ Adviser'));
select zz_test.reg('zz-plain@test.invalid', zz_test.meta('student', 'room1') || '{"display_name":"ZZ Plain Member"}');
select zz_test.reg('zz-pend-a@test.invalid', zz_test.meta('student', 'room1') || '{"display_name":"ZZ Pend A"}', '{}'::jsonb, false);
select zz_test.reg('zz-pend-b@test.invalid', zz_test.meta('student', 'room2') || '{"display_name":"ZZ Pend B"}', '{}'::jsonb, false);
select zz_test.reg('zz-pend-off@test.invalid', zz_test.meta('student', 'room1') || '{"display_name":"ZZ Pend Off"}', '{}'::jsonb, false);
update public.profiles set is_active = false where id = zz_test.uid('zz-pend-off@test.invalid');

select zz_test.rec('C00 fixtures: adviser at room 1, two pending sign-ups (rooms 1 and 2), one switched-off pending account',
  zz_test.val($q$ select (role::text || '/' || status || '/' || primary_location_id::text) from public.profiles where id = zz_test.uid('zz-adviser@test.invalid') $q$) = 'community/approved/' || zz_test.f('room1')
  and zz_test.val($q$ select status from public.profiles where id = zz_test.uid('zz-pend-a@test.invalid') $q$) = 'pending', '');

-- The adviser sees only their own location's active pending accounts ---------------
select zz_test.use('zz-adviser@test.invalid');
select zz_test.rec('C01 the adviser lists only active pending accounts at their own location',
  zz_test.val($q$ select string_agg(display_name, ',' order by display_name) from public.pending_in_my_location() $q$) = 'ZZ Pend A',
  zz_test.val($q$ select string_agg(display_name, ',' order by display_name) from public.pending_in_my_location() $q$));
select zz_test.rec('C02 the adviser approves a pending account at their own location, and it is logged',
  zz_test.try($q$ select public.approve_registration(zz_test.uid('zz-pend-a@test.invalid')) $q$) = 'ok'
  and zz_test.sval($q$ select status from public.profiles where id = zz_test.uid('zz-pend-a@test.invalid') $q$) = 'approved'
  and zz_test.sval($q$ select count(*) from public.audit_logs where action = 'registration_approved' and actor_id = auth.uid() $q$) = '1', '');
select zz_test.rec('C03 the adviser cannot approve or decline someone at another location',
  zz_test.refused(zz_test.try($q$ select public.approve_registration(zz_test.uid('zz-pend-b@test.invalid')) $q$), 'own location')
  and zz_test.refused(zz_test.try($q$ select public.reject_registration(zz_test.uid('zz-pend-b@test.invalid')) $q$), 'own location')
  and zz_test.sval($q$ select status from public.profiles where id = zz_test.uid('zz-pend-b@test.invalid') $q$) = 'pending', '');
select zz_test.rec('C04 the adviser has none of the School Admin powers: no roster, no positions, no setup',
  zz_test.val($q$ select count(*) from public.profiles $q$) = '1'
  and zz_test.refused(zz_test.try(format($q$ select public.admin_set_user_type(zz_test.uid('zz-plain@test.invalid'), %L) $q$, zz_test.f('student'))), 'administrator required')
  and zz_test.refused(zz_test.try($q$ insert into public.user_types (school_id, name, base_role, features) values (zz_test.f('school_a')::uuid, 'ZZ grab', 'community', '{}') $q$), ''), '');
select zz_test.rec('C05 the adviser reads no one else''s incidents, help requests, or feelings',
  zz_test.val($q$ select count(*) from public.incidents where created_by is distinct from auth.uid() $q$) = '0'
  and zz_test.val($q$ select count(*) from public.check_ins where profile_id is distinct from auth.uid() $q$) = '0'
  and zz_test.val($q$ select count(*) from public.submissions $q$) = '0', '');

-- A plain Community Member gets nothing from the same functions ---------------------
select zz_test.use('zz-plain@test.invalid');
select zz_test.rec('C06 a Community Member without the ability lists nothing and cannot approve',
  zz_test.val($q$ select count(*) from public.pending_in_my_location() $q$) = '0'
  and zz_test.refused(zz_test.try($q$ select public.approve_registration(zz_test.uid('zz-pend-b@test.invalid')) $q$), 'permission denied'), '');

-- A School Admin still approves anywhere in the school ------------------------------
select zz_test.use('demo.schooladmin@sentinel.test');
select zz_test.rec('C07 a School Admin approves a pending account at any location',
  zz_test.try($q$ select public.approve_registration(zz_test.uid('zz-pend-b@test.invalid')) $q$) = 'ok'
  and zz_test.val($q$ select status from public.profiles where id = zz_test.uid('zz-pend-b@test.invalid') $q$) = 'approved', '');
