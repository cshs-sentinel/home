-- Evidence-based automatic priority.
--
-- Until now an incident's starting Severity / Urgency / Affected population came
-- from its category alone. The database now reads the report itself and raises
-- (never lowers) the category starting point when the evidence says so:
--
--   1. The reporter's own detail text: life-threat words raise Severity to 4,
--      "still happening / spreading" words raise Urgency to 4, and words for
--      many people raise Affected population by 1 (English and Filipino).
--   2. Where it was reported: a spreading hazard reported for a whole building
--      or campus affects at least a class (Affected population >= 3).
--   3. Corroboration: other people reporting the same category nearby within
--      30 minutes. One other reporter adds 1 to Affected population; two or more
--      also add 1 to Urgency; five or more reporters in all set Affected to 4.
--      Earlier reports in the same cluster that no responder has scored yet are
--      raised too, so every copy of the same event reads the same.
--
-- Every adjustment is written to incidents.priority_basis as a plain sentence,
-- so a School Admin sees why the score is what it is before confirming or
-- changing it with set_incident_priority (which stays the only way to lower it).
-- Each factor stays within 1-4, so P = S + U + A still runs from 3 to 12.

alter table public.incidents add column if not exists priority_basis text[];

-- ---------------------------------------------------------------------------
-- Location helpers
-- ---------------------------------------------------------------------------

-- A place and every place above it, nearest first.
create or replace function public.location_lineage(p_location uuid)
returns uuid[]
language sql stable set search_path to ''
as $function$
  with recursive up as (
    select l.id, l.parent_id, 0 as depth from public.locations l where l.id = p_location
    union all
    select p.id, p.parent_id, up.depth + 1 from public.locations p join up on p.id = up.parent_id where up.depth < 10
  )
  select coalesce(array_agg(id order by depth), '{}') from up;
$function$;

create or replace function public.location_level(p_location uuid)
returns smallint
language sql stable set search_path to ''
as $function$
  select c.level from public.locations l join public.location_categories c on c.id = l.category_id where l.id = p_location;
$function$;

-- Hazards that reach everyone in a building rather than one room.
create or replace function public.is_spreading_category(p_category text)
returns boolean
language sql immutable set search_path to ''
as $function$
  select p_category in ('fire_smoke', 'structural_damage', 'electrical_hazard', 'water_chemical_spill', 'threat_violence', 'suspicious_person', 'emergency', 'security');
$function$;

-- Two reports are "nearby" when they are the same place, one place holds the
-- other, or they share a building or area. Spreading hazards also match
-- anywhere in the same building.
create or replace function public.locations_nearby(p_a uuid, p_b uuid, p_spreading boolean)
returns boolean
language plpgsql stable set search_path to ''
as $function$
declare
  v_a uuid[];
  v_b uuid[];
  v_parent_a uuid;
  v_building_a uuid;
  v_building_b uuid;
begin
  if p_a is null or p_b is null then
    return false;
  end if;
  if p_a = p_b then
    return true;
  end if;
  v_a := public.location_lineage(p_a);
  v_b := public.location_lineage(p_b);
  if p_a = any (v_b) or p_b = any (v_a) then
    return true;
  end if;
  v_parent_a := v_a[2];
  if v_parent_a is not null and v_parent_a = v_b[2] and coalesce(public.location_level(v_parent_a), 1) >= 2 then
    return true;
  end if;
  if p_spreading then
    select x into v_building_a from unnest(v_a) x where public.location_level(x) = 2 limit 1;
    select x into v_building_b from unnest(v_b) x where public.location_level(x) = 2 limit 1;
    return v_building_a is not null and v_building_a = v_building_b;
  end if;
  return false;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The assessment
-- ---------------------------------------------------------------------------

create or replace function public.assess_incident_priority(
  p_school uuid,
  p_category text,
  p_location uuid,
  p_description text,
  p_created_by uuid,
  p_at timestamptz,
  p_exclude uuid
)
returns table (severity smallint, urgency smallint, affected smallint, basis text[])
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_base smallint[] := public.default_incident_priority(p_category);
  v_s int := v_base[1];
  v_u int := v_base[2];
  v_a int := v_base[3];
  v_basis text[];
  v_detail text;
  v_hit text;
  v_spreading boolean := public.is_spreading_category(p_category);
  v_others int;
