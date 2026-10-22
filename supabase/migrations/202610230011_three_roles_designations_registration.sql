-- Three fixed primary roles, configurable designations, registration, and default location.
--
-- Primary roles (fixed):  system_admin, school_admin, community.
-- Designations (user_types) are data: the System Admin creates them and maps
-- each to exactly one primary role. The role, not the label, grants access.
-- Earlier role labels stay in the Postgres enum (Postgres cannot drop enum
-- values) but a CHECK constraint stops them from being stored.
--
-- Mapping applied to existing data (designation names are kept):
--   system_admin                              -> system_admin
--   school_admin, security, drrm, guidance    -> school_admin
--   student, teacher, non_teaching            -> community
-- Reversible: every account keeps its designation, and each role change is
-- written to audit_logs.

-- ---------------------------------------------------------------------------
-- 1. Retire helpers tied to the old roles
-- ---------------------------------------------------------------------------

drop function if exists public.sentiment_by_location(int);

create or replace function public.is_school_admin()
returns boolean language sql stable security definer set search_path to ''
as $function$ select public.my_role() = 'school_admin'; $function$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to ''
as $function$ select public.my_role() = 'school_admin'; $function$;

create or replace function public.is_system_admin()
returns boolean language sql stable security definer set search_path to ''
as $function$ select public.my_role() = 'system_admin'; $function$;

-- "Reviewer" now means the School Admin role (coordinators and responders).
create or replace function public.is_reviewer()
returns boolean language sql stable security definer set search_path to ''
as $function$ select public.my_role() = 'school_admin'; $function$;

drop function if exists public.is_guidance();
drop function if exists public.is_security();
drop function if exists public.is_drrm();
drop function if exists public.is_teacher();
drop function if exists public.is_non_teaching();
drop function if exists public.is_staff();

-- ---------------------------------------------------------------------------
-- 2. Feature ceilings per primary role (mirrors src/lib/features.ts)
-- ---------------------------------------------------------------------------

create or replace function public.role_feature_ceiling(p_role public.app_role)
returns text[]
language sql immutable set search_path to ''
as $function$
  select array['report.help', 'report.safe', 'report.feeling', 'report.hazard', 'report.incident', 'report.observation', 'alerts.view']
    || case p_role
         when 'school_admin' then array['insights.view', 'queue.view', 'alerts.draft', 'alerts.approve', 'people.manage', 'setup.locations']
         when 'system_admin' then array['people.manage', 'setup.locations', 'setup.user_types']
         else array[]::text[]
       end;
$function$;

create or replace function public.role_default_features(p_role public.app_role)
returns text[]
language sql immutable set search_path to ''
as $function$
  select case p_role
    when 'school_admin' then array_remove(public.role_feature_ceiling(p_role), 'setup.locations')
    when 'system_admin' then array_remove(public.role_feature_ceiling(p_role), 'alerts.view')
    else public.role_feature_ceiling(p_role)
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Designations: new settings, validation, and role sync
-- ---------------------------------------------------------------------------

alter table public.user_types
  add column if not exists selectable_at_signup boolean not null default false,
  add column if not exists authorized_privileged boolean not null default false;

create or replace function public.validate_user_type()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_bad text[];
begin
  new.name := trim(new.name);
  new.features := (select coalesce(array_agg(distinct f order by f), '{}') from unnest(new.features) f);
  select array_agg(f) into v_bad
  from unnest(new.features) f
  where not (f = any (public.role_feature_ceiling(new.base_role)));
  if v_bad is not null then
    raise exception 'not allowed for the % role: %', new.base_role, array_to_string(v_bad, ', ');
  end if;
  if new.selectable_at_signup and new.base_role <> 'community' then
    raise exception 'only designations mapped to Community Member can be open for registration';
  end if;
  if new.base_role = 'system_admin' and not new.authorized_privileged then
    raise exception 'mapping a designation to System Admin needs explicit authorization';
  end if;
  if new.base_role <> 'system_admin' then
    new.authorized_privileged := false;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      if new.is_system then
        raise exception 'the built-in flag is reserved';
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
  new.updated_at := now();
  return new;
end;
$function$;

-- When a designation's role mapping changes, everyone holding it moves to the
-- new role in the same transaction, and each change is audited. The last
-- active System Admin cannot be moved away.
create or replace function public.sync_designation_role()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_row record;
begin
  if new.base_role is not distinct from old.base_role then
    return new;
  end if;
  for v_row in
    select p.id, p.role from public.profiles p
    where p.user_type_id = new.id and p.role is distinct from new.base_role
  loop
    update public.profiles set role = new.base_role, updated_at = now() where id = v_row.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    values (auth.uid(), 'role_changed', 'profiles', v_row.id::text,
            jsonb_build_object('from_role', v_row.role, 'new_role', new.base_role,
                               'via', 'designation_remapped', 'designation', new.name));
  end loop;
  if old.base_role = 'system_admin'
     and not exists (select 1 from public.profiles p where p.school_id = new.school_id and p.role = 'system_admin' and p.is_active) then
    raise exception 'this change would leave the school without an active System Admin';
  end if;
  return new;
