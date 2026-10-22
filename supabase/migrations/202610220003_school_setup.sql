-- School setup: location hierarchy levels and admin-defined user types.
--
-- 1. Location types get a level (1 campus, 2 building or grounds, 3 floor or
--    wing, 4 room or area). A location must sit inside a location of a lower
--    level, and only level-1 types can be at the top.
-- 2. System Admins can create and edit locations and location types.
-- 3. User types: named, per-school types (e.g. "Canteen Staff") built on one
--    of the 8 base roles. The base role still decides what the database
--    allows (RLS is unchanged). Features decide which menus and report
--    buttons a person sees, and can never exceed what the base role allows.

-- ---------------------------------------------------------------------------
-- 1. Location levels
-- ---------------------------------------------------------------------------

alter table public.location_categories add column if not exists level smallint not null default 4;
alter table public.location_categories drop constraint if exists location_categories_level_check;
alter table public.location_categories add constraint location_categories_level_check check (level between 1 and 4);

update public.location_categories
set level = case
  when lower(name) like '%campus%' then 1
  when lower(name) = 'building' then 2
  when environment = 'outdoor' or lower(name) in ('court', 'covered court', 'drop-off point', 'plaza') then 2
  when lower(name) in ('floor', 'wing') then 3
  else 4
end;

insert into public.location_categories (school_id, name, environment, level)
select s.id, 'Campus', 'either', 1
from public.schools s
where not exists (select 1 from public.location_categories c where c.school_id = s.id and c.level = 1);

create or replace function public.validate_location_category()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if char_length(trim(new.name)) < 2 or char_length(trim(new.name)) > 60 then
    raise exception 'type name must be 2 to 60 characters';
  end if;
  new.name := trim(new.name);
  if tg_op = 'UPDATE' then
    if new.level <> old.level and exists (
      select 1 from public.locations l where l.category_id = new.id and l.status <> 'archived'
    ) then
      raise exception 'the level of "%" cannot change while places use it', old.name;
    end if;
    if new.environment <> 'either' and new.environment is distinct from old.environment and exists (
      select 1 from public.locations l
      where l.category_id = new.id and l.status <> 'archived' and l.environment <> new.environment
    ) then
      raise exception 'some places of type "%" have a different environment', old.name;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists categories_validate on public.location_categories;
create trigger categories_validate
  before insert or update on public.location_categories
  for each row execute function public.validate_location_category();

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

  -- Cycle/depth walk: only meaningful when parent changes (not on INSERT)
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

  -- Hierarchy levels: checked when the place is created, moved, or retyped.
  if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id or new.category_id is distinct from old.category_id then
    if new.parent_id is null then
      if v_category.level <> 1 then
        raise exception 'only a campus-level type can be at the top; put "%" inside a campus', new.name;
      end if;
    else
      select c.level into v_parent_level from public.location_categories c where c.id = v_parent.category_id;
      if v_category.level <= v_parent_level then
        raise exception 'a % cannot be placed inside "%"', v_category.name, v_parent.name;
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id and exists (
    select 1 from public.locations ch
    join public.location_categories cc on cc.id = ch.category_id
    where ch.parent_id = new.id and ch.status <> 'archived' and cc.level <= v_category.level
  ) then
    raise exception 'places inside "%" would no longer fit under its new type', new.name;
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

-- ---------------------------------------------------------------------------
-- 2. System Admin can configure locations and location types
-- ---------------------------------------------------------------------------

drop policy if exists locations_insert_sysadmin on public.locations;
create policy locations_insert_sysadmin on public.locations for insert to authenticated
  with check (public.is_system_admin() and school_id = public.my_school_id());
drop policy if exists locations_update_sysadmin on public.locations;
create policy locations_update_sysadmin on public.locations for update to authenticated
  using (public.is_system_admin() and school_id = public.my_school_id())
  with check (public.is_system_admin() and school_id = public.my_school_id());
drop policy if exists categories_insert_sysadmin on public.location_categories;
create policy categories_insert_sysadmin on public.location_categories for insert to authenticated
  with check (public.is_system_admin() and school_id = public.my_school_id());
