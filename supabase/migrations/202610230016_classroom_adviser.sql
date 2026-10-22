-- A new position, Classroom Adviser, differs from a regular Community
-- Member account in exactly one way: it can approve (or decline) a pending
-- Community Member registration whose chosen Specific Location is the same
-- as the adviser's own default location (their classroom/section) -- never
-- school-wide, and never anything else a School Admin or System Admin can
-- do (no reports, no incidents, no other people's positions). The ability
-- is a column on the position (can_approve_own_location), the same pattern
-- already used for selectable_at_signup and authorized_privileged, so a
-- System Admin can grant it to any Community Member position, not only the
-- one seeded here.

alter table public.user_types add column if not exists can_approve_own_location boolean not null default false;

insert into public.user_types (school_id, name, description, base_role, features, is_active, is_system, selectable_at_signup, authorized_privileged, can_approve_own_location)
select s.id, 'Classroom Adviser',
       'A teacher who can approve Community Member sign-ups for their own classroom or location.',
       'community',
       array['report.help', 'report.safe', 'report.feeling', 'report.hazard', 'report.incident', 'report.observation', 'alerts.view']::text[],
       true, false, false, false, true
from public.schools s
where s.status = 'active'
on conflict (school_id, lower(name)) do nothing;

-- Approving or declining: a School Admin or System Admin still does it for
-- anyone in the school; a Classroom Adviser (or any position with
-- can_approve_own_location) only for a pending account whose
-- primary_location_id matches their own.

create or replace function public.approve_registration(target_user_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_row public.profiles%rowtype;
  v_actor_row public.profiles%rowtype;
  v_scoped boolean;
  v_wide boolean := public.is_school_admin() or public.is_system_admin();
begin
  select * into v_actor_row from public.profiles where id = v_actor and is_active;
  select coalesce(t.can_approve_own_location, false) into v_scoped
  from public.user_types t where t.id = v_actor_row.user_type_id;

  if not (v_wide or v_scoped) then
    raise exception 'permission denied: school or system administrator required';
  end if;
  select * into v_row from public.profiles where id = target_user_id;
  if not found or v_row.school_id is distinct from public.my_school_id() then
    raise exception 'user not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this registration is not awaiting approval';
  end if;
  if not v_wide and (v_actor_row.primary_location_id is null or v_row.primary_location_id is distinct from v_actor_row.primary_location_id) then
    raise exception 'you can only approve registrations for your own location';
  end if;
  update public.profiles set status = 'approved', updated_at = now() where id = target_user_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'registration_approved', 'profiles', target_user_id::text, jsonb_build_object('display_name', v_row.display_name));
end;
$function$;

create or replace function public.reject_registration(target_user_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_row public.profiles%rowtype;
  v_actor_row public.profiles%rowtype;
  v_scoped boolean;
  v_wide boolean := public.is_school_admin() or public.is_system_admin();
begin
  select * into v_actor_row from public.profiles where id = v_actor and is_active;
  select coalesce(t.can_approve_own_location, false) into v_scoped
  from public.user_types t where t.id = v_actor_row.user_type_id;

  if not (v_wide or v_scoped) then
    raise exception 'permission denied: school or system administrator required';
  end if;
  select * into v_row from public.profiles where id = target_user_id;
  if not found or v_row.school_id is distinct from public.my_school_id() then
    raise exception 'user not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'this registration is not awaiting approval';
  end if;
  if not v_wide and (v_actor_row.primary_location_id is null or v_row.primary_location_id is distinct from v_actor_row.primary_location_id) then
    raise exception 'you can only decline registrations for your own location';
  end if;
  update public.profiles set status = 'rejected', is_active = false, updated_at = now() where id = target_user_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (v_actor, 'registration_rejected', 'profiles', target_user_id::text, jsonb_build_object('display_name', v_row.display_name));
end;
$function$;

-- What a Classroom Adviser's People tab shows: just the pending Community
-- Members at their own location. A School Admin or System Admin gets every
-- pending account in the school (they already read this through the regular
-- `profiles` select in the full People panel, so they don't call this).

create or replace function public.pending_in_my_location()
returns table (id uuid, display_name text, created_at timestamptz, designation text)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_row public.profiles%rowtype;
  v_scoped boolean;
begin
  select * into v_actor_row from public.profiles where id = v_actor and is_active;
  select coalesce(t.can_approve_own_location, false) into v_scoped
  from public.user_types t where t.id = v_actor_row.user_type_id;

  if not v_scoped or v_actor_row.primary_location_id is null then
    return;
  end if;

  return query
    select p.id, p.display_name, p.created_at, ut.name
    from public.profiles p
    left join public.user_types ut on ut.id = p.user_type_id
    where p.school_id = v_actor_row.school_id
      and p.status = 'pending'
      and p.primary_location_id = v_actor_row.primary_location_id
    order by p.created_at;
end;
$function$;

revoke all on function public.pending_in_my_location() from public, anon;
grant execute on function public.pending_in_my_location() to authenticated;
