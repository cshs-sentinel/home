-- Acceptance tests for the three-role model, registration, designations and
-- default location. Runs against the live schema but never keeps anything:
-- every test row is created inside one transaction, and the last statement
-- raises an error carrying the results, so the transaction always rolls back.
-- Run with:  npm run test:db

-- Fixtures -------------------------------------------------------------------
insert into zz_test.fx select 'school_a', id::text from public.schools where status = 'active' order by created_at limit 1;
-- Four throwaway rooms under the school's first floor (rolled back with everything else).
insert into public.locations (school_id, parent_id, category_id, name)
select zz_test.f('school_a')::uuid, f.id, (select id from public.location_categories where school_id = f.school_id and name = 'Classroom'), 'ZZ Room ' || n
from (select f.id, f.school_id from public.locations f join public.location_categories fc on fc.id = f.category_id where f.school_id = zz_test.f('school_a')::uuid and f.status = 'active' and fc.level = 3 order by f.name limit 1) f, generate_series(1, 4) n;
insert into zz_test.fx select 'room' || right(name, 1), id::text from public.locations where name like 'ZZ Room %' and school_id = zz_test.f('school_a')::uuid;
update public.locations set status = 'inactive' where id = zz_test.f('room3')::uuid;
update public.locations set access_level = 'restricted' where id = zz_test.f('room4')::uuid;
insert into zz_test.fx select 'student', id::text from public.user_types where name = 'Student' and school_id = zz_test.f('school_a')::uuid;
insert into zz_test.fx select 'teacher', id::text from public.user_types where name = 'Teacher' and school_id = zz_test.f('school_a')::uuid;
insert into zz_test.fx select 'nonteaching', id::text from public.user_types where name = 'Non-Teaching Staff' and school_id = zz_test.f('school_a')::uuid;
insert into zz_test.fx select 'school_admin_t', id::text from public.user_types where name = 'School Admin' and school_id = zz_test.f('school_a')::uuid;
insert into zz_test.fx select 'system_admin_t', id::text from public.user_types where name = 'System Admin' and school_id = zz_test.f('school_a')::uuid;
update public.user_types set selectable_at_signup = true where id in (zz_test.f('student')::uuid, zz_test.f('teacher')::uuid);
-- Sign-up is open by default now; this one position is closed so the 'not open' rule can be tested.
update public.user_types set selectable_at_signup = false where id = zz_test.f('nonteaching')::uuid;

insert into public.schools (name) values ('ZZ Test School B');
insert into zz_test.fx select 'school_b', id::text from public.schools where name = 'ZZ Test School B';
insert into public.location_categories (school_id, name, level) values (zz_test.f('school_b')::uuid, 'Campus', 1);
insert into public.locations (school_id, category_id, name)
select zz_test.f('school_b')::uuid, id, 'ZZ B Campus' from public.location_categories where school_id = zz_test.f('school_b')::uuid;
insert into zz_test.fx select 'loc_b', id::text from public.locations where school_id = zz_test.f('school_b')::uuid;
insert into public.user_types (school_id, name, base_role, features, selectable_at_signup)
values (zz_test.f('school_b')::uuid, 'ZZ B Student', 'community', '{report.safe}', true);
insert into zz_test.fx select 'student_b', id::text from public.user_types where school_id = zz_test.f('school_b')::uuid;
select zz_test.reg('zz-b@test.invalid', zz_test.meta('student_b', 'loc_b'));
insert into public.submissions (school_id, submitted_by, kind, sub_type, message)
select zz_test.f('school_b')::uuid, id, 'observation', 'suggestion', 'ZZ school B secret' from auth.users where email = 'zz-b@test.invalid';

select zz_test.rec('T00 fixtures: school, 4 places, 5 positions, a second school',
  zz_test.f('school_a') is not null and zz_test.f('room4') is not null and zz_test.f('student') is not null and zz_test.f('system_admin_t') is not null
  and zz_test.f('school_admin_t') is not null and zz_test.f('loc_b') is not null and zz_test.f('nonteaching') is not null,
  'rooms found: ' || (select count(*) from zz_test.fx where k like 'room%')::text);

