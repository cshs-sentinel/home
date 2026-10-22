# SENTINEL

A school safety and wellbeing app. Students and staff report how they feel, hazards, incidents,
and help requests in a few taps on their phone. SENTINEL combines those reports with live weather,
heat index, and earthquake data, and gives admins and coordinators a campus heatmap, analytics,
and suggested actions such as drafting an alert. Each role sees only what it needs, and individual
feelings go only to School Admins.

Live preview: https://sentinel-school-safety-preview.sentinelcshs.workers.dev

See [docs/system-design.md](docs/system-design.md) for the full design, roles, and known gaps.

## Repository setup

The project uses the `main` branch. Copy `.env.example` to `.env` once application configuration is added; never commit real credentials.

## Running locally

```bash
npm install
npm run dev
```

The app signs in against the live Supabase project via `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` in `.env` (see `.env.example`). `SUPABASE_SERVICE_ROLE_KEY` is also
required, but only for the local seed script below — it is never bundled into the frontend.

## Roles, positions, and demo accounts

SENTINEL has three fixed roles: **Community Member**, **School Admin** (coordinators and
responders), and **System Admin**. A System Admin creates positions such as Teacher, Security, or
ICT Coordinator and maps each one to a role. See
[docs/roles-and-permissions.md](docs/roles-and-permissions.md).

- Public sign-up creates Community Members only, asking for Name, Member type, Specific Location,
  ID No., and Gender. Every active Community Member position is open by default; a System Admin
  can close any of them in Setup › Positions. A self-registered account is `pending` until a
  School Admin, System Admin, or Classroom Adviser (for their own location) approves it.
- Admins (School Admin and System Admin) are created only by a System Admin, from People › Add
  person — never by a School Admin and never through sign-up.

There is one demo account for each role. From the login card on the homepage, open "Try a demo
account for each role" to sign in with one click, or sign in manually with the password
`Sentinel!Demo1`:

| Role | Email | Position |
| --- | --- | --- |
| Community Member | demo.student@sentinel.test | Student |
| School Admin | demo.schooladmin@sentinel.test | School Admin |
| System Admin | demo.systemadmin@sentinel.test | System Admin |

Earlier demo logins (teacher, non-teaching, security, DRRM, guidance) were retired on 2026-10-23.
They are blocked from signing in and hidden from People, but not deleted, because they own
activity-log rows.

These are synthetic, non-production accounts for demoing the app, not real identities. To
(re)create them, run:

```bash
node scripts/seed-sample-accounts.mjs
```

The script is idempotent. It reads `src/demo-accounts.json`, marks accounts as admin-provisioned,
re-syncs each account's position and role, and retires the emails listed under `retired`. It requires `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

## Tests

```bash
npm test            # unit tests: roles, features, locations
npm run test:db     # database acceptance tests; run in one transaction that always rolls back
```

`test:db` needs `SUPABASE_URL` and `SUPABASE_ACCESS_TOKEN` in `.env`. Results are in
[docs/acceptance-test-results.md](docs/acceptance-test-results.md).

## Demo activity for the analytics

The demo campus and its synthetic activity were removed on 2026-10-22; the school now holds only
real setup (Cabiao SHS). The script below can add 14 days of synthetic feelings, reports,
incidents, and check-ins, tagged `[demo]`, onto whatever places exist. Only use it on a test
school, because it mixes synthetic rows into real analytics.

```bash
node scripts/seed-demo-activity.mjs
```

```bash
node scripts/seed-demo-activity.mjs --clean
```

## Weather and heat index

Weather comes from Open-Meteo and earthquakes from USGS, using the school's coordinates. Set
`VITE_SCHOOL_LAT`, `VITE_SCHOOL_LON`, and `VITE_SCHOOL_PLACE` in `.env`. Without them the app
uses Manila and says so on screen.

See [docs/system-design.md](docs/system-design.md) for the features, insight rules, and known gaps.