end;
$function$;

drop trigger if exists user_types_sync_role on public.user_types;
create trigger user_types_sync_role
  after update of base_role on public.user_types
  for each row execute function public.sync_designation_role();

-- ---------------------------------------------------------------------------
-- 4. Move existing data onto the three roles
-- ---------------------------------------------------------------------------

update public.user_types t
set base_role = m.new_role,
    authorized_privileged = (m.new_role = 'system_admin'),
    features = (select coalesce(array_agg(f order by f), '{}') from unnest(t.features) f where f = any (public.role_feature_ceiling(m.new_role)))
from (
  select id,
         case base_role
           when 'system_admin' then 'system_admin'::public.app_role
           when 'school_admin' then 'school_admin'::public.app_role
           when 'security' then 'school_admin'::public.app_role
           when 'drrm' then 'school_admin'::public.app_role
           when 'guidance' then 'school_admin'::public.app_role
           else 'community'::public.app_role
         end as new_role
  from public.user_types
) m
where m.id = t.id
  and (t.base_role is distinct from m.new_role or (m.new_role = 'system_admin' and not t.authorized_privileged));

-- Accounts without a designation (if any) follow the same mapping.
update public.profiles
set role = case role
             when 'system_admin' then 'system_admin'::public.app_role
             when 'school_admin' then 'school_admin'::public.app_role
             when 'security' then 'school_admin'::public.app_role
             when 'drrm' then 'school_admin'::public.app_role
             when 'guidance' then 'school_admin'::public.app_role
             else 'community'::public.app_role
           end,
    updated_at = now()
where role not in ('system_admin', 'school_admin', 'community');

alter table public.profiles drop constraint if exists profiles_primary_roles_check;
alter table public.profiles add constraint profiles_primary_roles_check
  check (role in ('system_admin', 'school_admin', 'community'));
alter table public.profiles alter column role set default 'community';

alter table public.user_types drop constraint if exists user_types_primary_roles_check;
alter table public.user_types add constraint user_types_primary_roles_check
  check (base_role in ('system_admin', 'school_admin', 'community'));
alter table public.user_types drop constraint if exists user_types_signup_community_only;
alter table public.user_types add constraint user_types_signup_community_only
  check (not selectable_at_signup or base_role = 'community');
alter table public.user_types drop constraint if exists user_types_system_admin_authorized;
alter table public.user_types add constraint user_types_system_admin_authorized
  check (base_role <> 'system_admin' or authorized_privileged);

alter table public.alerts drop constraint if exists alerts_target_primary_role_check;
alter table public.alerts add constraint alerts_target_primary_role_check
  check (target_role is null or target_role in ('system_admin', 'school_admin', 'community'));

-- ---------------------------------------------------------------------------
-- 5. Row-level security for the three roles
-- ---------------------------------------------------------------------------

drop policy if exists alerts_insert_staff on public.alerts;
create policy alerts_insert_staff on public.alerts for insert to authenticated
  with check (public.my_role() = 'school_admin' and school_id = public.my_school_id() and created_by = auth.uid() and status = 'draft');

-- School Admins read and review every submission, including individual feelings.
drop policy if exists submissions_select_guidance on public.submissions;
drop policy if exists submissions_select_staff_non_sentiment on public.submissions;
drop policy if exists submissions_update_guidance on public.submissions;
drop policy if exists submissions_update_staff_non_sentiment on public.submissions;
drop policy if exists submissions_select_admin on public.submissions;
drop policy if exists submissions_update_admin on public.submissions;
create policy submissions_select_admin on public.submissions for select to authenticated
  using (school_id = public.my_school_id() and public.my_role() = 'school_admin');
create policy submissions_update_admin on public.submissions for update to authenticated
  using (school_id = public.my_school_id() and public.my_role() = 'school_admin')
  with check (school_id = public.my_school_id() and public.my_role() = 'school_admin');

-- Attachments follow the submission's school; the old self-comparing subquery
-- (s.school_id = s.school_id) is gone.
drop policy if exists report_attachments_select_scoped on public.report_attachments;
drop policy if exists report_attachments_delete_scoped on public.report_attachments;
create policy report_attachments_select_scoped on public.report_attachments for select to authenticated
  using (school_id = public.my_school_id() and public.my_role() = 'school_admin');
create policy report_attachments_delete_scoped on public.report_attachments for delete to authenticated
  using (school_id = public.my_school_id() and public.my_role() = 'school_admin');

