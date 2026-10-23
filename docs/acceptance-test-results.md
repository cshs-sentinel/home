# Acceptance test results: roles, registration, and default location

First run on 2026-10-23 for the three-role work. The button-based reporting results are in their own
section near the end. Everything here ran against the live Supabase project and the local frontend
build; the lists of what was not done are at the end.

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

## Button-based reporting (migrations 0018 and 0019)

Run on 2026-10-23 and 2026-10-24 against the live project.

| Command | What it covers | Result |
| --- | --- | --- |
| `npm run build` | TypeScript check and production bundle | Passed |
| `npm test` | 20 unit tests: the four community tabs, positions and features, button lists, default priority scores and classes, help routing, labels | 20 of 20 passed |
| `npm run test:db` | 117 checks in three rolled-back scripts (three roles, button reporting, Classroom Adviser) | 117 of 117 passed |

How the migration was checked: it was first run **inside the rolled-back test transaction**
(`TEST_PREAPPLY=202610230018_button_reporting.sql`) with nothing changed live, then applied, then the
suites were run again. The Classroom Adviser regression test was run **before** its fix and failed on
exactly the bug (a switched-off pending account was listed), then passed after the fix.

The older three-role suite had stopped working after the earlier registration and approval changes
(ID No. and Gender became required, new accounts start pending, admins are no longer created by School
Admins). Its fixtures and four checks were updated to the current rules and it passes again (65 of 65).
The shared helpers moved to `tests/sql/_helpers.sql` and `_footer.sql`.

Covered by the database checks (B01 to B40 and C01 to C07): all ten incident categories save as Pending
Evaluation with their default S/U/A and class; the reporter cannot choose the status or priority;
unknown categories, missing places, inactive places, and another school's places are refused; the
actual place is stored, not the default; duplicate incidents (5 minutes) and help requests (2
minutes) are refused; an account waiting for approval cannot report; all six help buttons save and
are routed (urgent versus waiting for triage) whatever the browser sends; typed help needs a place;
the six feelings save with a derived stress level; a Community Member sees only their own rows and
cannot validate, triage, or re-prioritize; a School Admin sees everything at once, is notified,
validates, dismisses (kept, with a reason), re-rates, and triages; dismissed reports cannot be
validated; realtime publication; the Classroom Adviser's approvals stop at their own location and
give none of the School Admin powers.

Browser checks (Community Member, Classroom Adviser, School Admin, System Admin; desktop and 375 px):

- Community Member and Classroom Adviser: four tabs, My Reports and (for the adviser) People behind More.
- Incident category tap opens the dialog showing the category and the default location; the dropdown
  lists the four configured places; **Cancel** closed it and the database still had 0 incidents.
- Fire / Smoke at a **different** place (Admin): saved as pending_evaluation, location Admin, 4+4+4 =
  12 critical, system default, one notification; the success card shows the case reference.
- A second report straight away showed the friendly duplicate message and kept the dialog open.
- Medical Assistance: dialog without a detail field; saved urgent; listed under My Reports.
- Need Support saved with the optional comment and led to the Counseling / Support dialog.
- With the default location made unavailable (simulated by rewriting the profile response, nothing
  in the database changed): nothing preselected, Confirm disabled until a place was chosen.
- Escape closes the dialog; category buttons are real buttons; 375 px: two columns, no horizontal
  scroll, dialog fits the screen.
- School Admin: the report showed in the Queue as Critical · 12 · default with Validate, Change
  priority, and Dismiss; urgent help sorted first; a feeling filed from a separate client appeared
  with **no refresh** (realtime); Dismiss cancelled it with a reason; Respond then Resolve moved the
  help request; the map's All reports layer included incidents and help requests.
- Regression: the School Admin's own tabs and legacy Report buttons, and the System Admin's tabs,
  were unchanged.

Test data created in the live school while testing: one fire report (dismissed), one medical help
request (resolved), a "Need Support" and an "Unsafe" feeling from the demo Community Member, and a
throwaway Classroom Adviser account that was switched off and banned afterwards. The audit log keeps
them. No existing data was changed or removed.

### Not done, and things to know

- **Not deployed.** The migrations are applied to the live database, but the Cloudflare site still
  runs the earlier frontend. Until it is deployed, the live School Admin Queue does not show
  Pending Evaluation incidents, and Community Members still see the older Report tab.
- **Not browser-tested:** a real sign-up through email confirmation, the Validate button in the Queue
  (database check B30 covers the transition; the Dismiss, Respond, and Resolve buttons were clicked),
  and a screen reader.
- **Realtime was checked for the Queue**, not separately for the heatmap shading, which reads the
  same refreshed data.
- The default S/U/A scores are a proposal; they live in one SQL function and are easy to change.
- "I'm safe" check-ins stay available but moved under Get Help; "Suggest or observe" and "Report a
  hazard" are no longer shown to Community Members (see docs/button-reporting.md).

## Earlier work: not done, and things to know (three-role batch)


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
