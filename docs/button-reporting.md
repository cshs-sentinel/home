# Button-based reporting

How Community Members (and Classroom Advisers, who are Community Members) report, ask for help,
and share how they feel, and how responders see it. Added by migrations `0018` and `0019`.

**The flow is: tap a category → confirm the place → submit.** No form and no written description.

## The four tabs

| Tab | What it does |
| --- | --- |
| **Tell Us How You Feel** | Six feeling buttons. A tap saves it with the time. A comment above the buttons is optional. |
| **Report an Incident** | Ten category buttons. |
| **Get Help** | Six help buttons, plus a small "I'm safe" check-in. |
| **Things You Need to Know Now** | Weather advisories, school alerts and announcements (the existing alerts view), safety reminders, and emergency procedures. |

**My Reports** sits behind **More**, with **People** for a Classroom Adviser. Each tab still follows
the person's position features (a position without `report.help` has no Get Help tab).
School Admins and System Admins keep their own layout, including the Report tab they already had.

### Feelings

Good, Okay, Not Good, Upset, Unsafe, Need Support. The person is not asked a stress question: the
database derives it (1, 2, 3, 4, 5, 5) so the stress analytics and the Sentiment heatmap keep
working. The feeling is saved with the default location when it is still available.
**Unsafe** offers *Get Safety Assistance* and *Report an incident*; **Need Support** offers
*Ask for counseling / support*. Both open the matching dialog directly. Both also appear in the
Queue as wellbeing follow-ups.

### Incident categories

Bullying, Suspicious Person, Fire / Smoke, Electrical Hazard, Structural Damage, Injury / Accident,
Threat / Violence, Water / Chemical Spill, Unsafe Facility, Other Concern. **Severe Weather is not
a category**: weather advisories are under *Things You Need to Know Now*.

### Help categories

Emergency Help, Medical Assistance, Safety Assistance, Counseling / Support, Accessibility
Assistance, Other Help. Someone Missing and Disaster Assistance are not offered.

## Confirmation and location

Tapping an incident or help category opens a dialog (a native `<dialog>`: focus is trapped, Escape
closes it).

1. It names the category.
2. The person's **default location** is selected automatically.
3. One dropdown lists every active place a System Admin configured (full path, for example
   *Admin › 1st Floor*), so they can choose where it is actually happening. The default is never
   assumed to be the incident location.
4. **Confirm Report** (or **Confirm Help Request**) sends. **Cancel**, Escape, or a tap outside
   closes it and creates nothing.
5. An optional detail field is offered for incidents only (help requests have nowhere to store one).

If the default location is missing or no longer active, nothing is preselected and Confirm stays
disabled until a valid place is chosen. The database enforces the same rules: a button incident or
help request without a place is refused, and so is a place that is inactive or belongs to another
school.

## What happens to a report

### Incidents: Pending Evaluation

| Step | Result |
| --- | --- |
| Saved | `incidents` row, status **`pending_evaluation`**, case reference, reporter, place, time. Counted on the map and in analytics at once. |
| Notified | A row in `incident_notifications` ("Report to evaluate SNT-…"), the Queue badge, and the "not acknowledged after 15 minutes" insight. |
| **Validate** (School Admin) | → `acknowledged`. The normal workflow continues: Take it → Start → Resolve → Close. |
| **Dismiss** (School Admin) | → `cancelled` with the reason "Dismissed after evaluation". It is **not deleted**: the row, its history, and the audit log stay, and it disappears from the map and the active queue. |
| Reporter | Can cancel their own report while it is pending or new. |

A School Admin's own report skips evaluation and starts as `new`. The status is decided by the
database (`validate_incident`), never by the browser.

### Default Priority Index: P = S + U + A

Severity, Urgency, and Affected population are each 1 to 4. The database fills them in from the
category on every insert (`default_incident_priority`), so P exists from the first second, the
reporter cannot choose or change it, and `priority_set_by` stays empty until a responder confirms
or changes it with **Change priority**. The Queue marks an unconfirmed score as "default".
Classes: 3–5 low, 6–8 moderate, 9–11 high, 12 critical.

The defaults are deliberately a little high: when the true extent is unknown the score errs towards
the higher class, and a responder corrects it while evaluating.

