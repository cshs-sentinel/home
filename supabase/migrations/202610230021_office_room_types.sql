-- Adds Guidance Office and Principal's Office as Room-level place types for every school,
-- the same way Faculty was added. Additive: a school that already has one keeps it, and no
-- place is changed. New schools do not get the default types automatically (no seeding
-- trigger exists yet), so this covers the schools that exist today.

insert into public.location_categories (school_id, name, level, environment, is_active)
select s.id, t.name, 4, 'indoor', true
from public.schools s
cross join (values ('Guidance Office'), ('Principal''s Office')) as t(name)
on conflict (school_id, lower(name)) do nothing;
