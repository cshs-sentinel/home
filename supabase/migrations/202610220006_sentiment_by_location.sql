-- Privacy-safe sentiment totals for the campus heatmap.
--
-- School Admins cannot read individual feelings (RLS keeps those with
-- Guidance). This function gives them, and Guidance, per-place totals only:
-- the number of feelings and the average stress, counted toward the place
-- and every place above it.
--
-- Two rules keep small groups private:
-- 1. A place with fewer than 3 feelings is never shown.
-- 2. Complementary suppression: inside any shown place, the feelings that are
--    not shown (hidden child places plus feelings filed at the place itself)
--    must total 0 or at least 3. Otherwise subtracting the shown parts from
--    the total would reveal a group of 1 or 2. When that happens the smallest
--    shown child is hidden too (or, if there is none, the place itself), and
--    the check repeats until nothing can be worked out by subtraction.

create or replace function public.sentiment_by_location(p_days int)
returns table (location_id uuid, entries int, avg_stress numeric)
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_school uuid := public.my_school_id();
  v_days int := least(greatest(coalesce(p_days, 14), 1), 90);
  v_place uuid;
  v_child uuid;
  v_changed boolean;
begin
  if not (public.is_school_admin() or public.is_guidance()) then
    raise exception 'permission denied: school admin or guidance required';
  end if;
  if v_school is null then
    raise exception 'no school is assigned to this account';
  end if;

  drop table if exists pg_temp.sentiment_totals;
  create temp table sentiment_totals (
    place_id uuid primary key,
    parent_id uuid,
    entries int not null,
    stress_sum numeric not null,
    direct_entries int not null,
    shown boolean not null
  ) on commit drop;

  insert into sentiment_totals
  with recursive feelings as (
    select s.location_id as place_id, s.stress_level
    from public.submissions s
    where s.school_id = v_school
      and s.kind = 'sentiment'
      and s.location_id is not null
      and s.stress_level is not null
      and s.created_at >= now() - make_interval(days => v_days)
  ),
  credited (place_id, stress_level, depth) as (
    select f.place_id, f.stress_level, 0 from feelings f
    union all
    select l.parent_id, c.stress_level, c.depth + 1
    from credited c
    join public.locations l on l.id = c.place_id
    where l.parent_id is not null and c.depth < 100
  ),
  agg as (
    select c.place_id, count(*)::int as entries, sum(c.stress_level)::numeric as stress_sum
    from credited c
    group by c.place_id
  )
  select a.place_id,
         l.parent_id,
         a.entries,
         a.stress_sum,
         (select count(*)::int from feelings f where f.place_id = a.place_id),
         a.entries >= 3
  from agg a
  join public.locations l on l.id = a.place_id;

  loop
    v_changed := false;
    for v_place in
      select t.place_id from sentiment_totals t where t.shown order by t.entries
    loop
      if (
        select t.direct_entries + coalesce((
          select sum(c.entries) from sentiment_totals c where c.parent_id = t.place_id and not c.shown
        ), 0)
        from sentiment_totals t where t.place_id = v_place
      ) between 1 and 2 then
        select c.place_id into v_child
        from sentiment_totals c
        where c.parent_id = v_place and c.shown
        order by c.entries, c.place_id
        limit 1;
        update sentiment_totals set shown = false where place_id = coalesce(v_child, v_place);
        v_changed := true;
        exit;
      end if;
    end loop;
    exit when not v_changed;
  end loop;

  return query
  select t.place_id, t.entries, round(t.stress_sum / t.entries, 2)
  from sentiment_totals t
  where t.shown;
end;
$function$;

revoke all on function public.sentiment_by_location(int) from public, anon;
grant execute on function public.sentiment_by_location(int) to authenticated;
