-- Grid layout for the campus map.
--
-- Every place can hold a grid (grid_cols x grid_rows). Its child places are
-- drawn on that grid as blocks: layout_x / layout_y are the top-left cell
-- (0-based) and layout_w / layout_h the size in cells. A place with no
-- layout values is simply not drawn on its parent's map yet.
-- Writes go through the existing location policies (School Admin and System
-- Admin) and validate_location.

alter table public.locations
  add column if not exists grid_cols smallint not null default 24,
  add column if not exists grid_rows smallint not null default 16,
  add column if not exists layout_x smallint,
  add column if not exists layout_y smallint,
  add column if not exists layout_w smallint,
  add column if not exists layout_h smallint;

alter table public.locations drop constraint if exists locations_grid_size_check;
alter table public.locations add constraint locations_grid_size_check
  check (grid_cols between 4 and 60 and grid_rows between 4 and 60);

alter table public.locations drop constraint if exists locations_layout_check;
alter table public.locations add constraint locations_layout_check
  check (
    (layout_x is null and layout_y is null and layout_w is null and layout_h is null)
    or (layout_x between 0 and 59 and layout_y between 0 and 59
        and layout_w between 1 and 60 and layout_h between 1 and 60)
  );
