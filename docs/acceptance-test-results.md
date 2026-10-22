# Acceptance test results: roles, registration, and default location

Run on 2026-10-23 against the live Supabase project (migrations `0010` and `0011` applied) and
the local frontend build. Nothing here was deployed to Cloudflare. The deployed app is still the
earlier version, which does not match the migrated database (see "Not done").

## Automated results

| Command | What it covers | Result |
| --- | --- | --- |
| `npm run build` | TypeScript check and production bundle | Passed |
| `npm test` | 9 unit tests: three roles, feature ceilings, navigation, location paths | 9 of 9 passed |
| `npm run test:db` | 65 database checks in one transaction that always rolls back, run through the Supabase Management API | 65 of 65 passed |

After the database run, no test rows remained: 0 test users, schools, positions, places,
incidents, or helper schemas. The Student position was still closed for sign-up.

The database checks use the real demo accounts for School Admin, System Admin, and Community
Member, and throwaway accounts, a second school, and four throwaway rooms that are rolled back.

## Acceptance checklist

| Requirement | Evidence | Result |
| --- | --- | --- |
| Exactly three fixed primary roles | T01, T02, T03 (only three values stored; an old label such as `teacher` is rejected); unit test | Pass |
| System Admin configures positions and maps each to one role | T54 (Community), T55 (School Admin), T57 (System Admin, needs authorization), T61a/T61b (remapping moves holders and logs it); Setup › Positions in the browser | Pass |
| Features can never exceed the role | T04; unit test | Pass |
| Registration assigns the role automatically | T05, T15; real sign-up endpoint probe below | Pass |
| A submitted role is ignored | T06 | Pass |
| Privileged positions are not selectable at sign-up | T07, T08, T13, T56, T62; T18 (public list) | Pass |
| No self-elevation | T21 to T25 (Community cannot write `profiles`, assign positions, or create positions); T50, T60 (nobody changes their own position); T49, T51 (School Admin cannot assign or change a System Admin) | Pass |
| Admins are created only by other admins | T52 (School Admin gives an admin position), T59 (System Admin gives System Admin); T07, T08 | Pass |
| Default location is mandatory at registration | T09 | Pass |
| Default location saved and prefilled | T05, T28; browser: saved "Admin › 1st Floor" as the demo student, then "I'm safe" opened with that place preselected | Pass |
| Default location can be changed | T28, T33; browser: Change flow | Pass |
| Inactive or restricted saved location is blocked and replacement requested | T10, T11, T29, T30, T32, T33; browser: the "not saved yet / no longer available" notice and the Choose button | Pass (browser tested the "not saved yet" notice; the "no longer available" notice follows the same code path and was checked by database tests T32/T33) |
| Actual incident location stored separately | T34, T35, T36 (check-in, incident, and report keep the chosen place; the default is unchanged) | Pass |
| Reports at an inactive place or another school's place are refused | T37, T38, T39 | Pass |
| Backend authorization and school isolation | T12, T31, T39, T40, T43, T53, T58 | Pass |
| Community Member sees only their own data | T26, T40, T41 | Pass |
| School Admin reads feelings, handles incidents, drafts alerts | T42, T44 to T47 | Pass |
| Existing login, reporting, dashboards, and location settings still work | Browser, logged in as Community Member, School Admin, and System Admin: login, Report buttons, Map (all six heatmaps, including Sentiment), Analytics, Queue, People, Setup › Positions; no page errors | Pass |

## Real sign-up endpoint probe

Sent to `/auth/v1/signup` with the public key. All were refused by the database trigger, and no
account was created (checked afterwards).

| Request | Response |
| --- | --- |
| No registration details | `Registration needs a designation and a default location` |
| School Admin position with a valid place | `That designation is not open for registration` |
| Same, plus `role: system_admin` in the data | `That designation is not open for registration` |

`registration_options()` as an anonymous visitor returned no open positions (sign-up is closed
until a System Admin opens one) and only active, non-restricted places.

## Browser checks

- Sign-up form: with sign-up closed it shows "Sign-up is closed right now". With the options
  mocked in the browser (the live setting is closed), the form shows name, email, password,
  position, and the cascading default-location dropdowns, and fits a 390 px phone with no
  horizontal scroll. Submitting was not tested end to end in the browser for the same reason.
- Setup › Positions: the Role list offers Community Member, School Admin, and System Admin. Choosing
  System Admin hides "Open for public sign-up" and keeps Save disabled until the authorization
  box is ticked.
- Phone width (390 px): Community Member Report screen, with no horizontal overflow.

## Not done, and things to know

- **Not deployed.** The live site at the workers.dev URL still runs the earlier frontend, which
  expects the old role names. Until you approve a deploy, accounts on the live site may show
  wrong menus or errors. This was not deployed because you asked for explicit approval first.
- **Sign-up is closed.** No position is open for public sign-up. A System Admin opens Student,
  Teacher, or others in Setup › Positions. A real sign-up through email confirmation was not
  run, because the Supabase auth `site_url` has not been checked or changed (it needs your OK).
- **Features are menus and buttons only.** The database enforces the three roles, not each
  position's feature list (documented in `docs/roles-and-permissions.md`).
- **Demo data.** `demo.teacher` still holds the DRRM Coordinator position, so it is a School
  Admin. Assign it the Teacher position in People if you want a Community Member teacher. The demo
  student's default location was saved during testing (Admin › 1st Floor).
- **Old role names in Postgres.** Postgres cannot remove enum values, so the old labels still
  exist in the type but cannot be stored.
- **Existing accounts have no default location.** The app asks each one to choose one.