drop policy if exists report_photos_select_scoped on storage.objects;
create policy report_photos_select_scoped on storage.objects for select to authenticated
  using (bucket_id = 'report-photos' and (storage.foldername(name))[1] = public.my_school_id()::text and public.my_role() = 'school_admin');
drop policy if exists report_photos_delete_scoped on storage.objects;
create policy report_photos_delete_scoped on storage.objects for delete to authenticated
  using (bucket_id = 'report-photos' and (owner_id = auth.uid()::text
         or ((storage.foldername(name))[1] = public.my_school_id()::text and public.my_role() = 'school_admin')));

-- ---------------------------------------------------------------------------
-- 6. Only active places can be used for new reports (patched definitions)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_incident()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_location public.locations%rowtype;
  v_open record;
begin
  -- Case reference is always generated server-side
  new.case_ref := public.next_case_ref();

  if auth.uid() is not null then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.created_by is distinct from auth.uid() then
      raise exception 'incident must be raised by yourself';
    end if;
  end if;

  if new.category not in ('emergency', 'medical', 'security', 'other') then
    raise exception 'invalid incident category';
  end if;
  if char_length(new.description) < 3 or char_length(new.description) > 2000 then
    raise exception 'description must be between 3 and 2000 characters';
  end if;
  if new.status <> 'new' then
    raise exception 'new incidents must start as new';
  end if;

  if new.location_id is not null then
    select * into v_location from public.locations where id = new.location_id;
    if not found then
      raise exception 'location not found';
    end if;
    if v_location.school_id <> new.school_id then
      raise exception 'location belongs to a different school';
    end if;
    if v_location.status <> 'active' then
      raise exception 'that location is not active; choose another place';
    end if;
  end if;

  -- Duplicate protection: one open incident per person per 5 minutes
  select i.id, i.case_ref into v_open
  from public.incidents i
  where i.created_by = new.created_by
    and i.status in ('new', 'acknowledged', 'assigned', 'in_progress')
    and i.created_at > now() - interval '5 minutes'
  order by i.created_at desc
  limit 1;

  if found then
    raise exception 'you already have an open incident (%); please wait before raising another', v_open.case_ref;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_check_in()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_location public.locations%rowtype;
begin
  if auth.uid() is not null then
    new.profile_id := coalesce(new.profile_id, auth.uid());
    if new.profile_id is distinct from auth.uid() then
      raise exception 'check-in must be recorded for yourself';
    end if;
  end if;

  if new.period is not null and char_length(new.period) > 60 then
    raise exception 'period label is too long';
  end if;

  -- staff_verified may only be set by reviewers
  if new.location_source = 'staff_verified' and not public.is_reviewer() then
    raise exception 'only responders or administrators can record a staff-verified location';
  end if;

  -- Optional location: must exist, be in the same school, and be active
  if new.location_id is not null then
    select * into v_location from public.locations where id = new.location_id;
    if not found then
      raise exception 'location not found';
    end if;
    if v_location.school_id <> new.school_id then
      raise exception 'location belongs to a different school';
    end if;
    if v_location.status <> 'active' then
      raise exception 'that location is not active; choose another place';
    end if;
  end if;

  -- A schedule-derived check-in must match an active schedule for today
  if new.location_source = 'schedule_derived' then
    if new.location_id is null then
      raise exception 'a schedule-derived check-in needs a location';
    end if;
    if not exists (
      select 1 from public.schedules s
      where s.location_id = new.location_id
        and s.status = 'active'
        and s.day_of_week = extract(dow from current_date)::int
        and s.effective_from <= current_date
        and (s.effective_until is null or s.effective_until >= current_date)
    ) then
      raise exception 'no active schedule for that location today';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submittable_location(p_location_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.locations l
    where l.id = p_location_id
      and l.school_id = public.my_school_id()
      and l.status = 'active'
  );
$function$;


-- ---------------------------------------------------------------------------
-- 7. Registration: community members only, validated by the database
-- ---------------------------------------------------------------------------
-- The browser can set user metadata at sign-up, so nothing in it is trusted:
-- a role value is ignored, the designation must be active, open for
-- registration, and mapped to Community Member, and the default location must
-- be an active, non-restricted place in the designation's school. A sign-up
-- without registration details is refused unless an administrator provisioned
-- the account (app_metadata is only writable with the service key).

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
      insert into public.profiles (id, role) values (new.id, 'community');
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

  insert into public.profiles (id, role, display_name, school_id, primary_location_id, user_type_id)
  values (new.id, 'community', v_name, v_type.school_id, v_location.id, v_type.id);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  values (new.id, 'user_registered', 'profiles', new.id::text,
          jsonb_build_object('designation', v_type.name, 'role', 'community', 'default_location', v_location.name));
  return new;
