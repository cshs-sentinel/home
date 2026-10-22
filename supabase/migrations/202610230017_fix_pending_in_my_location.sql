-- pending_in_my_location() declares a RETURNS TABLE(id uuid, ...), which
-- implicitly declares `id` as a PL/pgSQL variable for the whole function
-- body, not just the final RETURN QUERY. The lookup of the caller's own
-- profile used an unqualified `where id = v_actor`, which Postgres then
-- read as ambiguous between that variable and profiles.id (confirmed live:
-- "column reference \"id\" is ambiguous"). Table-qualifying it fixes it.

create or replace function public.pending_in_my_location()
returns table (id uuid, display_name text, created_at timestamptz, designation text)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_actor_row public.profiles%rowtype;
  v_scoped boolean;
begin
  select * into v_actor_row from public.profiles me where me.id = v_actor and me.is_active;
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
