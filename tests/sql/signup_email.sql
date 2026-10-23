-- Acceptance tests for public sign-up email checks: a well-formed address on a permanent mailbox is
-- accepted; a malformed address or a disposable mailbox is refused; admin-added accounts are not
-- affected. Runs in the shared rolled-back transaction (see tests/database.test.mjs).

insert into zz_test.fx select 'school_a', id::text from public.schools where status = 'active' order by created_at limit 1;
insert into public.locations (school_id, parent_id, category_id, name)
select zz_test.f('school_a')::uuid, f.id, (select id from public.location_categories where school_id = f.school_id and name = 'Classroom'), 'ZZ Room 1'
from (select f.id, f.school_id from public.locations f join public.location_categories fc on fc.id = f.category_id where f.school_id = zz_test.f('school_a')::uuid and f.status = 'active' and fc.level = 3 order by f.name limit 1) f;
insert into zz_test.fx select 'room1', id::text from public.locations where name = 'ZZ Room 1' and school_id = zz_test.f('school_a')::uuid;
insert into zz_test.fx select 'student', id::text from public.user_types where name = 'Student' and school_id = zz_test.f('school_a')::uuid;
update public.user_types set selectable_at_signup = true where id = zz_test.f('student')::uuid;

select zz_test.rec('E01 a malformed address (no dot in the domain) is refused',
  zz_test.refused(zz_test.reg('person@school', zz_test.meta('student', 'room1')), 'valid email address'), '');
select zz_test.rec('E02 an address with spaces is refused',
  zz_test.refused(zz_test.reg('per son@school.edu.ph', zz_test.meta('student', 'room1')), 'valid email address'), '');
select zz_test.rec('E03 a disposable mailbox is refused',
  zz_test.refused(zz_test.reg('throwaway@mailinator.com', zz_test.meta('student', 'room1')), 'permanent email address'), '');
select zz_test.rec('E04 a well-formed address on a permanent mailbox is accepted and starts pending',
  zz_test.reg('good.person+1@school.edu.ph', zz_test.meta('student', 'room1'), '{}'::jsonb, false) = 'ok'
  and zz_test.val($q$ select status from public.profiles where id = zz_test.uid('good.person+1@school.edu.ph') $q$) = 'pending',
  zz_test.val($q$ select status from public.profiles where id = zz_test.uid('good.person+1@school.edu.ph') $q$));
select zz_test.rec('E05 an admin-added account is not subject to the public email rules (provision secret)',
  zz_test.reg('admin.added@test.invalid', jsonb_build_object(
    'provision_secret', zz_test.sval('select secret from public._provision_secrets'),
    'designation_id', zz_test.f('student'), 'display_name', 'Admin Added')) = 'ok', '');