end;
$function$;

-- What the public sign-up form may show: community designations that are open
-- for registration and the school's active, non-restricted places. Single
-- school: the oldest active school is used.
create or replace function public.registration_options()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_school uuid := (select id from public.schools where status = 'active' order by created_at limit 1);
  v_designations jsonb;
  v_locations jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'description', t.description) order by t.name), '[]'::jsonb)
    into v_designations
  from public.user_types t
  where t.school_id = v_school and t.is_active and t.selectable_at_signup and t.base_role = 'community';

  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'parent_id', l.parent_id, 'level', c.level) order by l.name), '[]'::jsonb)
    into v_locations
  from public.locations l
  join public.location_categories c on c.id = l.category_id
  where l.school_id = v_school and l.status = 'active' and l.access_level <> 'restricted';

  return jsonb_build_object('open', jsonb_array_length(v_designations) > 0, 'designations', v_designations, 'locations', v_locations);
end;
$function$;

revoke all on function public.registration_options() from public;
grant execute on function public.registration_options() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Default location (profiles.primary_location_id)
-- ---------------------------------------------------------------------------

create or replace function public.set_my_default_location(p_location_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_location public.locations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  select * into v_location from public.locations where id = p_location_id;
  if not found or v_location.school_id is distinct from public.my_school_id() then
    raise exception 'location not found';
  end if;
  if v_location.status <> 'active' or v_location.access_level = 'restricted' then
    raise exception 'choose an active location';
  end if;
  update public.profiles set primary_location_id = v_location.id, updated_at = now() where id = auth.uid();
end;
$function$;

revoke all on function public.set_my_default_location(uuid) from public, anon;
grant execute on function public.set_my_default_location(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Assigning designations: the only way to change a person's role
-- ---------------------------------------------------------------------------

drop function if exists public.admin_set_user_role(uuid, public.app_role);

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
  if (v_old.role = 'system_admin' or v_type.base_role = 'system_admin') and not public.is_system_admin() then
    raise exception 'only a System Admin can assign or change System Admins';
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

revoke all on function public.admin_set_user_type(uuid, uuid) from public, anon;
grant execute on function public.admin_set_user_type(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Dashboard counts for the three roles
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_counts()
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_school uuid := public.my_school_id();
  v_role public.app_role;
  v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if v_school is null then
    raise exception 'no school is assigned to this account';
  end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid();

  v_out := v_out || jsonb_build_object(
    'role', coalesce(v_role::text, 'unknown'),
    'my_check_ins_today', (select count(*) from public.check_ins c where c.school_id = v_school and c.profile_id = auth.uid() and c.checked_in_at >= current_date),
    'my_need_help', (select count(*) from public.check_ins c where c.school_id = v_school and c.profile_id = auth.uid() and c.status = 'need_help'),
    'my_open_incidents', (select count(*) from public.incidents i where i.school_id = v_school and i.created_by = auth.uid() and i.status in ('new', 'acknowledged', 'assigned', 'in_progress'))
  );

  if v_role = 'school_admin' then
    v_out := v_out || jsonb_build_object(
      'submissions_open', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved'),
      'submissions_hazard_open', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'incident_hazard'),
      'submissions_observation_open', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'observation'),
      'submissions_sentiment_open', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved' and s.kind = 'sentiment'),
      'school_open_reports', (select count(*) from public.submissions s where s.school_id = v_school and s.status <> 'resolved'),
      'school_open_incidents', (select count(*) from public.incidents i where i.school_id = v_school and i.status in ('new', 'acknowledged', 'assigned', 'in_progress')),
      'school_unacknowledged_incidents', (select count(*) from public.incidents i where i.school_id = v_school and i.status = 'new'),
      'school_oldest_unacknowledged_minutes', (select coalesce(floor(extract(epoch from (now() - min(i.created_at))) / 60)::bigint, 0) from public.incidents i where i.school_id = v_school and i.status = 'new'),
      'school_check_ins_today', (select count(*) from public.check_ins c where c.school_id = v_school and c.checked_in_at >= current_date),
      'school_need_help', (select count(*) from public.check_ins c where c.school_id = v_school and c.status = 'need_help'),
      'users_total', (select count(*) from public.profiles p where p.school_id = v_school),
      'users_by_role', (select coalesce(jsonb_object_agg(r.role::text, r.n), '{}'::jsonb) from (select p.role, count(*) as n from public.profiles p where p.school_id = v_school group by p.role) r),
      'audit_rows_30d', (select count(*) from public.audit_logs a where a.created_at > now() - interval '30 days')
    );
  end if;
  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 11. Least privilege on profiles: reads only; changes go through the
--     functions above.
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon;
revoke insert, update, delete, truncate, references, trigger on public.profiles from authenticated;
