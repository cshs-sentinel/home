-- Default location types for new and existing schools.
--
-- Level 1 Campus, level 2 Building, level 3 Floor / Wing / Annex,
-- level 4 Room, level 5 Other location.
-- Names are unique per school (case-insensitive), so the room-level Canteen
-- stays as is; an other-location Canteen needs a different name first.
-- Types that leave the default list are switched off, not deleted, so existing
-- places keep their type and an admin can switch any of them back on.

-- Park becomes Parks.
update public.location_categories set name = 'Parks' where lower(name) = 'park';

-- New types for every school.
insert into public.location_categories (school_id, name, level, environment, is_active)
select s.id, t.name, t.level, t.environment, true
from public.schools s
cross join (values
  ('Floor', 3, 'indoor'),
  ('Wing', 3, 'indoor'),
  ('Annex', 3, 'indoor'),
  ('Conference Hall', 4, 'indoor'),
  ('Workshop', 4, 'indoor'),
  ('Kitchen', 4, 'indoor'),
  ('Hallway', 4, 'indoor'),
  ('Stockroom', 4, 'indoor'),
  ('Other', 5, 'either'),
  ('School Grounds', 5, 'outdoor'),
  ('School Stage', 5, 'either')
) as t(name, level, environment)
on conflict (school_id, lower(name)) do nothing;

-- Types outside the default list are turned off.
update public.location_categories
set is_active = false
where lower(name) in (
  'auditorium', 'restroom', 'room', 'gym', 'corridor', 'lobby',
  'assembly ground', 'court', 'drop-off point', 'maintenance area', 'open space',
  'plaza', 'sports field', 'tree zone', 'utility area', 'walkway', 'playground'
);
