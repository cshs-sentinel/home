-- Supersedes the email_confirmed_at attempt in migration 0013: that signal
-- turned out not to be visible to this trigger at insert time either, for
-- the same reason app_metadata wasn't (GoTrue appears to finish the row in a
-- later step than the one this AFTER INSERT trigger fires on). The one field
-- that *is* reliably visible immediately, confirmed by live testing, is
-- user_metadata (raw_user_meta_data) -- it is what the existing public
-- sign-up path already reads for designation_id.
--
-- So an admin-provisioned account (School Admin, System Admin, or an
-- admin-added Community Member -- People > Add person, or the seed script)
-- now proves itself with a secret placed in user_metadata, read from a
-- table only server-side (service-key) code can see. The public, anonymous
-- sign-up endpoint can set arbitrary user_metadata too, but has no way to
-- read this table, so it cannot forge the value. This repo is public, so
-- the secret is generated here, inside the database, and is never written
-- to a file or committed -- not even this migration.
--
-- With a valid secret, any active position and role is accepted, a default
-- location is optional, and the account is approved immediately. Without
-- one, the original public sign-up rules still apply in full (Community
-- Member only, open for sign-up, a valid required location, starts
-- pending).

create table if not exists public._provision_secrets (
  id boolean primary key default true,
  secret text not null,
  constraint _provision_secrets_singleton check (id)
);

alter table public._provision_secrets enable row level security;
revoke all on public._provision_secrets from public, anon, authenticated;

insert into public._provision_secrets (id, secret)
values (true, encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

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
