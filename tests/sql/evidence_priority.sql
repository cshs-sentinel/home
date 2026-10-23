-- Acceptance tests for evidence-based automatic priority: the reporter's detail,
-- whole-building reports of spreading hazards, corroboration by other reporters
-- nearby (and raising the earlier reports), caps, and what responders keep.
-- Runs in the shared rolled-back transaction (see tests/database.test.mjs).

-- Fixtures: two rooms in one area, a far room in another building ------------------
insert into zz_test.fx select 'school_a', id::text from public.schools where status = 'active' order by created_at limit 1;
insert into zz_test.fx
select 'area', f.id::text from public.locations f join public.location_categories fc on fc.id = f.category_id
where f.school_id = zz_test.f('school_a')::uuid and f.status = 'active' and fc.level = 3 order by f.name limit 1;
insert into zz_test.fx select 'building', parent_id::text from public.locations where id = zz_test.f('area')::uuid;
insert into zz_test.fx select 'campus', parent_id::text from public.locations where id = zz_test.f('building')::uuid;
insert into zz_test.fx select 'cat_room', id::text from public.location_categories where school_id = zz_test.f('school_a')::uuid and name = 'Classroom';
insert into zz_test.fx select 'cat_area', category_id::text from public.locations where id = zz_test.f('area')::uuid;
insert into zz_test.fx select 'cat_building', category_id::text from public.locations where id = zz_test.f('building')::uuid;

insert into public.locations (school_id, parent_id, category_id, name)
select zz_test.f('school_a')::uuid, zz_test.f('area')::uuid, zz_test.f('cat_room')::uuid, 'ZZ Ev Room ' || n from generate_series(1, 2) n;
insert into zz_test.fx select 'room' || right(name, 1), id::text from public.locations where name like 'ZZ Ev Room %' and school_id = zz_test.f('school_a')::uuid;
insert into public.locations (school_id, parent_id, category_id, name) values (zz_test.f('school_a')::uuid, zz_test.f('campus')::uuid, zz_test.f('cat_building')::uuid, 'ZZ Ev Far Building');
insert into zz_test.fx select 'far_building', id::text from public.locations where name = 'ZZ Ev Far Building';
insert into public.locations (school_id, parent_id, category_id, name) values (zz_test.f('school_a')::uuid, zz_test.f('far_building')::uuid, zz_test.f('cat_area')::uuid, 'ZZ Ev Far Area');
insert into zz_test.fx select 'far_area', id::text from public.locations where name = 'ZZ Ev Far Area';
insert into public.locations (school_id, parent_id, category_id, name) values (zz_test.f('school_a')::uuid, zz_test.f('far_area')::uuid, zz_test.f('cat_room')::uuid, 'ZZ Ev Far Room');
insert into zz_test.fx select 'far_room', id::text from public.locations where name = 'ZZ Ev Far Room';
insert into zz_test.fx select 'student', id::text from public.user_types where name = 'Student' and school_id = zz_test.f('school_a')::uuid;

select zz_test.reg('zz-e' || n || '@test.invalid', zz_test.meta('student', 'room1')) from generate_series(1, 10) n;
reset role;
select zz_test.reg('zz-sa@test.invalid', jsonb_build_object('provision_secret', zz_test.sval('select secret from public._provision_secrets'), 'designation_id', (select id from public.user_types where name = 'School Admin' and school_id = zz_test.f('school_a')::uuid), 'display_name', 'ZZ School Admin'));

-- Reports one incident as the given account and returns "ok" or the error.
create function zz_test.report(p_email text, p_category text, p_location text, p_description text) returns text language plpgsql as $f$
begin
  perform zz_test.use(p_email);
  return zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description) values (%L, %L, %L, %L) $q$,
    zz_test.f('school_a'), p_category, zz_test.f(p_location), p_description));
