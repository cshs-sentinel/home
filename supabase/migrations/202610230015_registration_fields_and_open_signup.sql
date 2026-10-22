-- Public self-registration now asks for exactly five pieces of information
-- beyond the login credentials: Name, Member type (the existing designation
-- picker), Specific Location (the existing default-location picker), ID No.,
-- and Gender. The two new fields are only required -- and only stored -- on
-- this self-registration path; an admin-provisioned account (Add Person, the
-- seed script) does not need them.
--
-- Also opens public sign-up: every active Community Member position is
-- marked "selectable at sign-up" (it previously defaulted to closed, with no
-- position open). A System Admin can still close any of them individually
-- in Setup > Positions.

alter table public.profiles add column if not exists id_number text;
alter table public.profiles add column if not exists gender text;
alter table public.profiles drop constraint if exists profiles_gender_check;
alter table public.profiles add constraint profiles_gender_check
  check (gender is null or gender in ('female', 'male', 'other', 'prefer_not_to_say'));

update public.user_types
set selectable_at_signup = true
where base_role = 'community' and is_active;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_type public.user_types%rowtype;
  v_location public.locations%rowtype;
  v_name text := trim(coalesce(v_meta ->> 'display_name', ''));
  v_id_number text := trim(coalesce(v_meta ->> 'id_number', ''));
  v_gender text := v_meta ->> 'gender';
  v_designation uuid;
  v_place uuid;
  v_given_secret text := v_meta ->> 'provision_secret';
  v_provisioned boolean := v_given_secret is not null and exists (
    select 1 from public._provision_secrets s where s.secret = v_given_secret
  );
begin
  if v_meta ->> 'designation_id' is null then
    if v_provisioned then
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
  if not found then
    raise exception 'That designation is not open for registration';
  end if;

  if v_provisioned then
    -- Added directly by a School Admin or System Admin, already authorized
    -- by the Edge Function that created this account: any active position,
    -- any role, approved immediately, default location optional.
    if not v_type.is_active then
      raise exception 'this designation is turned off';
    end if;
    if char_length(v_name) < 2 or char_length(v_name) > 120 then
      raise exception 'Enter a name (2 to 120 characters)';
    end if;
    if v_place is not null then
      select * into v_location from public.locations where id = v_place;
      if not found or v_location.school_id <> v_type.school_id or v_location.status <> 'active' or v_location.access_level = 'restricted' then
        v_place := null;
      end if;
    end if;
    insert into public.profiles (id, role, display_name, school_id, primary_location_id, user_type_id, status)
    values (new.id, v_type.base_role, v_name, v_type.school_id, v_place, v_type.id, 'approved');
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (new.id, 'user_provisioned', 'profiles', new.id::text,
            jsonb_build_object('designation', v_type.name, 'role', v_type.base_role));
    return new;
  end if;

  if not v_type.is_active or not v_type.selectable_at_signup or v_type.base_role <> 'community' then
    raise exception 'That designation is not open for registration';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Enter your name (2 to 120 characters)';
  end if;
  if char_length(v_id_number) < 1 or char_length(v_id_number) > 40 then
    raise exception 'Enter your ID number';
  end if;
  if v_gender is null or v_gender not in ('female', 'male', 'other', 'prefer_not_to_say') then
    raise exception 'Choose your gender';
  end if;
  select * into v_location from public.locations where id = v_place;
  if not found or v_location.school_id <> v_type.school_id or v_location.status <> 'active' or v_location.access_level = 'restricted' then
    raise exception 'Choose a valid default location';
  end if;

  insert into public.profiles (id, role, display_name, school_id, primary_location_id, user_type_id, status, id_number, gender)
  values (new.id, 'community', v_name, v_type.school_id, v_location.id, v_type.id, 'pending', v_id_number, v_gender);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (new.id, 'user_registered', 'profiles', new.id::text,
          jsonb_build_object('designation', v_type.name, 'role', 'community', 'default_location', v_location.name, 'status', 'pending'));
  return new;
end;
$function$;