-- 1. Three fixed primary roles ------------------------------------------------
select zz_test.rec('T01 only the three primary roles are stored on accounts',
  (select count(*) from public.profiles where role::text not in ('system_admin', 'school_admin', 'community')) = 0,
  (select string_agg(distinct role::text, ',') from public.profiles));
select zz_test.rec('T02 only the three primary roles are stored on positions',
  (select count(*) from public.user_types where base_role::text not in ('system_admin', 'school_admin', 'community')) = 0, '');
select zz_test.rec('T03 an old role label (teacher) can no longer be stored',
  zz_test.refused(zz_test.try($q$ update public.profiles set role = 'teacher' where id = (select id from public.profiles limit 1) $q$), 'check'),
  zz_test.try($q$ update public.profiles set role = 'teacher' where id = (select id from public.profiles limit 1) $q$));
select zz_test.rec('T04 a position cannot carry features above its role (community + queue.view)',
  zz_test.refused(zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role, features) values (%L, 'ZZ over', 'community', '{queue.view}') $q$, zz_test.f('school_a'))), 'not allowed for the community role'),
  zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role, features) values (%L, 'ZZ over2', 'community', '{queue.view}') $q$, zz_test.f('school_a'))));

-- 2. Registration: the database decides the role -------------------------------
select zz_test.reg('zz-one@test.invalid', zz_test.meta('student', 'room1')) as registered;
select zz_test.rec('T05 valid registration creates a Community Member with the chosen position and default place',
  zz_test.uid('zz-one@test.invalid') is not null
  and zz_test.val($q$ select (p.role::text = 'community' and p.user_type_id = zz_test.f('student')::uuid and p.primary_location_id = zz_test.f('room1')::uuid and p.school_id = zz_test.f('school_a')::uuid)::text from public.profiles p where p.id = zz_test.uid('zz-one@test.invalid') $q$) = 'true',
  zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-one@test.invalid') $q$));
select zz_test.reg('zz-two@test.invalid', zz_test.meta('student', 'room1') || '{"role":"system_admin","base_role":"school_admin","app_role":"system_admin"}') as registered;
select zz_test.rec('T06 a submitted role is ignored (system_admin / school_admin in metadata)',
  zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-two@test.invalid') $q$) = 'community', zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-two@test.invalid') $q$));
select zz_test.rec('T07 registering as a School Admin position is refused',
  zz_test.refused(zz_test.reg('zz-three@test.invalid', zz_test.meta('school_admin_t', 'room1')), 'not open for registration'),
  zz_test.reg('zz-three2@test.invalid', zz_test.meta('school_admin_t', 'room1')));
select zz_test.rec('T08 registering as a System Admin position is refused',
  zz_test.refused(zz_test.reg('zz-four@test.invalid', zz_test.meta('system_admin_t', 'room1')), 'not open for registration'),
  zz_test.reg('zz-four2@test.invalid', zz_test.meta('system_admin_t', 'room1')));
select zz_test.rec('T09 registration without a default location is refused',
  zz_test.refused(zz_test.reg('zz-five@test.invalid', jsonb_build_object('display_name', 'No Place', 'designation_id', zz_test.f('student'), 'id_number', 'ZZ-1', 'gender', 'other')), 'valid'),
  zz_test.reg('zz-five2@test.invalid', jsonb_build_object('display_name', 'No Place', 'designation_id', zz_test.f('student'), 'id_number', 'ZZ-1', 'gender', 'other')));
select zz_test.rec('T10 registration with an inactive place is refused',
  zz_test.refused(zz_test.reg('zz-six@test.invalid', zz_test.meta('student', 'room3')), 'valid default location'),
  zz_test.reg('zz-six2@test.invalid', zz_test.meta('student', 'room3')));
select zz_test.rec('T11 registration with a restricted place is refused',
  zz_test.refused(zz_test.reg('zz-seven@test.invalid', zz_test.meta('student', 'room4')), 'valid default location'),
  zz_test.reg('zz-seven2@test.invalid', zz_test.meta('student', 'room4')));