end $f$;
-- "S/U/A" of the incident with this description, read as the table owner.
create function zz_test.sua(p_description text) returns text language sql as $f$
select zz_test.sval(format($q$ select priority_severity || '/' || priority_urgency || '/' || priority_affected from public.incidents where description = %L $q$, p_description)) $f$;
create function zz_test.basis(p_description text) returns text language sql as $f$
select zz_test.sval(format($q$ select array_to_string(priority_basis, ' | ') from public.incidents where description = %L $q$, p_description)) $f$;
grant execute on all functions in schema zz_test to public;

select zz_test.rec('E00 fixtures: two rooms in one area, a far room in another building, ten reporters',
  zz_test.f('room1') is not null and zz_test.f('room2') is not null and zz_test.f('far_room') is not null and zz_test.f('building') is not null
  and zz_test.uid('zz-e9@test.invalid') is not null, '');

-- The reporter's own words -----------------------------------------------------------
select zz_test.rec('E01 with no detail and no other reports, the category starting scores stand (Bullying 3/2/1)',
  zz_test.report('zz-e1@test.invalid', 'bullying', 'room1', 'Bullying reported at ZZ Ev Room 1 using quick report.') = 'ok'
  and zz_test.sua('Bullying reported at ZZ Ev Room 1 using quick report.') = '3/2/1'
  and zz_test.basis('Bullying reported at ZZ Ev Room 1 using quick report.') = 'Starting scores for bullying: S 3, U 2, A 1.',
  zz_test.sua('Bullying reported at ZZ Ev Room 1 using quick report.') || ' ' || zz_test.basis('Bullying reported at ZZ Ev Room 1 using quick report.'));

select zz_test.rec('E02 a life-threat word in the detail raises Severity to 4 and says why',
  zz_test.report('zz-e2@test.invalid', 'injury_accident', 'room2', E'Injury / Accident reported at ZZ Ev Room 2 using quick report.\n\nDetail: he is bleeding from the head') = 'ok'
  and zz_test.sua(E'Injury / Accident reported at ZZ Ev Room 2 using quick report.\n\nDetail: he is bleeding from the head') = '4/4/2'
  and zz_test.basis(E'Injury / Accident reported at ZZ Ev Room 2 using quick report.\n\nDetail: he is bleeding from the head') like '%Severity raised to 4: the detail mentions "bleeding"%',
  zz_test.sua(E'Injury / Accident reported at ZZ Ev Room 2 using quick report.\n\nDetail: he is bleeding from the head'));

select zz_test.rec('E03 a Filipino "still spreading" word raises Urgency to 4 (Electrical Hazard 3/3/2 -> 3/4/2)',
  zz_test.report('zz-e3@test.invalid', 'electrical_hazard', 'far_room', E'Electrical Hazard reported at ZZ Ev Far Room using quick report.\n\nDetail: kumakalat na ang usok') = 'ok'
  and zz_test.sua(E'Electrical Hazard reported at ZZ Ev Far Room using quick report.\n\nDetail: kumakalat na ang usok') = '3/4/2',
  zz_test.sua(E'Electrical Hazard reported at ZZ Ev Far Room using quick report.\n\nDetail: kumakalat na ang usok'));

select zz_test.rec('E04 only the reporter''s detail is read, not the place name in the generated sentence',
  zz_test.report('zz-e4@test.invalid', 'unsafe_facility', 'far_room', 'Unsafe Facility reported at Students Lounge using quick report.') = 'ok'
  and zz_test.sua('Unsafe Facility reported at Students Lounge using quick report.') = '2/2/2',
  zz_test.sua('Unsafe Facility reported at Students Lounge using quick report.'));

-- Where it was reported ----------------------------------------------------------------
select zz_test.rec('E05 a spreading hazard reported for a whole building affects at least a class (A >= 3)',
  zz_test.report('zz-e5@test.invalid', 'water_chemical_spill', 'building', 'Water / Chemical Spill reported at the building using quick report.') = 'ok'
  and zz_test.sua('Water / Chemical Spill reported at the building using quick report.') = '2/3/3',
  zz_test.sua('Water / Chemical Spill reported at the building using quick report.'));

