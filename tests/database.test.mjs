// Runs the SQL acceptance scripts in tests/sql against the live Supabase project
// through the Management API. Each script is sent as _helpers.sql + the script +
// _footer.sql in one request, i.e. one transaction that always rolls back, so
// nothing is kept. Needs SUPABASE_URL and SUPABASE_ACCESS_TOKEN in .env.
// Run: npm run test:db
//
// Set TEST_PREAPPLY=<migration file name> to run a migration inside the same
// rolled-back transaction first. That checks a migration that is not applied to
// the live project yet, without changing anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlDir = join(root, 'tests', 'sql');

function loadEnv() {
  const path = join(root, '.env');
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && /^[A-Z_]+$/.test(line.slice(0, i))) env[line.slice(0, i)] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const ready = Boolean(env.SUPABASE_URL && env.SUPABASE_ACCESS_TOKEN);
const read = (name) => readFileSync(join(sqlDir, name), 'utf8');

const SUITES = [
  { title: 'three-role database rules (rolled back)', file: 'three_roles.sql', minimum: 60 },
  { title: 'button-based reporting rules (rolled back)', file: 'button_reporting.sql', minimum: 30 },
  { title: 'Classroom Adviser approval rules (rolled back)', file: 'classroom_adviser.sql', minimum: 7 },
  { title: 'public sign-up email rules (rolled back)', file: 'signup_email.sql', minimum: 5 },
];

for (const suite of SUITES) {
  test(suite.title, { skip: ready ? false : 'SUPABASE_URL / SUPABASE_ACCESS_TOKEN not set' }, async (t) => {
    const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
    const preapply = process.env.TEST_PREAPPLY ? read(`../../supabase/migrations/${process.env.TEST_PREAPPLY}`) + '\n' : '';
    const query = preapply + read('_helpers.sql') + '\n' + read(suite.file) + '\n' + read('_footer.sql');
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    let message = await res.text();
    try {
      message = JSON.parse(message).message ?? message;
    } catch {
      // not JSON: use the raw text
    }
    const start = message.indexOf('ZZRESULT[');
    assert.ok(start >= 0, `the test script did not return results: ${message.slice(0, 600)}`);
    const rows = JSON.parse(message.slice(start + 'ZZRESULT'.length, message.lastIndexOf(']') + 1));
    assert.ok(rows.length >= suite.minimum, `expected at least ${suite.minimum} checks, got ${rows.length}`);
    for (const row of rows) {
      await t.test(row.name, () => assert.equal(row.ok, true, row.detail || 'check failed'));
    }
  });
}