begin
  v_basis := array[format('Starting scores for %s: S %s, U %s, A %s.', lower(replace(p_category, '_', ' ')), v_s, v_u, v_a)];

  -- 1. The reporter's own words. Quick reports put them after "Detail:"; the
  -- generated sentence before it is ignored.
  v_detail := lower(coalesce(p_description, ''));
  if position('detail:' in v_detail) > 0 then
    v_detail := substr(v_detail, position('detail:' in v_detail) + 7);
  elsif v_detail like '% using quick report.' then
    v_detail := '';
  end if;

  if v_detail <> '' then
    v_hit := substring(v_detail from '\m(unconscious|not breathing|cannot breathe|can''t breathe|bleeding|blood|weapon|gun|knife|trapped|collapsed|explosion|seizure|walang malay|hindi humihinga|dugo|baril|kutsilyo|patalim|naipit|gumuho|sumabog|nangingisay)\M');
    if v_hit is not null and v_s < 4 then
      v_s := 4;
      v_basis := v_basis || format('Severity raised to 4: the detail mentions "%s".', v_hit);
    end if;

    v_hit := substring(v_detail from '\m(spreading|getting worse|right now|still happening|ongoing|kumakalat|lumalala|ngayon na|nangyayari pa)\M');
    if v_hit is not null and v_u < 4 then
      v_u := 4;
      v_basis := v_basis || format('Urgency raised to 4: the detail says "%s".', v_hit);
    end if;

    v_hit := substring(v_detail from '\m(many|several|everyone|whole class|students|crowd|lahat|marami|maraming|buong klase|mga estudyante)\M');
    if v_hit is not null and v_a < 4 then
      v_a := v_a + 1;
      v_basis := v_basis || format('Affected population +1: the detail mentions "%s".', v_hit);
    end if;
  end if;

  -- 2. A spreading hazard reported for a whole building or campus.
  if p_location is not null and v_spreading and coalesce(public.location_level(p_location), 4) <= 2 and v_a < 3 then
    v_a := 3;
    v_basis := v_basis || 'Affected population raised to 3: reported for a whole building or campus.'::text;
  end if;

  -- 3. Other people reporting the same thing nearby within 30 minutes.
  if p_location is not null then
    select count(distinct i.created_by) into v_others
    from public.incidents i
    where i.school_id = p_school
      and i.category = p_category
      and i.id is distinct from p_exclude
      and i.created_by is distinct from p_created_by
      and i.status in ('pending_evaluation', 'new', 'acknowledged', 'assigned', 'in_progress')
      and i.created_at between p_at - interval '30 minutes' and p_at + interval '30 minutes'
      and public.locations_nearby(p_location, i.location_id, v_spreading);

    if v_others >= 1 and v_a < 4 then
      v_a := v_a + 1;
      v_basis := v_basis || format('Affected population +1: %s other %s reported this nearby within 30 minutes.', v_others, case when v_others = 1 then 'person' else 'people' end);
    end if;
    if v_others >= 2 and v_u < 4 then
      v_u := v_u + 1;
      v_basis := v_basis || format('Urgency +1: %s separate reporters confirm it.', v_others + 1);
    end if;
    if v_others >= 4 and v_a < 4 then
      v_a := 4;
      v_basis := v_basis || format('Affected population raised to 4: %s separate reporters.', v_others + 1);
    end if;
  end if;

  severity := least(v_s, 4);
  urgency := least(v_u, 4);
  affected := least(v_a, 4);
  basis := v_basis;
  return next;
end;
$function$;

