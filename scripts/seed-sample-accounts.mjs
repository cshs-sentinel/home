// One-off/idempotent seed script: creates (or re-syncs) one demo login per
// app_role so every role in docs/roles-and-permissions.md can be signed in
// and previewed. Requires SUPABASE_SERVICE_ROLE_KEY — run locally only,
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

const { password, schoolId, accounts } = JSON.parse(
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

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      role: account.role,
      display_name: account.displayName,
      school_id: schoolId,
      is_active: true,
    })
    .eq('id', user.id);

  if (profileError) throw profileError;

  results.push({ role: account.role, email: account.email, status: created ? 'created' : 'already existed' });
}

console.table(results);
console.log(`\nAll demo accounts share the password: ${password}`);
