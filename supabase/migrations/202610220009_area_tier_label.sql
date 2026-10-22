-- Level 3 is shown as "Area" (its types are still Floor, Wing, and Annex).
-- Only the wording in validation messages changes; the rules do not.
create or replace function public.level_name(p_level smallint)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_level
    when 1 then 'campus'
    when 2 then 'building'
    when 3 then 'area'
    when 4 then 'room'
    else 'other location'
  end;
$function$;
