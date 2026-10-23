-- Shared test harness: a throwaway zz_test schema with helpers to impersonate
-- accounts and capture results. Prepended to every test script by
-- tests/database.test.mjs, so each script runs in one transaction that rolls back.

create schema zz_test;
grant usage on schema zz_test to public;
create table zz_test.res (n serial primary key, name text, ok boolean, detail text);
create table zz_test.fx (k text primary key, v text);
grant all on all tables in schema zz_test to public;
grant usage on all sequences in schema zz_test to public;

create function zz_test.f(p_key text) returns text language sql as $f$ select v from zz_test.fx where k = p_key $f$;
create function zz_test.rec(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $f$
begin insert into zz_test.res (name, ok, detail) values (p_name, coalesce(p_ok, false), left(coalesce(p_detail, ''), 140)); end $f$;
create function zz_test.try(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function zz_test.val(p_sql text) returns text language plpgsql as $f$
declare r text; begin execute p_sql into r; return coalesce(r, 'null'); exception when others then return 'ERR: ' || sqlerrm; end $f$;
-- Reads as the table owner, for checking what a Community Member cannot read themselves.
create function zz_test.sval(p_sql text) returns text language plpgsql security definer as $f$
declare r text; begin execute p_sql into r; return coalesce(r, 'null'); exception when others then return 'ERR: ' || sqlerrm; end $f$;
create function zz_test.refused(p_result text, p_fragment text) returns boolean language sql as $f$
select p_result <> 'ok' and p_result ilike '%' || p_fragment || '%' $f$;
create function zz_test.uid(p_email text) returns uuid language sql security definer as $f$ select id from auth.users where email = p_email $f$;
create function zz_test.use_id(p_id uuid) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $f$;
create function zz_test.use(p_email text) returns void language plpgsql as $f$
declare v_id uuid;
begin
  reset role;
  select id into v_id from auth.users where email = p_email;
  if v_id is null then raise exception 'no such test user %', p_email; end if;
  perform zz_test.use_id(v_id);
end $f$;
create function zz_test.use_anon() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
end $f$;
-- Registered accounts start pending; tests that are not about approval approve them straight away.
create function zz_test.reg(p_email text, p_meta jsonb, p_app jsonb default '{}'::jsonb, p_approve boolean default true) returns text language plpgsql as $f$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, p_meta, p_app, now(), now());
  if p_approve then update public.profiles set status = 'approved' where id = v_id; end if;
  return 'ok';
exception when others then return sqlerrm; end $f$;
create function zz_test.meta(p_designation text, p_location text) returns jsonb language sql as $f$
select jsonb_build_object('display_name', 'Test Person', 'designation_id', zz_test.f(p_designation), 'default_location_id', zz_test.f(p_location), 'id_number', 'ZZ-1', 'gender', 'other') $f$;
grant execute on all functions in schema zz_test to public;