select zz_test.rec('T12 registration with another school''s place is refused (school isolation)',
  zz_test.refused(zz_test.reg('zz-eight@test.invalid', zz_test.meta('student', 'loc_b')), 'valid default location'),
  zz_test.reg('zz-eight2@test.invalid', zz_test.meta('student', 'loc_b')));
select zz_test.rec('T13 registration with a position that is not open for sign-up is refused',
  zz_test.refused(zz_test.reg('zz-nine@test.invalid', zz_test.meta('nonteaching', 'room1')), 'not open for registration'),
  zz_test.reg('zz-nine2@test.invalid', zz_test.meta('nonteaching', 'room1')));
select zz_test.rec('T14 registration without details is refused, and user metadata cannot claim "provisioned"',
  zz_test.refused(zz_test.reg('zz-ten@test.invalid', '{}'::jsonb), 'needs a designation')
  and zz_test.refused(zz_test.reg('zz-ten2@test.invalid', '{"provisioned":"admin"}'::jsonb), 'needs a designation'), '');
select zz_test.reg('zz-eleven@test.invalid', jsonb_build_object('provision_secret', zz_test.sval('select secret from public._provision_secrets'))) as registered;
select zz_test.rec('T15 admin-provisioned accounts (provision secret, service key only) become Community Members',
  zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-eleven@test.invalid') $q$) = 'community', zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-eleven@test.invalid') $q$));
update public.user_types set is_active = false where id = zz_test.f('teacher')::uuid;
select zz_test.rec('T16 a turned-off position is refused',
  zz_test.refused(zz_test.reg('zz-twelve@test.invalid', zz_test.meta('teacher', 'room1')), 'not open for registration'), '');
update public.user_types set is_active = true where id = zz_test.f('teacher')::uuid;
select zz_test.rec('T17 registration is written to the activity log',
  (select count(*) from public.audit_logs where action = 'user_registered' and payload ->> 'designation' = 'Student') >= 1, '');

-- 3. What the public sign-up form can see ----------------------------------------
select zz_test.use_anon();
select zz_test.rec('T18 visitors get only open Community positions and usable places',
  (select jsonb_array_length(public.registration_options() -> 'designations')) >= 2
  and not (public.registration_options() -> 'designations')::text ilike '%School Admin%'
  and not (public.registration_options() -> 'designations')::text ilike '%System Admin%'
  and not (public.registration_options() -> 'locations')::text ilike '%' || zz_test.f('room3') || '%'
  and not (public.registration_options() -> 'locations')::text ilike '%' || zz_test.f('room4') || '%',
  (select jsonb_array_length(public.registration_options() -> 'designations')::text) || ' open positions');
select zz_test.rec('T19 visitors cannot read profiles',
  zz_test.refused(zz_test.try('select count(*) from public.profiles'), 'permission denied'), '');
select zz_test.rec('T20 visitors cannot change a default location',
  zz_test.refused(zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('room1'))), 'permission denied'),
  zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('room1'))));

-- 4. Community Member cannot elevate themselves ------------------------------------
-- Test accounts, created inside this rolled-back transaction (demo logins are retired).
reset role;
select zz_test.reg('zz-member@test.invalid', jsonb_build_object('provision_secret', zz_test.sval('select secret from public._provision_secrets'), 'designation_id', (select id from public.user_types where name = 'Student' and school_id = zz_test.f('school_a')::uuid), 'display_name', 'ZZ Member'));
select zz_test.reg('zz-sa@test.invalid', jsonb_build_object('provision_secret', zz_test.sval('select secret from public._provision_secrets'), 'designation_id', (select id from public.user_types where name = 'School Admin' and school_id = zz_test.f('school_a')::uuid), 'display_name', 'ZZ School Admin'));
select zz_test.reg('zz-sys@test.invalid', jsonb_build_object('provision_secret', zz_test.sval('select secret from public._provision_secrets'), 'designation_id', (select id from public.user_types where name = 'System Admin' and school_id = zz_test.f('school_a')::uuid), 'display_name', 'ZZ System Admin'));
select zz_test.use('zz-member@test.invalid');
select zz_test.rec('T21 Community: cannot update their own role',
  zz_test.refused(zz_test.try($q$ update public.profiles set role = 'system_admin' where id = auth.uid() $q$), 'permission denied'),
  zz_test.try($q$ update public.profiles set role = 'system_admin' where id = auth.uid() $q$));