| Category | S | U | A | P | Class | Why |
| --- | --- | --- | --- | --- | --- | --- |
| Fire / Smoke | 4 | 4 | 4 | 12 | Critical | Spreads fast and can reach the whole building |
| Threat / Violence | 4 | 4 | 3 | 11 | High | Life-threatening and immediate, likely a class or more |
| Suspicious Person | 3 | 4 | 3 | 10 | High | Possible threat that needs eyes on it now |
| Injury / Accident | 3 | 4 | 2 | 9 | High | Serious until checked, needs a response now, may involve a few |
| Structural Damage | 3 | 3 | 3 | 9 | High | Collapse risk for whoever uses the space |
| Electrical Hazard | 3 | 3 | 2 | 8 | Moderate | Shock or fire risk, within the hour |
| Water / Chemical Spill | 2 | 3 | 2 | 7 | Moderate | Slip or exposure risk, within the hour |
| Bullying | 3 | 2 | 1 | 6 | Moderate | Serious for wellbeing, handled the same day |
| Unsafe Facility | 2 | 2 | 2 | 6 | Moderate | Needs fixing today for the people who use it |
| Other Concern | 2 | 2 | 1 | 5 | Low | Unknown until evaluated |
| Emergency / Medical / Security / Other (older) | 4,4,2 / 3,4,1 / 3,3,2 / 2,2,1 | | | 10 / 8 / 8 / 5 | | Older categories keep sensible defaults |

These numbers are a proposal. They live in one SQL function (`default_incident_priority`), mirrored
in `src/lib/priority.ts`, and can be changed by a new migration. The scales are in
`src/lib/priority.ts` (Severity: minor to life-threatening; Urgency: can wait to immediate;
Affected: one person to 50+).

### Help requests: triage

Help requests are `check_ins` with status `need_help`, a `help_type`, and a **triage status**:

| Help type | First triage status |
| --- | --- |
| Emergency Help, Medical Assistance, Safety Assistance | **Urgent** |
| Counseling / Support, Accessibility Assistance, Other Help | **Waiting for triage** |

The database picks it (`validate_check_in`); whatever the browser sends is ignored. A School Admin
moves it to **responding**, then **resolved** (`triage_help_request`, audited). Urgent requests
sort first in the Queue and add to the Queue badge. The older untyped "I need help" button (in a
School Admin's Report tab) is treated as Emergency Help. Duplicate protection: one help request
per person per two minutes; one open incident per person per five minutes.

## Seen on the map at once

Reports are on the **Map** (All reports, Incidents, Help requests, Sentiment) as soon as they are
saved. Incidents, help requests, and submissions are published to Supabase Realtime, and the
School Admin's workspace refreshes in place when one changes (merged into one refresh, no flicker).
Row-level security applies to realtime, so people only receive rows they could already read.

## Database changes

All additive; no table was created or dropped and no row was deleted. See
`supabase/migrations/202610230018_button_reporting.sql` and `…0019_pending_list_active_only.sql`.

- `incidents`: ten new categories (older four kept); new status `pending_evaluation`.
- `check_ins`: `help_type`, `triage_status`, `triage_by`, `triage_at`.
- `submissions`: six new feeling values; stress derived when not supplied.
- Functions replaced: `validate_incident`, `validate_check_in`, `validate_submission`,
  `notify_new_incident`, `transition_incident`, `dashboard_counts`. New: `default_incident_priority`,
  `triage_help_request`. Realtime publication gains the three tables.
- `pending_in_my_location()` (Classroom Adviser) now lists active accounts only.

## Not changed, and notes

- "Suggest or observe" and "Report a hazard" are no longer offered to Community Members: the new
  incident categories cover them (Bullying, Suspicious Person, Unsafe Facility, Other Concern).
  The tables, older reports, and the School Admin's own Report tab are untouched.
- There is no Notifications tab for Community Members today (incident notifications are for staff),
  so none was added. My Reports shows status changes and refreshes live.
- "Delete" is implemented as **Dismiss**: removing a report for good would erase the audit trail.
- "Authorized" locations means active places in the person's own school, as the database enforces.
  A place with a restricted access level is still selectable for a report.
- The emergency procedures are general guidance, not this school's own procedures.
