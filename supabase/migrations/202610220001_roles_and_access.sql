-- SENTINEL authorization foundation.
-- Apply with `supabase db push` after linking this repository to the Supabase project.
--
-- NOTE (2026-10-22): the connected Supabase project's live schema has diverged from this
-- file — it uses a single `app_role` enum on `profiles.role` (student/teacher/non_teaching/
-- security/drrm/guidance/school_admin/system_admin) rather than the `sentinel_role` type and
-- separate `user_roles`/`role_audit_log` tables defined below, and already has additional
-- tables (schools, incidents, submissions, alerts, schedules, audit_logs, ...) not tracked
-- here. Do not run this migration against that project as-is. See
-- docs/roles-and-permissions.md for the roles actually enforced, and consider a
-- `supabase db pull` to resync migration history with reality.

create type public.sentinel_role as enum (
  'school_community',
  'designated_personnel',
  'school_leader',
  'system_administrator'
);

create type public.location_type as enum (
  'campus',
  'building',
  'floor',
  'room',
  'outdoor_area',
  'other'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 2 and 120),
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.sentinel_role not null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- This table is deliberately public-readable: locations may be shown in public
-- reports and surveys. Changes are restricted to ICT/system administrators.
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.locations(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 2 and 120),
  type public.location_type not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_id, name)
);

create table public.role_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  subject_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('role_assigned', 'role_revoked', 'account_disabled', 'account_enabled')),
  role public.sentinel_role,
  occurred_at timestamptz not null default now()
);

-- Every authenticated user starts with the least-privileged community role.
-- School Leaders promote accounts after identity verification.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(new.email, 'Member'), '@', 1), 'Member'),
    new.email
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'school_community')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.role_audit_log (actor_id, subject_id, action, role)
    values (auth.uid(), new.user_id, 'role_assigned', new.role);
    return new;
  end if;

  insert into public.role_audit_log (actor_id, subject_id, action, role)
  values (auth.uid(), old.user_id, 'role_revoked', old.role);
  return old;
end;
$$;

create trigger on_user_role_changed
  after insert or delete on public.user_roles
  for each row execute procedure public.audit_role_change();

create or replace function public.has_role(required_role public.sentinel_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = required_role
  );
$$;

create or replace function public.is_school_leader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.has_role('school_leader'); $$;

create or replace function public.can_manage_accounts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role('school_leader')
      or public.has_role('system_administrator');
$$;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.locations enable row level security;
alter table public.role_audit_log enable row level security;

create policy "users view their own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.can_manage_accounts());

create policy "account managers update profiles"
  on public.profiles for update to authenticated
  using (public.can_manage_accounts()) with check (public.can_manage_accounts());

create policy "account managers view role assignments"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.can_manage_accounts());

-- Only a school leader may grant or revoke high-impact roles.
create policy "school leaders manage role assignments"
  on public.user_roles for all to authenticated
  using (public.is_school_leader()) with check (public.is_school_leader());

create policy "anyone reads active locations"
  on public.locations for select to anon, authenticated
  using (active = true or public.can_manage_accounts());

create policy "system administrators manage locations"
  on public.locations for all to authenticated
  using (public.can_manage_accounts()) with check (public.can_manage_accounts());

create policy "school leaders read role audit log"
  on public.role_audit_log for select to authenticated
  using (public.is_school_leader());

comment on type public.sentinel_role is
  'school_community submits surveys/reports; designated_personnel manages safety workflows; school_leader has operational authority; system_administrator manages accounts and locations.';
