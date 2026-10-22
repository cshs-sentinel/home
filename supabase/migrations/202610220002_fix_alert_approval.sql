-- Fix: a School Admin could not approve, publish, or cancel an alert drafted by
-- someone else. validate_alert applied its "only the author can edit this
-- draft" rule to workflow updates too, so approve_alert/publish_alert/
-- cancel_alert failed for any alert the admin had not written themselves.
-- The author rule now applies only to direct content edits, matching how the
-- function already treats status changes and frozen content.
--
-- Rollback: re-create the function without the app.alert_workflow guard on the
-- author check (previous definition: `if old.created_by is distinct from
-- auth.uid() then raise ...`).

create or replace function public.validate_alert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := coalesce(new.created_by, auth.uid());
      if new.created_by is distinct from auth.uid() then
        raise exception 'an alert must be created by yourself';
      end if;
    end if;
    if new.status <> 'draft' then
      raise exception 'new alerts must start as a draft';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.status is distinct from old.status
     and coalesce(current_setting('app.alert_workflow', true), '') <> 'yes' then
    raise exception 'alert status can only change through the alert workflow';
  end if;
  if new.school_id is distinct from old.school_id
     or new.created_by is distinct from old.created_by
     or new.supersedes_id is distinct from old.supersedes_id
     or new.version is distinct from old.version then
    raise exception 'alert ownership fields cannot be changed';
  end if;

  -- Content of a published/approved/cancelled alert is frozen; only a draft can
  -- be edited, and only by its author. Workflow functions (approve, publish,
  -- cancel, correct) are exempt: they check their own permissions.
  if coalesce(current_setting('app.alert_workflow', true), '') <> 'yes' then
    if old.status <> 'draft' then
      raise exception 'only a draft alert can be edited';
    end if;
    if old.created_by is distinct from auth.uid() then
      raise exception 'only the author can edit this draft';
    end if;
  end if;

  return new;
end;
$function$;
