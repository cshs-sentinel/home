// Adds 14 days of synthetic activity (feelings, reports, incidents, check-ins)
// to the demo school so the analytics have something to show. Every row is
// tagged so it can be removed:
//   node scripts/seed-demo-activity.mjs          # add demo activity
//   node scripts/seed-demo-activity.mjs --clean  # remove all demo activity
// Requires SUPABASE_SERVICE_ROLE_KEY in .env. Run locally only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const TAG = '[demo]';
const CHECK_IN_TAG = 'demo-seed';
const DAYS = 14;

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(projectRoot, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const { schoolId } = JSON.parse(readFileSync(join(projectRoot, 'src', 'demo-accounts.json'), 'utf8'));
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

async function clean() {
  const subs = await must(admin.from('submissions').delete().eq('school_id', schoolId).like('message', `${TAG}%`).select('id'));
  const incidentIds = (await must(admin.from('incidents').select('id').eq('school_id', schoolId).like('description', `${TAG}%`))).map((r) => r.id);
  if (incidentIds.length) {
    await must(admin.from('incident_notes').delete().in('incident_id', incidentIds));
    await must(admin.from('incident_status_history').delete().in('incident_id', incidentIds));
    await must(admin.from('incident_notifications').delete().in('incident_id', incidentIds));
    await must(admin.from('incidents').delete().in('id', incidentIds));
  }
  const checks = await must(admin.from('check_ins').delete().eq('school_id', schoolId).eq('period', CHECK_IN_TAG).select('id'));
  console.log(`Removed ${subs.length} submissions, ${incidentIds.length} incidents, ${checks.length} check-ins.`);
}

// Small seeded PRNG so reruns produce the same shape of data.
let seed = 20261022;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = (items) => items[Math.floor(rand() * items.length)];
function weighted(entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) if ((r -= w) <= 0) return value;
  return entries[entries.length - 1][0];
}
function schoolTime(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(7 + Math.floor(rand() * 9), Math.floor(rand() * 60), 0, 0);
  if (d > new Date()) d.setTime(Date.now() - (5 + Math.floor(rand() * 120)) * 60_000);
  return d;
}

