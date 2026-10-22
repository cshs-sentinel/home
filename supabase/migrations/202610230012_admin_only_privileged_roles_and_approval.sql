-- Three changes from live feedback on roles and registration:
--
-- 1. Only a System Admin may assign or change a School Admin or System Admin
--    position. A School Admin may only assign Community Member positions —
--    School Admin and System Admin accounts are created by a System Admin
--    only, never by a School Admin and never through public sign-up.
-- 2. Public self-registration (Community Member) now starts "pending" and
--    needs approval from a School Admin or System Admin before the account
--    can send reports, incidents, or check-ins. Accounts an admin creates
--    directly (the Add Person flow, or the seed script) are approved
--    immediately, since an admin already vetted them.
-- 3. Supporting functions for the People panel: approve_registration,
--    reject_registration, and the my_status() helper used by RLS.

-- ---------------------------------------------------------------------------
-- 1. profiles.status
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists status text not null default 'approved';
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('pending', 'approved', 'rejected'));

create or replace function public.my_status()
returns text
language sql stable security definer set search_path to ''
as $function$
  select p.status from public.profiles p
  where p.id = auth.uid() and p.is_active;
$function$;

revoke all on function public.my_status() from public, anon;
grant execute on function public.my_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Public sign-up starts pending; admin-provisioned accounts are approved
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type public.user_types%rowtype;
  v_location public.locations%rowtype;
  v_name text := trim(coalesce(v_meta ->> 'display_name', ''));
  v_designation uuid;
  v_place uuid;
begin
  if v_meta ->> 'designation_id' is null then
    if coalesce(new.raw_app_meta_data ->> 'provisioned', '') = 'admin' then
      insert into public.profiles (id, role, status) values (new.id, 'community', 'approved');
      return new;
    end if;
    raise exception 'Registration needs a designation and a default location';
  end if;

  begin
    v_designation := (v_meta ->> 'designation_id')::uuid;
    v_place := (v_meta ->> 'default_location_id')::uuid;
  exception when others then
    raise exception 'Registration details are not valid';
  end;

  select * into v_type from public.user_types where id = v_designation;
  if not found or not v_type.is_active or not v_type.selectable_at_signup or v_type.base_role <> 'community' then
    raise exception 'That designation is not open for registration';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Enter your name (2 to 120 characters)';
  end if;
  select * into v_location from public.locations where id = v_place;
  if not found or v_location.school_id <> v_type.school_id or v_location.status <> 'active' or v_location.access_level = 'restricted' then
    raise exception 'Choose a valid default location';
  end if;

  insert into public.profiles (id, role, display_name, school_id, primary_location_id, user_type_id, status)
  values (new.id, 'community', v_name, v_type.school_id, v_location.id, v_type.id, 'pending');

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (new.id, 'user_registered', 'profiles', new.id::text,
          jsonb_build_object('designation', v_type.name, 'role', 'community', 'default_location', v_location.name, 'status', 'pending'));
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Approving or rejecting a pending registration
-- ---------------------------------------------------------------------------

create or replace function public.approve_registration(target_user_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_row public.profiles%rowtype;
begin
  if not (public.is_school_admin() or public.is_system_admin()) then
    raise exception 'permission denied: school or system administrator required';
  end if;
  select * into v_row from public.profiles where id = target_user_id;
  if not found or v_row.school_id is distinct from public.my_school_id() then
    raise exception 'user not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this registration is not awaiting approval';
  end if;
  update public.profiles set status = 'approved', updated_at = now() where id = target_user_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'registration_approved', 'profiles', target_user_id::text, jsonb_build_object('display_name', v_row.display_name));
end;
$function$;

revoke all on function public.approve_registration(uuid) from public, anon;
grant execute on function public.approve_registration(uuid) to authenticated;

create or replace function public.reject_registration(target_user_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_row public.profiles%rowtype;
begin
  if not (public.is_school_admin() or public.is_system_admin()) then
    raise exception 'permission denied: school or system administrator required';
  end if;
  select * into v_row from public.profiles where id = target_user_id;
  if not found or v_row.school_id is distinct from public.my_school_id() then
    raise exception 'user not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this registration is not awaiting approval';
  end if;
  update public.profiles set status = 'rejected', is_active = false, updated_at = now() where id = target_user_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'registration_rejected', 'profiles', target_user_id::text, jsonb_build_object('display_name', v_row.display_name));
end;
$function$;

revoke all on function public.reject_registration(uuid) from public, anon;
grant execute on function public.reject_registration(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Only a System Admin assigns or changes School Admin / System Admin
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_user_type(target_user_id uuid, new_type_id uuid)
returns void
language plpgsql security definer set search_path to ''
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
    raise exception 'you cannot change your own designation';
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
    raise exception 'designation not found';
  end if;
  if not v_type.is_active then
    raise exception 'this designation is turned off';
  end if;
  if (v_old.role in ('system_admin', 'school_admin') or v_type.base_role in ('system_admin', 'school_admin'))
     and not public.is_system_admin() then
    raise exception 'only a System Admin can assign or change School Admins and System Admins';
  end if;
  if v_old.role = 'system_admin' and v_type.base_role <> 'system_admin'
     and not exists (select 1 from public.profiles p where p.school_id = v_old.school_id and p.role = 'system_admin' and p.is_active and p.id <> v_old.id) then
    raise exception 'the school needs at least one active System Admin';
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

-- ---------------------------------------------------------------------------
-- 5. Approved accounts only: report, incident, and check-in inserts
-- ---------------------------------------------------------------------------

alter policy check_ins_insert_own on public.check_ins
  with check (school_id = public.my_school_id() and profile_id = auth.uid() and public.my_status() = 'approved');

alter policy incidents_insert_own on public.incidents
  with check (school_id = public.my_school_id() and created_by = auth.uid() and public.my_status() = 'approved');

alter policy submissions_insert_own on public.submissions
  with check (school_id = public.my_school_id() and submitted_by = auth.uid() and status = 'new'
    and (location_id is null or public.submittable_location(location_id)) and public.my_status() = 'approved');
