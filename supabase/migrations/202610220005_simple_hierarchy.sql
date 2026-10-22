-- Simplest location hierarchy:
--   level 1  Campus (overall)  - top of the tree only
--   level 2  Building          - inside a campus
--   level 3  Floor or wing     - inside a building
--   level 4  Room              - inside a floor or wing
--   level 5  Other location    - inside a campus, building, or floor; holds nothing
-- Replaces the looser rule from 0003 (any higher level could sit anywhere below).

alter table public.location_categories drop constraint if exists location_categories_level_check;
alter table public.location_categories add constraint location_categories_level_check check (level between 1 and 5);

-- Grounds and shared spaces become "other locations".
update public.location_categories
set level = 5
where level <> 5
  and (
    (level = 2 and lower(name) <> 'building')
    or lower(name) in ('corridor', 'lobby', 'maintenance area', 'utility area')
  )
  and not exists (select 1 from public.locations l where l.category_id = location_categories.id and l.status <> 'archived');

create or replace function public.location_fits(p_child_level smallint, p_parent_level smallint)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select case
    when p_parent_level is null then p_child_level = 1
    when p_child_level = 5 then p_parent_level between 1 and 3
    else p_parent_level < 5 and p_child_level = p_parent_level + 1
  end;
$function$;

create or replace function public.level_name(p_level smallint)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_level
    when 1 then 'campus'
    when 2 then 'building'
    when 3 then 'floor or wing'
    when 4 then 'room'
    else 'other location'
  end;
$function$;

create or replace function public.validate_location()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_parent public.locations%rowtype;
  v_parent_level smallint;
  v_category public.location_categories%rowtype;
  v_count bigint;
  v_depth_hits bigint;
  v_bad_child text;
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'a location cannot be its own parent';
    end if;
    select * into v_parent from public.locations where id = new.parent_id;
    if not found then
      raise exception 'parent location not found';
    end if;
    if v_parent.school_id <> new.school_id then
      raise exception 'parent belongs to a different school';
    end if;
    if v_parent.status = 'archived'
       and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id
            or (old.status = 'archived' and new.status <> 'archived')) then
      raise exception 'cannot add, move, or restore a place inside an archived place';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.parent_id is distinct from old.parent_id
     and new.parent_id is not null then
    with recursive chain (depth, id, parent_id) as (
      select 0, id, parent_id from public.locations where id = new.parent_id
      union all
      select c.depth + 1, l.id, l.parent_id
      from public.locations l join chain c on l.id = c.parent_id
      where c.depth < 101
    )
    select
      count(*) filter (where id = new.id),
      count(*) filter (where depth >= 101)
    into v_count, v_depth_hits
    from chain;

    if v_count > 0 then
      raise exception 'parent change would create a cycle';
    end if;
    if v_depth_hits > 0 then
      raise exception 'location hierarchy depth limit exceeded';
    end if;
  end if;

  select * into v_category from public.location_categories where id = new.category_id;
  if not found then
    raise exception 'category not found';
  end if;
  if v_category.school_id <> new.school_id then
    raise exception 'category belongs to a different school';
  end if;
  if not v_category.is_active and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
    raise exception 'category is inactive';
  end if;
  if v_category.environment <> 'either' and v_category.environment <> new.environment then
    raise exception 'category % may not label an % location', v_category.name, new.environment;
  end if;

  if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id or new.category_id is distinct from old.category_id then
    if new.parent_id is not null then
      select c.level into v_parent_level from public.location_categories c where c.id = v_parent.category_id;
    end if;
    if not public.location_fits(v_category.level, v_parent_level) then
      if new.parent_id is null then
        raise exception 'only a campus can be at the top; put "%" inside a campus', new.name;
      elsif v_parent_level = 5 or v_parent_level = 4 then
        raise exception 'nothing can be placed inside "%" (%)', v_parent.name,
          case when v_parent_level = 5 then 'an other location' else 'a room' end;
      elsif v_category.level = 5 then
        raise exception 'other locations go inside a campus, building, or floor';
      else
        raise exception 'a % goes inside a %, not inside "%" (a %)',
          public.level_name(v_category.level), public.level_name((v_category.level - 1)::smallint),
          v_parent.name, public.level_name(v_parent_level);
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id then
    select ch.name into v_bad_child
    from public.locations ch
    join public.location_categories cc on cc.id = ch.category_id
    where ch.parent_id = new.id and ch.status <> 'archived'
      and not public.location_fits(cc.level, v_category.level)
    limit 1;
    if v_bad_child is not null then
      raise exception '"%" would no longer fit inside "%" as a %', v_bad_child, new.name, public.level_name(v_category.level);
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status = 'archived' and old.status <> 'archived' and exists (
    select 1 from public.locations ch where ch.parent_id = new.id and ch.status <> 'archived'
  ) then
    raise exception 'archive or move the places inside "%" first', new.name;
  end if;

  select count(*) into v_count
  from public.locations
  where school_id = new.school_id
    and lower(name) = lower(new.name)
    and status <> 'archived'
    and id <> new.id
    and parent_id is not distinct from new.parent_id;
  if v_count > 0 and new.status <> 'archived' then
    raise exception 'a location named "%" already exists under this parent', new.name;
  end if;

  if new.code is not null and new.status <> 'archived' then
    select count(*) into v_count
    from public.locations
    where school_id = new.school_id
      and code = new.code
      and status <> 'archived'
      and id <> new.id;
    if v_count > 0 then
      raise exception 'code "%" is already used in this school', new.code;
    end if;
  end if;

  return new;
end;
$function$;
