-- Adds Faculty as a Room-level place type for every school.
-- Additive: a school that already has a Faculty type keeps it, and no place is changed.
-- New schools do not get the default types automatically (no seeding trigger exists yet),
-- so this covers the schools that exist today.

insert into public.location_categories (school_id, name, level, environment, is_active)
select s.id, 'Faculty', 4, 'indoor', true
from public.schools s
on conflict (school_id, lower(name)) do nothing;