select zz_test.rec('T22 Community: cannot update their own position',
  zz_test.refused(zz_test.try(format($q$ update public.profiles set user_type_id = %L where id = auth.uid() $q$, zz_test.f('system_admin_t'))), 'permission denied'), '');
select zz_test.rec('T23 Community: cannot insert a profile',
  zz_test.refused(zz_test.try($q$ insert into public.profiles (id, role) values (gen_random_uuid(), 'system_admin') $q$), 'permission denied'), '');
select zz_test.rec('T24 Community: cannot assign a position, even to themselves',
  zz_test.refused(zz_test.try(format($q$ select public.admin_set_user_type(auth.uid(), %L) $q$, zz_test.f('system_admin_t'))), 'permission denied'),
  zz_test.try(format($q$ select public.admin_set_user_type(auth.uid(), %L) $q$, zz_test.f('system_admin_t'))));
select zz_test.rec('T25 Community: cannot create or edit positions',
  zz_test.refused(zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role) values (%L, 'ZZ hack', 'community') $q$, zz_test.f('school_a'))), 'row-level security')
  and zz_test.val(format($q$ with u as (update public.user_types set base_role = 'system_admin', authorized_privileged = true where id = %L returning 1) select count(*) from u $q$, zz_test.f('student'))) = '0',
  zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role) values (%L, 'ZZ hack2', 'community') $q$, zz_test.f('school_a'))));
select zz_test.rec('T26 Community: sees only their own profile',
  zz_test.val('select count(*) from public.profiles') = '1', zz_test.val('select count(*) from public.profiles'));
select zz_test.rec('T27 Community: cannot create alerts',
  zz_test.refused(zz_test.try(format($q$ insert into public.alerts (school_id, title, body) values (%L, 'x', 'y') $q$, zz_test.f('school_a'))), 'row-level security'), '');

-- 5. Default location ------------------------------------------------------------------
select zz_test.use('zz-one@test.invalid');
select zz_test.rec('T28 default location can be changed to another usable place',
  zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('room2'))) = 'ok'
  and zz_test.val('select primary_location_id::text from public.profiles where id = auth.uid()') = zz_test.f('room2'), '');
select zz_test.rec('T29 default location cannot be set to an inactive place',
  zz_test.refused(zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('room3'))), 'active'),
  zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('room3'))));
select zz_test.rec('T30 default location cannot be set to a restricted place',
  zz_test.refused(zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('room4'))), 'active'), '');
select zz_test.rec('T31 default location cannot be another school''s place',
  zz_test.refused(zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('loc_b'))), 'not found'),
  zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('loc_b'))));
reset role;
update public.locations set status = 'inactive' where id = zz_test.f('room2')::uuid;
select zz_test.use('zz-one@test.invalid');
select zz_test.rec('T32 a saved default that became inactive stays on file but cannot be used for a new report',
  zz_test.val('select primary_location_id::text from public.profiles where id = auth.uid()') = zz_test.f('room2')
  and zz_test.refused(zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status) values (%L, %L, 'self_selected', 'safe') $q$, zz_test.f('school_a'), zz_test.f('room2'))), ''),
  zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status) values (%L, %L, 'self_selected', 'safe') $q$, zz_test.f('school_a'), zz_test.f('room2'))));
select zz_test.rec('T33 replacing the inactive default with an active place works',
  zz_test.try(format($q$ select public.set_my_default_location(%L) $q$, zz_test.f('room1'))) = 'ok'
  and zz_test.val('select primary_location_id::text from public.profiles where id = auth.uid()') = zz_test.f('room1'), '');
reset role;
update public.locations set status = 'active' where id = zz_test.f('room2')::uuid;

-- 6. The actual place is stored separately from the default -------------------------
select zz_test.use('zz-one@test.invalid');
select zz_test.rec('T34 check-in stores the chosen place, not the default',
  zz_test.try(format($q$ insert into public.check_ins (school_id, location_id, location_source, status) values (%L, %L, 'self_selected', 'safe') $q$, zz_test.f('school_a'), zz_test.f('room2'))) = 'ok'
  and zz_test.sval('select location_id::text from public.check_ins where profile_id = auth.uid() order by checked_in_at desc limit 1') = zz_test.f('room2')
  and zz_test.val('select primary_location_id::text from public.profiles where id = auth.uid()') = zz_test.f('room1'), '');
