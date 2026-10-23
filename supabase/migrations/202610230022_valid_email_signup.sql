-- Public sign-up now checks the email address itself, because email confirmation is off.
-- Anyone can create an account, so the database refuses:
--   * an address that is not a well-formed email (for example no domain or no dot in the domain)
--   * an address on a known disposable or temporary mailbox service
-- Accounts an administrator adds (Add Person, the seed script) are not checked here; the
-- admin-create-user function already validated the address before it created them.
-- The rest of the function is unchanged from migration 0015.

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
  v_disposable text[] := array[
    'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'tempmail.com',
    'temp-mail.org', 'yopmail.com', 'trashmail.com', 'throwawaymail.com', 'sharklasers.com',
    'getnada.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mailnesia.com'
  ];
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

  -- Public sign-up: the email must be a real-looking address on a permanent mailbox.
  if new.email is null or char_length(new.email) > 254
     or new.email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+([.][A-Za-z0-9-]+)*[.][A-Za-z]{2,}$' then
    raise exception 'Enter a valid email address';
  end if;
  if split_part(lower(new.email), '@', 2) = any (v_disposable) then
    raise exception 'Use a permanent email address, not a temporary one';
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
