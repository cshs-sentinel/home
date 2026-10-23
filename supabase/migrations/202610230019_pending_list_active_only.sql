-- pending_in_my_location() listed deactivated accounts that were still marked
-- pending (for example an account an admin switched off before it was ever
-- approved). A Classroom Adviser has nothing to decide about those, and the
-- full People panel already hides inactive accounts. Only active accounts are
-- listed now. Found while testing the Classroom Adviser's People tab in the browser.

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
      and p.is_active
      and p.primary_location_id = v_actor_row.primary_location_id
    order by p.created_at;
end;
$function$;