select zz_test.rec('T35 incident stores the chosen place; the default is unchanged',
  zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'medical', %L, 'ZZ test incident') $q$, zz_test.f('school_a'), zz_test.f('room2'))) = 'ok'
  and zz_test.sval('select location_id::text from public.incidents where created_by = auth.uid() order by created_at desc limit 1') = zz_test.f('room2')
  and zz_test.val('select primary_location_id::text from public.profiles where id = auth.uid()') = zz_test.f('room1'),
  zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'medical', %L, 'ZZ again') $q$, zz_test.f('school_a'), zz_test.f('room2'))));
select zz_test.rec('T36 report stores the chosen place; the default is unchanged',
  zz_test.try(format($q$ insert into public.submissions (school_id, kind, sub_type, emotion, stress_level, location_id, message) values (%L, 'sentiment', 'stressed', 'stressed', 4, %L, 'ZZ feeling') $q$, zz_test.f('school_a'), zz_test.f('room2'))) = 'ok'
  and zz_test.sval('select location_id::text from public.submissions where submitted_by = auth.uid() order by created_at desc limit 1') = zz_test.f('room2')
  and zz_test.val('select primary_location_id::text from public.profiles where id = auth.uid()') = zz_test.f('room1'),
  zz_test.try(format($q$ insert into public.submissions (school_id, kind, sub_type, emotion, stress_level, location_id, message) values (%L, 'sentiment', 'stressed', 'stressed', 4, %L, 'ZZ feeling2') $q$, zz_test.f('school_a'), zz_test.f('room2'))));
select zz_test.rec('T37 an incident at an inactive place is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'other', %L, 'ZZ nope') $q$, zz_test.f('school_a'), zz_test.f('room3'))), ''),
  zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, 'other', %L, 'ZZ nope') $q$, zz_test.f('school_a'), zz_test.f('room3'))));
select zz_test.rec('T38 a report at an inactive place is refused',
  zz_test.refused(zz_test.try(format($q$ insert into public.submissions (school_id, kind, sub_type, location_id, message) values (%L, 'observation', 'suggestion', %L, 'ZZ nope') $q$, zz_test.f('school_a'), zz_test.f('room3'))), ''), '');
select zz_test.rec('T39 a report cannot name another school''s place',
  zz_test.refused(zz_test.try(format($q$ insert into public.submissions (school_id, kind, sub_type, location_id, message) values (%L, 'observation', 'suggestion', %L, 'ZZ nope') $q$, zz_test.f('school_a'), zz_test.f('loc_b'))), ''), '');
select zz_test.rec('T40 Community: cannot read other people''s reports or other schools'' data',
  zz_test.val('select count(*) from public.submissions where submitted_by is distinct from auth.uid()') = '0'
  and zz_test.val(format($q$ select count(*) from public.locations where school_id = %L $q$, zz_test.f('school_b'))) = '0'
  and zz_test.val(format($q$ select count(*) from public.user_types where school_id = %L $q$, zz_test.f('school_b'))) = '0', '');
select zz_test.rec('T41 Community: cannot set incident priority',
  zz_test.refused(zz_test.try($q$ select public.set_incident_priority((select id from public.incidents where description = 'ZZ test incident'), 3, 3, 3) $q$), ''),
  zz_test.try($q$ select public.set_incident_priority((select id from public.incidents where description = 'ZZ test incident'), 3, 3, 3) $q$));

-- 7. School Admin (coordinators and responders) -----------------------------------------
select zz_test.use('zz-sa@test.invalid');
select zz_test.rec('T42 School Admin reads individual feelings',
  zz_test.val('select count(*) from public.submissions where kind = ''sentiment''')::int >= 1, zz_test.val('select count(*) from public.submissions where kind = ''sentiment'''));
