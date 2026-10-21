# SENTINEL

An instant survey system: respondents submit answers and the server analyzes results in real time.

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

## Roles and demo accounts

See [docs/roles-and-permissions.md](docs/roles-and-permissions.md) for what each of the 8 roles
can do. One demo account per role already exists in the connected project; from the login card
on the homepage, open "Try a demo account for every role" to sign in as any of them with one
click, or sign in manually with:

| Role | Email | Password |
| --- | --- | --- |
| Student | demo.student@sentinel.test | `Sentinel!Demo1` |
| Teacher | demo.teacher@sentinel.test | `Sentinel!Demo1` |
| Non-Teaching Staff | demo.nonteaching@sentinel.test | `Sentinel!Demo1` |
| Security | demo.security@sentinel.test | `Sentinel!Demo1` |
| DRRM Coordinator | demo.drrm@sentinel.test | `Sentinel!Demo1` |
| Guidance Counselor | demo.guidance@sentinel.test | `Sentinel!Demo1` |
| School Admin | demo.schooladmin@sentinel.test | `Sentinel!Demo1` |
| System Admin | demo.systemadmin@sentinel.test | `Sentinel!Demo1` |

These are synthetic, non-production accounts for demoing the app — not real identities. To
(re)create them, run:

```bash
node scripts/seed-sample-accounts.mjs
```

The script is idempotent: re-running it re-syncs each demo account's role instead of duplicating
users. It reads `demo-accounts.json` (in `src/`) and requires `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
