# SENTINEL roles and permissions

This reflects the `app_role` enum and row-level security policies actually enforced by the
connected Supabase project (`cshs-sentinel's Project`). Every account has exactly one role,
stored on `public.profiles.role`.

## Student

The default role for every new sign-up. Can submit survey/check-in responses, file an incident
or hazard report, and track their own submissions. Sees published alerts targeted at `all` or at
the `student` role.

## Teacher

Everything a Student can do, plus read/update access to non-confidential (non-`sentiment`)
submissions school-wide, so classroom-level concerns can be triaged without seeing counseling
content.

## Non-Teaching Staff

Support staff. Currently has the same access as Student — reporting and surveys — with no
additional reviewer or staff-triage permissions.

## Security

An incident "reviewer": sees every incident and check-in school-wide (not just their own),
acknowledges and assigns cases, adds internal notes, and receives responder-scoped alerts. Also
has the Teacher-level non-confidential submissions access.

## DRRM Coordinator

The same reviewer and staff-submissions access as Security, plus the ability to draft alerts
(which require School Admin approval before publishing).

## Guidance Counselor

The only role with access to confidential (`kind = 'sentiment'`) submissions — wellbeing
check-ins and disclosures. This access is deliberately siloed: Guidance is **not** an incident
reviewer and does not see the incidents table beyond their own reports, keeping counseling
content separate from general safety/security case management.

## School Admin

Full operational authority: reviewer on incidents/check-ins, staff-level submissions access,
approves and publishes alerts, manages locations/categories/schedules, and reads the school's
audit log.

## System Admin

The school's setup administrator. This role configures the campus tree (campus, buildings,
floors, rooms, CRs, and other areas), the location types, and the user types, and assigns user
types to people. It can grant System Admin. It intentionally does not have Guidance's
confidential-content access or School Admin's incident and alert rights.

## User types

These 8 roles are the **base roles**. A System Admin can create any number of user types on top
of them, such as "Canteen Staff" on Non-Teaching Staff or "School Nurse" on Guidance Counselor, and
choose which menus and report buttons each type gets. A user type can never get more than its
base role allows. See [system-design.md](system-design.md#6-school-setup).

## Notes for contributors

- People are assigned a user type in the app's People tab, which calls `admin_set_user_type()`.
  That also sets their base role. School and System Admins can do this in their own school,
  cannot change their own type, and only a System Admin can assign or change a System Admin.
  Every change is written to `audit_logs`. There is no separate `user_roles` table in the live
  schema, unlike an earlier draft of this repo's migration.
- See [system-design.md](system-design.md) for the features and insights each role gets.
- `scripts/seed-sample-accounts.mjs` creates one demo login per role (see the project README) so
  every role above can be signed into and previewed without touching real accounts.