select zz_test.rec('T43 School Admin cannot see another school''s reports, places, positions, or people',
  zz_test.val(format($q$ select count(*) from public.submissions where school_id = %L $q$, zz_test.f('school_b'))) = '0'
  and zz_test.val(format($q$ select count(*) from public.locations where school_id = %L $q$, zz_test.f('school_b'))) = '0'
  and zz_test.val(format($q$ select count(*) from public.user_types where school_id = %L $q$, zz_test.f('school_b'))) = '0'
  and zz_test.val(format($q$ select count(*) from public.profiles where school_id = %L $q$, zz_test.f('school_b'))) = '0', '');
select zz_test.rec('T44 School Admin sees the people in their own school',
  zz_test.val('select count(*) from public.profiles')::int > 1, zz_test.val('select count(*) from public.profiles'));
select zz_test.rec('T45 School Admin can acknowledge an incident and set its priority',
  zz_test.try($q$ select public.transition_incident((select id from public.incidents where description = 'ZZ test incident'), 'acknowledged', null) $q$) = 'ok'
  and zz_test.try($q$ select public.set_incident_priority((select id from public.incidents where description = 'ZZ test incident'), 4, 3, 2) $q$) = 'ok',
  zz_test.try($q$ select public.set_incident_priority((select id from public.incidents where description = 'ZZ test incident'), 4, 3, 2) $q$));
select zz_test.rec('T46 School Admin sees dashboard totals',
  zz_test.val($q$ select public.dashboard_counts() ->> 'role' $q$) = 'school_admin'
  and zz_test.val($q$ select public.dashboard_counts() ->> 'school_open_incidents' $q$) not like 'ERR%',
  zz_test.val($q$ select public.dashboard_counts() ->> 'role' $q$));
select zz_test.rec('T47 School Admin can draft an alert',
  zz_test.try(format($q$ insert into public.alerts (school_id, title, body, severity, target_scope) values (%L, 'ZZ drill', 'ZZ body', 'info', 'all') $q$, zz_test.f('school_a'))) = 'ok', '');
select zz_test.rec('T48 School Admin cannot create positions (System Admin only)',
  zz_test.refused(zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role) values (%L, 'ZZ sneaky', 'school_admin') $q$, zz_test.f('school_a'))), 'row-level security'), '');
select zz_test.rec('T49 School Admin cannot assign a System Admin position',
  zz_test.refused(zz_test.try(format($q$ select public.admin_set_user_type(zz_test.uid('zz-one@test.invalid'), %L) $q$, zz_test.f('system_admin_t'))), 'only a System Admin'),
  zz_test.try(format($q$ select public.admin_set_user_type(zz_test.uid('zz-one@test.invalid'), %L) $q$, zz_test.f('system_admin_t'))));
select zz_test.rec('T50 School Admin cannot change their own position',
  zz_test.refused(zz_test.try(format($q$ select public.admin_set_user_type(auth.uid(), %L) $q$, zz_test.f('student'))), 'your own'), '');
select zz_test.rec('T51 School Admin cannot change a System Admin''s position',
  zz_test.refused(zz_test.try(format($q$ select public.admin_set_user_type(zz_test.uid('zz-sys@test.invalid'), %L) $q$, zz_test.f('student'))), 'only a System Admin'), '');
select zz_test.rec('T52 School Admin cannot give anyone a School Admin position (only a System Admin creates admins)',
  zz_test.refused(zz_test.try(format($q$ select public.admin_set_user_type(zz_test.uid('zz-two@test.invalid'), %L) $q$, zz_test.f('school_admin_t'))), 'only a System Admin')
  and zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-two@test.invalid') $q$) = 'community',
  zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-two@test.invalid') $q$));
select zz_test.rec('T53 School Admin cannot assign positions across schools',
  zz_test.refused(zz_test.try(format($q$ select public.admin_set_user_type(zz_test.uid('zz-eleven@test.invalid'), %L) $q$, zz_test.f('student_b'))), ''), '');

-- 8. System Admin configures positions ---------------------------------------------------------
reset role;
select zz_test.reg('zz-teacher@test.invalid', zz_test.meta('teacher', 'room1')) as registered;
select zz_test.use('zz-sys@test.invalid');
select zz_test.rec('T54 System Admin creates a position mapped to Community Member and opens it for sign-up',
  zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role, features, selectable_at_signup) values (%L, 'ZZ Visitor', 'community', '{report.safe,alerts.view}', true) $q$, zz_test.f('school_a'))) = 'ok', '');
