-- handle_new_user() checked raw_app_meta_data ->> 'provisioned' to recognize an
-- account an admin created directly (service key only, so the public sign-up
-- endpoint can never set it). Live testing of the new Add Person flow found
-- that custom app_metadata passed to auth.admin.createUser() is not visible
-- to this trigger at insert time on the current Supabase Auth service (it is
-- merged into the row in a later step) -- confirmed by inspecting
-- raw_app_meta_data live: a brand-new admin-provisioned account showed only
-- {"provider":"email","providers":["email"]}, with no "provisioned" key, even
-- though the same create call's response and a later read of the row both
-- show it. The one signal that *is* visible immediately, because it is a
-- plain column GoTrue sets in the same insert rather than a JSON merge, is
-- email_confirmed_at: only the service key can set it (email_confirm: true
-- on the admin API), never the public sign-up endpoint, which leaves it null
-- until the person clicks the confirmation link. Both checks are kept (OR),
-- so this also honors app_metadata.provisioned if a future platform change
-- makes it visible in time again.

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
    if new.email_confirmed_at is not null or coalesce(new.raw_app_meta_data ->> 'provisioned', '') = 'admin' then
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