drop policy if exists categories_update_sysadmin on public.location_categories;
create policy categories_update_sysadmin on public.location_categories for update to authenticated
  using (public.is_system_admin() and school_id = public.my_school_id())
  with check (public.is_system_admin() and school_id = public.my_school_id());

-- ---------------------------------------------------------------------------
-- 3. User types
-- ---------------------------------------------------------------------------

-- The most a base role can be given. Mirrors src/lib/features.ts.
create or replace function public.role_feature_ceiling(p_role public.app_role)
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select array['report.help', 'report.safe', 'report.feeling', 'report.hazard', 'report.incident', 'report.observation', 'alerts.view']
    || case p_role
         when 'teacher' then array['insights.view', 'queue.view']
         when 'security' then array['insights.view', 'queue.view']
         when 'drrm' then array['insights.view', 'queue.view', 'alerts.draft']
         when 'guidance' then array['insights.view', 'queue.view']
         when 'school_admin' then array['insights.view', 'queue.view', 'alerts.draft', 'alerts.approve', 'people.manage', 'setup.locations']
         when 'system_admin' then array['people.manage', 'setup.locations', 'setup.user_types']
         else array[]::text[]
       end;
$function$;

create or replace function public.role_default_features(p_role public.app_role)
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select case p_role
    when 'school_admin' then array_remove(public.role_feature_ceiling(p_role), 'setup.locations')
    when 'system_admin' then array_remove(public.role_feature_ceiling(p_role), 'alerts.view')
    else public.role_feature_ceiling(p_role)
  end;
$function$;

create table if not exists public.user_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  name text not null,
  description text,
  base_role public.app_role not null,
  features text[] not null default '{}',
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_types_name_length check (char_length(name) between 2 and 60),
  constraint user_types_description_length check (description is null or char_length(description) <= 300)
);
create unique index if not exists user_types_school_name_key on public.user_types (school_id, lower(name));

alter table public.user_types enable row level security;
revoke all on public.user_types from anon;
grant select, insert, update on public.user_types to authenticated;

drop policy if exists user_types_select_school on public.user_types;
create policy user_types_select_school on public.user_types for select to authenticated
  using (school_id = public.my_school_id());
drop policy if exists user_types_insert_sysadmin on public.user_types;
create policy user_types_insert_sysadmin on public.user_types for insert to authenticated
  with check (public.is_system_admin() and school_id = public.my_school_id());
drop policy if exists user_types_update_sysadmin on public.user_types;
create policy user_types_update_sysadmin on public.user_types for update to authenticated
  using (public.is_system_admin() and school_id = public.my_school_id())
  with check (public.is_system_admin() and school_id = public.my_school_id());

create or replace function public.validate_user_type()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_bad text[];
  v_assigned bigint;
begin
  new.name := trim(new.name);
  new.features := (select coalesce(array_agg(distinct f order by f), '{}') from unnest(new.features) f);
  select array_agg(f) into v_bad
  from unnest(new.features) f
  where not (f = any (public.role_feature_ceiling(new.base_role)));
  if v_bad is not null then
    raise exception 'not allowed for the % role: %', new.base_role, array_to_string(v_bad, ', ');
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      if new.is_system then
        raise exception 'built-in user types are created by the system';
      end if;
    end if;
    return new;
  end if;

  if new.school_id <> old.school_id then
    raise exception 'school reassignment is not allowed';
  end if;
  if new.is_system is distinct from old.is_system then
    raise exception 'the built-in flag cannot change';
  end if;
  if old.is_system and (new.base_role <> old.base_role or not new.is_active) then
    raise exception 'built-in user types cannot change base role or be turned off';
  end if;
  select count(*) into v_assigned from public.profiles p where p.user_type_id = new.id;
  if new.base_role <> old.base_role and v_assigned > 0 then
    raise exception 'move the % people with this type to another type before changing its base role', v_assigned;
  end if;
  if old.is_active and not new.is_active and v_assigned > 0 then
    raise exception 'move the % people with this type to another type before turning it off', v_assigned;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists user_types_validate on public.user_types;
create trigger user_types_validate
  before insert or update on public.user_types
  for each row execute function public.validate_user_type();