async function seedActivity() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  // Demo accounts are looked up by email; roles are Community Member (reporters)
  // and School Admin (responders).
  const idFor = (key) => users.find((u) => u.email === `demo.${key}@sentinel.test`)?.id;
  const reporters = ['student', 'teacher', 'nonteaching'].map(idFor).filter(Boolean);
  const student = idFor('student');
  const security = idFor('security');
  const guidance = idFor('guidance');
  if (!student || !security || !guidance) throw new Error('Demo accounts missing. Run scripts/seed-sample-accounts.mjs first.');

  const locations = await must(admin.from('locations').select('id, name, environment').eq('school_id', schoolId).eq('status', 'active'));
  const rooms = locations.filter((l) => !l.name.startsWith('RLS '));
  const gym = rooms.find((l) => l.name.includes('Gymnasium')) ?? rooms[0];

  const emotions = [['joy', 5], ['calm', 6], ['worried', 4], ['stressed', 5], ['sad', 2], ['angry', 1], ['lonely', 1], ['hopeless', 0.4]];
  const baseStress = { joy: 1.5, calm: 1.8, worried: 3.2, stressed: 3.9, sad: 3.3, angry: 3.4, lonely: 3.5, hopeless: 4.4 };

  const submissions = [];
  for (let day = DAYS - 1; day >= 0; day--) {
    const perDay = 3 + Math.floor(rand() * 5);
    for (let i = 0; i < perDay; i++) {
      const emotion = weighted(emotions);
      const stress = Math.min(5, Math.max(1, Math.round(baseStress[emotion] + (rand() - 0.5) * 1.6)));
      const loc = rand() < 0.7 ? pick(rooms) : null;
      submissions.push({
        school_id: schoolId,
        submitted_by: student,
        kind: 'sentiment',
        sub_type: emotion,
        emotion,
        stress_level: stress,
        location_id: loc?.id ?? null,
        message: `${TAG} Feeling ${emotion}, stress ${stress} of 5.`,
        created_at: schoolTime(day).toISOString(),
      });
    }
    if (rand() < 0.85) {
      const kind = rand() < 0.6 ? 'incident_hazard' : 'observation';
      const subType = kind === 'incident_hazard' ? weighted([['unsafe_condition', 5], ['bullying', 2], ['suspicious_activity', 1]]) : weighted([['safety_concern', 3], ['report', 2], ['suggestion', 2]]);
      const loc = rand() < 0.35 ? gym : pick(rooms);
      submissions.push({
        school_id: schoolId,
        submitted_by: pick(reporters),
        kind,
        sub_type: subType,
        location_id: loc.id,
        message: `${TAG} ${subType.replace(/_/g, ' ')} reported at ${loc.name}.`,
        created_at: schoolTime(day).toISOString(),
      });
    }
  }
  const inserted = await must(admin.from('submissions').insert(submissions).select('id, created_at, kind'));

  // Review older items so queues show a realistic mix.
  for (const s of inserted) {
    const ageDays = (Date.now() - new Date(s.created_at).getTime()) / 86_400_000;
    if (ageDays > 4 && rand() < 0.75) {
      await must(admin.from('submissions').update({ status: 'acknowledged', acknowledged_by: s.kind === 'sentiment' ? guidance : security, acknowledged_at: new Date(new Date(s.created_at).getTime() + 3600_000).toISOString() }).eq('id', s.id));
      if (rand() < 0.7) await must(admin.from('submissions').update({ status: 'resolved', resolved_at: new Date(new Date(s.created_at).getTime() + 86_400_000).toISOString(), resolution_note: `${TAG} handled` }).eq('id', s.id));
    }
  }

  const incidentPlan = [
    { day: 12, category: 'medical', end: 'closed' },
    { day: 10, category: 'security', end: 'closed' },
    { day: 8, category: 'other', end: 'resolved' },
    { day: 6, category: 'medical', end: 'resolved' },
    { day: 4, category: 'emergency', end: 'closed' },
    { day: 2, category: 'security', end: 'in_progress' },
    { day: 1, category: 'medical', end: 'acknowledged' },
    { day: 0, category: 'other', end: 'new' },
  ];
  let incidentCount = 0;
  for (const plan of incidentPlan) {
    const created = schoolTime(plan.day);
    const loc = pick(rooms);
    const [incident] = await must(
      admin
        .from('incidents')
        .insert({ school_id: schoolId, created_by: pick(reporters), category: plan.category, location_id: loc.id, description: `${TAG} ${plan.category} incident at ${loc.name}.`, created_at: created.toISOString() })
        .select('id'),
    );
    incidentCount++;
    const ack = new Date(created.getTime() + (3 + Math.floor(rand() * 20)) * 60_000);
    const steps = ['acknowledged', 'assigned', 'in_progress', 'resolved', 'closed'];
    const update = {};
    for (const step of steps.slice(0, steps.indexOf(plan.end) + 1)) {
      if (step === 'acknowledged') Object.assign(update, { acknowledged_by: security, acknowledged_at: ack.toISOString() });
      if (step === 'assigned') Object.assign(update, { assigned_to: security, assigned_at: new Date(ack.getTime() + 10 * 60_000).toISOString() });
      if (step === 'resolved') Object.assign(update, { resolved_at: new Date(ack.getTime() + 3 * 3600_000).toISOString(), resolution_notes: `${TAG} resolved` });
      if (step === 'closed') Object.assign(update, { closed_by: security, closed_at: new Date(ack.getTime() + 24 * 3600_000).toISOString() });
    }
    if (plan.end !== 'new') await must(admin.from('incidents').update({ ...update, status: plan.end }).eq('id', incident.id));
  }

  const checkIns = [];
  for (let day = DAYS - 1; day >= 0; day--) {
    const perDay = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < perDay; i++) {
      checkIns.push({ school_id: schoolId, profile_id: pick(reporters), status: 'safe', location_id: pick(rooms).id, location_source: 'self_selected', period: CHECK_IN_TAG, checked_in_at: schoolTime(day).toISOString() });
    }
  }
  checkIns.push({ school_id: schoolId, profile_id: student, status: 'need_help', location_id: gym.id, location_source: 'self_selected', period: CHECK_IN_TAG, checked_in_at: schoolTime(5).toISOString() });
  checkIns.push({ school_id: schoolId, profile_id: student, status: 'need_help', location_id: pick(rooms).id, location_source: 'self_selected', period: CHECK_IN_TAG, checked_in_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
  await must(admin.from('check_ins').insert(checkIns));

  console.log(`Added ${inserted.length} submissions, ${incidentCount} incidents, ${checkIns.length} check-ins over ${DAYS} days.`);
}

if (process.argv.includes('--clean')) await clean();
else await seedActivity();
