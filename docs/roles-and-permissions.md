# SENTINEL roles and permissions

This reflects the row-level security policies and functions actually enforced by the connected
Supabase project (`cshs-sentinel's Project`), as changed by migrations `0010` and `0011`.

## Two layers

1. **Three fixed primary roles.** Every account has exactly one, stored on `public.profiles.role`.
   The database decides what a person can read or change from this role alone.
2. **Designations (positions).** A System Admin creates positions such as "Teacher", "Security",
   "DRRM Coordinator", or "ICT Coordinator" and maps each one to exactly one primary role. A
   person holds one position, and gets the role it is mapped to. The label never grants access.
   Positions also choose which menus and buttons the person sees (their *features*), but never
   more than the role allows.

No position is created by default beyond the built-in ones the school already had. Which role a
position maps to is the System Admin's decision, and it can be changed at any time.

## The three roles

### Community Member

The role for students, teachers, non-teaching staff, and anyone else who reports. Can send help
requests, safe check-ins, feelings, hazards, incidents, and suggestions, and see published
alerts. Reads only their own incidents, check-ins, and reports, and their own profile. Cannot
see other people, the Queue, analytics, or setup. This is the **only** role open to public
sign-up.

### School Admin (coordinators and responders)

Security, DRRM coordinators, guidance counselors, and school administrators. Sees the whole
school's reports, individual feelings, incidents, check-ins, and people. Acknowledges and moves
incidents through the workflow and rates their priority. Drafts, approves, publishes, and
withdraws alerts. Assigns positions to people in their own school, but cannot change their own
position and cannot assign or change a System Admin. Reads the activity log. Which of these
menus each person sees depends on their position's features.

### System Admin

The school's setup administrator. Configures the campus and its places, location types, and
positions (including which role each maps to and which are open for sign-up). Assigns positions,
including System Admin ones. Does not see reports, incidents, or wellbeing data.

An ICT Coordinator position can be mapped to System Admin only when the System Admin explicitly
authorizes it (`authorized_privileged`). The last active System Admin cannot be moved away.

## Registration

- Public sign-up shows only positions that are **active**, **mapped to Community Member**, and
  **marked open for sign-up**. School Admin and System Admin positions cannot be opened for
  sign-up (a database check enforces this).
- The person must also pick a **default campus location**. It must be an active, non-restricted
  place in the same school as the position.
- The role is decided by the database trigger `handle_new_user()` from the position. A role (or
  any other field) sent by the browser is ignored. Sign-ups without registration details are
  refused unless an administrator created the account through the service key
  (`app_metadata.provisioned = 'admin'`).
- Admins are created by other admins: an existing School or System Admin assigns an admin
  position in the People tab, or the System Admin creates the account.
- Public sign-up starts **closed**. A System Admin opens it per position in Setup › Positions
  (“Open for public sign-up”).

## Default location

Stored on `profiles.primary_location_id`. It only **pre-fills** the place step of reports and
check-ins. Each report keeps its own `location_id`, so the place where something actually
happened is stored separately and is never overwritten by the default.

- Changed from the Report tab (“My default location”), through `set_my_default_location()`.
- Only active, non-restricted places in the person's school are accepted.
- If the saved place later becomes inactive, it stays on file but the app asks for a replacement
  and the database refuses new reports at an inactive place.

## Enforcement

| Rule | Where |
| --- | --- |
| Only three role values can be stored | `profiles_primary_roles_check`, `user_types_primary_roles_check` |
| A position's features cannot exceed its role | `validate_user_type()` using `role_feature_ceiling()` |
| Remapping a position moves everyone who holds it, and logs each move | `sync_designation_role()` |
| Nobody changes their own role or position | `profiles` is read-only for signed-in users; `admin_set_user_type()` refuses self-changes |
| Only System Admins assign System Admin positions | `admin_set_user_type()` |
| School isolation | Every policy and function is scoped by `my_school_id()` |
| Sign-up is validated by the database | `handle_new_user()` |

## Limits to know about

- Fine-grained abilities (for example “Security can see Queue but not People”) are **menus and
  buttons only**. The database enforces the three roles; it does not enforce the per-position
  feature list. Anyone with the School Admin role can read everything a School Admin can read,
  whatever their position hides.
- Earlier role labels (`student`, `teacher`, `security`, `drrm`, `guidance`, `non_teaching`)
  still exist inside the Postgres enum because Postgres cannot drop enum values, but a CHECK
  constraint stops them from being stored.
- Existing accounts were moved onto the three roles, keeping their position name: Student,
  Teacher, and Non-Teaching Staff became Community Member; Security, DRRM Coordinator, Guidance
  Counselor, and School Admin became School Admin; System Admin stayed. Each move is in
  `audit_logs` with `via: designation_remapped`.

## Notes for contributors

- `scripts/seed-sample-accounts.mjs` creates or re-syncs the demo logins (listed in the README)
  with `app_metadata.provisioned = 'admin'` and a position each.
- Run `npm test` for the unit tests and `npm run test:db` for the database acceptance tests. The
  database tests run in one transaction that always rolls back. See
  [acceptance-test-results.md](acceptance-test-results.md).
- See [system-design.md](system-design.md) for menus, insights, and the rest of the design.