drop trigger if exists user_types_audit on public.user_types;
create trigger user_types_audit
  after insert or update on public.user_types
  for each row execute function public.audit_school_structure('user_types');

alter table public.profiles add column if not exists user_type_id uuid references public.user_types(id) on delete set null;

insert into public.user_types (school_id, name, base_role, features, is_system)
select s.id, r.label, r.role, public.role_default_features(r.role), true
from public.schools s
cross join (values
  ('student'::public.app_role, 'Student'),
  ('teacher'::public.app_role, 'Teacher'),
  ('non_teaching'::public.app_role, 'Non-Teaching Staff'),
  ('security'::public.app_role, 'Security'),
  ('drrm'::public.app_role, 'DRRM Coordinator'),
  ('guidance'::public.app_role, 'Guidance Counselor'),
  ('school_admin'::public.app_role, 'School Admin'),
  ('system_admin'::public.app_role, 'System Admin')
) as r(role, label)
on conflict do nothing;

update public.profiles p
set user_type_id = t.id
from public.user_types t
where t.school_id = p.school_id and t.base_role = p.role and t.is_system and p.user_type_id is null;

create or replace function public.admin_set_user_type(target_user_id uuid, new_type_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_old public.profiles%rowtype;
  v_type public.user_types%rowtype;
  v_old_type text;
begin
  if not (public.is_school_admin() or public.is_system_admin()) then
    raise exception 'permission denied: school or system administrator required';
  end if;
  if target_user_id = v_actor then
    raise exception 'you cannot change your own user type';
  end if;
  select * into v_old from public.profiles where id = target_user_id;
  if not found then
    raise exception 'user not found';
  end if;
  if v_old.school_id is distinct from public.my_school_id() then
    raise exception 'user belongs to a different school';
  end if;
  select * into v_type from public.user_types where id = new_type_id;
  if not found or v_type.school_id is distinct from public.my_school_id() then
    raise exception 'user type not found';
  end if;
  if not v_type.is_active then
    raise exception 'this user type is turned off';
  end if;
  if (v_old.role = 'system_admin' or v_type.base_role = 'system_admin') and not public.is_system_admin() then
    raise exception 'only a system administrator can assign or change system administrators';
  end if;
  select t.name into v_old_type from public.user_types t where t.id = v_old.user_type_id;
  update public.profiles
     set user_type_id = v_type.id, role = v_type.base_role, updated_at = now()
   where id = target_user_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'user_type_changed', 'profiles', target_user_id::text,
          jsonb_build_object('from_type', v_old_type, 'to_type', v_type.name,
                             'from_role', v_old.role, 'new_role', v_type.base_role));
end;
$function$;

revoke all on function public.admin_set_user_type(uuid, uuid) from public, anon;
grant execute on function public.admin_set_user_type(uuid, uuid) to authenticated;

-- Keep a person's user type in step when their role is changed directly.
create or replace function public.admin_set_user_role(target_user_id uuid, new_role public.app_role)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_old_role public.app_role;
  v_target_school uuid;
begin
  if not (public.is_school_admin() or public.is_system_admin()) then
    raise exception 'permission denied: school or system administrator required';
  end if;
  if target_user_id = v_actor then
    raise exception 'you cannot change your own role';
  end if;
  select p.role, p.school_id into v_old_role, v_target_school
  from public.profiles p
  where p.id = target_user_id;
  if not found then
    raise exception 'user not found';
  end if;
  if v_target_school is distinct from public.my_school_id() then
    raise exception 'user belongs to a different school';
  end if;
  if v_old_role = 'system_admin' and not public.is_system_admin() then
    raise exception 'only a system administrator can change a system administrator';
  end if;
  if new_role = 'system_admin' and not public.is_system_admin() then
    raise exception 'only a system administrator can assign the system administrator role';
  end if;
  update public.profiles
     set role = new_role,
         user_type_id = (select t.id from public.user_types t
                         where t.school_id = v_target_school and t.base_role = new_role and t.is_system
                         limit 1),
         updated_at = now()
   where id = target_user_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (
    v_actor,
    'role_changed',
    'profiles',
    target_user_id::text,
    jsonb_build_object('from_role', v_old_role, 'new_role', new_role)
  );
end;
$function$;