-- Other reporters nearby -----------------------------------------------------------------
select zz_test.rec('E06 a second person reporting the same thing in the same room adds 1 to Affected, and the first report rises too',
  zz_test.report('zz-e6@test.invalid', 'bullying', 'room1', 'ZZ second bullying report') = 'ok'
  and zz_test.sua('ZZ second bullying report') = '3/2/2'
  and zz_test.sua('Bullying reported at ZZ Ev Room 1 using quick report.') = '3/2/2'
  and zz_test.basis('ZZ second bullying report') like '%1 other person reported this nearby%',
  zz_test.sua('ZZ second bullying report') || ' first ' || zz_test.sua('Bullying reported at ZZ Ev Room 1 using quick report.'));

select zz_test.rec('E07 a third reporter in the next room (same area) also adds 1 to Urgency, for all three',
  zz_test.report('zz-e7@test.invalid', 'bullying', 'room2', 'ZZ third bullying report') = 'ok'
  and zz_test.sua('ZZ third bullying report') = '3/3/2'
  and zz_test.sua('ZZ second bullying report') = '3/3/2'
  and zz_test.sua('Bullying reported at ZZ Ev Room 1 using quick report.') = '3/3/2',
  zz_test.sua('ZZ third bullying report') || ' / ' || zz_test.sua('ZZ second bullying report') || ' / ' || zz_test.sua('Bullying reported at ZZ Ev Room 1 using quick report.'));

select zz_test.rec('E08 the same category in another building is not counted as the same event',
  zz_test.report('zz-e8@test.invalid', 'bullying', 'far_room', 'ZZ far bullying report') = 'ok'
  and zz_test.sua('ZZ far bullying report') = '3/2/1',
  zz_test.sua('ZZ far bullying report'));

-- Limits and what responders keep ------------------------------------------------------
select zz_test.rec('E09 no factor ever goes above 4 (Fire / Smoke with every kind of keyword stays 4/4/4)',
  zz_test.report('zz-e9@test.invalid', 'fire_smoke', 'room2', E'Fire / Smoke reported at ZZ Ev Room 2 using quick report.\n\nDetail: many students trapped, fire spreading') = 'ok'
  and zz_test.sua(E'Fire / Smoke reported at ZZ Ev Room 2 using quick report.\n\nDetail: many students trapped, fire spreading') = '4/4/4',
  zz_test.sua(E'Fire / Smoke reported at ZZ Ev Room 2 using quick report.\n\nDetail: many students trapped, fire spreading'));

select zz_test.use('zz-sa@test.invalid');
select zz_test.rec('E10 a School Admin''s confirmed score is kept when more reports arrive',
  zz_test.try($q$ select public.set_incident_priority((select id from public.incidents where description = 'ZZ far bullying report'), 1, 1, 1) $q$) = 'ok'
  and zz_test.report('zz-sa@test.invalid', 'bullying', 'far_room', 'ZZ admin bullying report') = 'ok'
  and zz_test.sua('ZZ far bullying report') = '1/1/1',
  zz_test.sua('ZZ far bullying report'));

select zz_test.use('zz-e10@test.invalid');
select zz_test.rec('E11 a reporter cannot write their own scores or reasons; the system''s reading replaces them',
  zz_test.try(format($q$ insert into public.incidents (school_id, category, location_id, description, priority_severity, priority_urgency, priority_affected, priority_basis) values (%L, 'other_concern', %L, 'ZZ self-rated report', 4, 4, 4, array['I say critical']) $q$, zz_test.f('school_a'), zz_test.f('far_room'))) = 'ok'
  and zz_test.sua('ZZ self-rated report') = '2/2/1'
  and zz_test.basis('ZZ self-rated report') = 'Starting scores for other concern: S 2, U 2, A 1.',
  zz_test.sua('ZZ self-rated report') || ' ' || zz_test.basis('ZZ self-rated report'));

select zz_test.use('zz-e1@test.invalid');
select zz_test.rec('E12 signed-in users cannot call the assessment directly',
  zz_test.refused(zz_test.try(format($q$ select * from public.assess_incident_priority(%L, 'bullying', %L, 'x', auth.uid(), now(), null) $q$, zz_test.f('school_a'), zz_test.f('room1'))), 'permission denied'), '');