revoke all on function public.assess_incident_priority(uuid, text, uuid, text, uuid, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Incident validation (from 202610230018) with the assessment in place of the
-- category-only defaults
-- ---------------------------------------------------------------------------

create or replace function public.validate_incident()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_location public.locations%rowtype;
  v_open record;
  v_reading record;
  v_button_category boolean;
begin
  -- Case reference is always generated server-side
  new.case_ref := public.next_case_ref();

  if auth.uid() is not null then
    new.created_by := coalesce(new.created_by, auth.uid());
    if new.created_by is distinct from auth.uid() then
      raise exception 'incident must be raised by yourself';
    end if;
  end if;

  if new.category not in (
    'emergency', 'medical', 'security', 'other',
    'bullying', 'suspicious_person', 'fire_smoke', 'electrical_hazard', 'structural_damage',
    'injury_accident', 'threat_violence', 'water_chemical_spill', 'unsafe_facility', 'other_concern'
  ) then
    raise exception 'invalid incident category';
  end if;
  v_button_category := new.category not in ('emergency', 'medical', 'security', 'other');

  if char_length(new.description) < 3 or char_length(new.description) > 2000 then
    raise exception 'description must be between 3 and 2000 characters';
  end if;
  if new.status not in ('new', 'pending_evaluation') then
    raise exception 'new incidents must start as new or pending evaluation';
  end if;

  -- Whatever the browser sent, a report from anyone but a School Admin waits
  -- for evaluation; a School Admin's own report goes straight into the workflow.
  new.status := case when public.is_reviewer() then 'new' else 'pending_evaluation' end;

  if v_button_category and new.location_id is null then
    raise exception 'choose where this happened';
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
    and i.status in ('pending_evaluation', 'new', 'acknowledged', 'assigned', 'in_progress')
    and i.created_at > now() - interval '5 minutes'
  order by i.created_at desc
  limit 1;

  if found then
    raise exception 'you already have an open incident (%); please wait before raising another', v_open.case_ref;
  end if;

  -- Priority factors are read by the system from the report, never set by the reporter.
  select * into v_reading
  from public.assess_incident_priority(new.school_id, new.category, new.location_id, new.description, new.created_by, coalesce(new.created_at, now()), new.id);
  new.priority_severity := v_reading.severity;
  new.priority_urgency := v_reading.urgency;
  new.priority_affected := v_reading.affected;
  new.priority_basis := v_reading.basis;
  new.priority_set_by := null;
  new.priority_set_at := null;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- A new report also re-reads earlier, not-yet-scored reports of the same thing
-- nearby, so the first report of an event rises with the ones after it.
-- ---------------------------------------------------------------------------

create or replace function public.reassess_nearby_incidents()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_other public.incidents%rowtype;
  v_reading record;
begin
  if new.location_id is null then
    return null;
  end if;
  for v_other in
    select i.* from public.incidents i
    where i.school_id = new.school_id
      and i.category = new.category
      and i.id <> new.id
      and i.priority_set_by is null
      and i.status in ('pending_evaluation', 'new', 'acknowledged', 'assigned', 'in_progress')
      and i.created_at between new.created_at - interval '30 minutes' and new.created_at + interval '30 minutes'
      and public.locations_nearby(new.location_id, i.location_id, public.is_spreading_category(new.category))
    for update
  loop
    select * into v_reading
    from public.assess_incident_priority(v_other.school_id, v_other.category, v_other.location_id, v_other.description, v_other.created_by, v_other.created_at, v_other.id);
    if (v_reading.severity, v_reading.urgency, v_reading.affected) is distinct from (v_other.priority_severity, v_other.priority_urgency, v_other.priority_affected) then
      update public.incidents
         set priority_severity = greatest(v_reading.severity, coalesce(v_other.priority_severity, 1)),
             priority_urgency = greatest(v_reading.urgency, coalesce(v_other.priority_urgency, 1)),
             priority_affected = greatest(v_reading.affected, coalesce(v_other.priority_affected, 1)),
             priority_basis = v_reading.basis
       where id = v_other.id;
    end if;
  end loop;
  return null;
end;
$function$;

drop trigger if exists incidents_reassess_nearby on public.incidents;
create trigger incidents_reassess_nearby
  after insert on public.incidents
  for each row execute function public.reassess_nearby_incidents();