select zz_test.rec('T55 System Admin creates a position mapped to School Admin',
  zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role, features) values (%L, 'ZZ Nurse', 'school_admin', '{queue.view,insights.view}') $q$, zz_test.f('school_a'))) = 'ok', '');
select zz_test.rec('T56 A School Admin position cannot be opened for public sign-up',
  zz_test.refused(zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role, selectable_at_signup) values (%L, 'ZZ Open Admin', 'school_admin', true) $q$, zz_test.f('school_a'))), 'only designations mapped to Community'),
  zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role, selectable_at_signup) values (%L, 'ZZ Open Admin2', 'school_admin', true) $q$, zz_test.f('school_a'))));
select zz_test.rec('T57 Mapping a position to System Admin needs explicit authorization (ICT Coordinator example)',
  zz_test.refused(zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role) values (%L, 'ZZ Root', 'system_admin') $q$, zz_test.f('school_a'))), 'explicit authorization')
  and zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role, authorized_privileged) values (%L, 'ZZ ICT Coordinator', 'system_admin', true) $q$, zz_test.f('school_a'))) = 'ok', '');
select zz_test.rec('T58 System Admin cannot create positions in another school',
  zz_test.refused(zz_test.try(format($q$ insert into public.user_types (school_id, name, base_role) values (%L, 'ZZ cross', 'community') $q$, zz_test.f('school_b'))), 'row-level security'), '');
select zz_test.rec('T58b the last System Admin position cannot be remapped away',
  zz_test.refused(zz_test.try(format($q$ update public.user_types set base_role = 'school_admin', authorized_privileged = false, features = '{}' where id = %L $q$, zz_test.f('system_admin_t'))), 'System Admin'),
  zz_test.try(format($q$ update public.user_types set base_role = 'school_admin', authorized_privileged = false, features = '{}' where id = %L $q$, zz_test.f('system_admin_t'))));

select zz_test.rec('T59 System Admin assigns the ICT Coordinator position and the person becomes a System Admin',
  zz_test.try($q$ select public.admin_set_user_type(zz_test.uid('zz-one@test.invalid'), (select id from public.user_types where name = 'ZZ ICT Coordinator')) $q$) = 'ok'
  and zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-one@test.invalid') $q$) = 'system_admin', zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-one@test.invalid') $q$));
select zz_test.rec('T60 System Admin cannot change their own position',
  zz_test.refused(zz_test.try(format($q$ select public.admin_set_user_type(auth.uid(), %L) $q$, zz_test.f('student'))), 'your own'), '');
select zz_test.rec('T61a System Admin remaps the Teacher position to School Admin (sign-up closed first)',
  zz_test.try(format($q$ update public.user_types set base_role = 'school_admin', features = '{queue.view}', selectable_at_signup = false where id = %L $q$, zz_test.f('teacher'))) = 'ok',
  zz_test.val(format($q$ select base_role::text from public.user_types where id = %L $q$, zz_test.f('teacher'))));
select zz_test.rec('T61b everyone holding the remapped position moves with it, and each move is logged',
  zz_test.val($q$ select role::text from public.profiles where id = zz_test.uid('zz-teacher@test.invalid') $q$) = 'school_admin'
  and zz_test.val($q$ select count(*) from public.audit_logs where action = 'role_changed' and payload ->> 'via' = 'designation_remapped' and payload ->> 'designation' = 'Teacher' $q$)::int >= 1,
  zz_test.val($q$ select role::text || ' / type ' || coalesce(user_type_id::text, 'none') from public.profiles where id = zz_test.uid('zz-teacher@test.invalid') $q$));
select zz_test.rec('T62 Student cannot be remapped to School Admin while open for sign-up',
  zz_test.refused(zz_test.try(format($q$ update public.user_types set base_role = 'school_admin' where id = %L $q$, zz_test.f('student'))), 'only designations mapped to Community'), '');
