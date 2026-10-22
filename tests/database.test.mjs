// Runs tests/sql/three_roles.sql against the live Supabase project through the
// Management API. The script rolls everything back, so nothing is kept.
// Needs SUPABASE_URL and SUPABASE_ACCESS_TOKEN in .env. Run: npm run test:db
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

test('three-role database rules (rolled back)', { skip: ready ? false : 'SUPABASE_URL / SUPABASE_ACCESS_TOKEN not set' }, async (t) => {
  const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: readFileSync(join(root, 'tests', 'sql', 'three_roles.sql'), 'utf8') }),
  });
  let message = await res.text();
  try {
    message = JSON.parse(message).message ?? message;
  } catch {
    // not JSON: use the raw text
  }
  const start = message.indexOf('ZZRESULT[');
  assert.ok(start >= 0, `the test script did not return results: ${message.slice(0, 400)}`);
  const rows = JSON.parse(message.slice(start + 'ZZRESULT'.length, message.lastIndexOf(']') + 1));
  assert.ok(rows.length >= 60, `expected at least 60 checks, got ${rows.length}`);
  for (const row of rows) {
    await t.test(row.name, () => assert.equal(row.ok, true, row.detail || 'check failed'));
  }
});
