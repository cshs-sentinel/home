// One-off/idempotent seed script: creates (or re-syncs) one demo login for each
// of the three primary roles (Community Member, School Admin, System Admin) with a
// designation each. Accounts listed under "retired" in demo-accounts.json are
// deactivated and blocked from signing in rather than deleted, because they own
// audit-log rows, so every role in docs/roles-and-permissions.md can be
// signed in and previewed. Accounts are marked app_metadata.provisioned =
// 'admin', which the sign-up trigger requires for accounts that are created
// without registration details (only the service key can set it). Requires SUPABASE_SERVICE_ROLE_KEY — run locally only,
// never in the browser/frontend bundle.
//
// Usage: node scripts/seed-sample-accounts.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

const env = loadEnv(join(projectRoot, '.env'));
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const { password, schoolId, accounts, retired = [] } = JSON.parse(
  readFileSync(join(projectRoot, 'src', 'demo-accounts.json'), 'utf8'),
);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { provisioned: 'admin' },
  });
  if (!error) return { user: data.user, created: true };

  if (error.message?.toLowerCase().includes('already been registered') || error.code === 'email_exists') {
    const existing = await findUserByEmail(email);
    if (existing) return { user: existing, created: false };
  }
  throw error;
}

const results = [];

for (const account of accounts) {
  const { user, created } = await ensureUser(account.email);

  const { data: designation } = await admin.from('user_types').select('id, base_role').eq('school_id', schoolId).eq('name', account.designation).maybeSingle();
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      role: designation?.base_role ?? account.role,
      user_type_id: designation?.id ?? null,
      display_name: account.displayName,
      school_id: schoolId,
      is_active: true,
    })
    .eq('id', user.id);

  if (profileError) throw profileError;

  results.push({ role: designation?.base_role ?? account.role, designation: account.designation, email: account.email, status: created ? 'created' : 'already existed' });
}

for (const email of retired) {
  const existing = await findUserByEmail(email);
  if (!existing) continue;
  const { error: banError } = await admin.auth.admin.updateUserById(existing.id, { ban_duration: '876000h' });
  if (banError) throw banError;
  const { error: offError } = await admin.from('profiles').update({ is_active: false }).eq('id', existing.id);
  if (offError) throw offError;
  results.push({ role: '-', designation: '-', email, status: 'retired (blocked, history kept)' });
}

console.table(results);
console.log(`\nAll demo accounts share the password: ${password}`);
