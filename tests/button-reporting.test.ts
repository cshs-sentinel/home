import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveFeatures, navFor } from '../src/lib/features.ts';
import { ALL_INCIDENT_CATEGORIES, CRISIS_EMOTIONS, FEELINGS, HELP_INITIAL_TRIAGE, HELP_TYPES, INCIDENT_CATEGORIES, NEGATIVE_EMOTIONS, labelFor } from '../src/lib/catalog.ts';
import { DEFAULT_PRIORITY, PRIORITY_LEVELS, classifyPriority, defaultPriorityFor } from '../src/lib/priority.ts';
import { TAB_LABELS } from '../src/roles.ts';

test('a Community Member gets exactly the four big-button tabs, with My Reports behind More', () => {
  const nav = navFor(effectiveFeatures('community', null), true);
  assert.deepEqual(nav.primary, ['feel', 'incident', 'help', 'know']);
  assert.deepEqual(nav.more, ['mine']);
  assert.deepEqual(
    nav.primary.map((t) => TAB_LABELS[t].label),
    ['Tell Us How You Feel', 'Report an Incident', 'Get Help', 'Things You Need to Know Now'],
  );
});

test('each community tab follows the position features', () => {
  const onlyHelp = navFor(effectiveFeatures('community', ['report.help', 'alerts.view']), true);
  assert.deepEqual(onlyHelp.primary, ['help', 'know']);
  const none = navFor(effectiveFeatures('community', []), true);
  assert.deepEqual(none.primary, []);
  assert.deepEqual(none.more, []);
});

test('School Admins and System Admins keep their own layout, not the community tabs', () => {
  const sa = navFor(effectiveFeatures('school_admin', null));
  assert.deepEqual(sa.primary, ['map', 'analytics']);
  assert.ok(sa.more.includes('report'));
  assert.ok(![...sa.primary, ...sa.more].some((t) => ['feel', 'incident', 'help', 'know', 'mine'].includes(t)));
});

test('the incident buttons are exactly the ten requested, and Severe Weather is gone', () => {
  assert.deepEqual(
    INCIDENT_CATEGORIES.map((o) => o.label),
    ['Bullying', 'Suspicious Person', 'Fire / Smoke', 'Electrical Hazard', 'Structural Damage', 'Injury / Accident', 'Threat / Violence', 'Water / Chemical Spill', 'Unsafe Facility', 'Other Concern'],
  );
  assert.ok(!ALL_INCIDENT_CATEGORIES.some((o) => /weather/i.test(o.value) || /weather/i.test(o.label)));
});

test('the help buttons are exactly the six requested; Someone Missing and Disaster Assistance are gone', () => {
  assert.deepEqual(
    HELP_TYPES.map((o) => o.label),
    ['Emergency Help', 'Medical Assistance', 'Safety Assistance', 'Counseling / Support', 'Accessibility Assistance', 'Other Help'],
  );
  assert.ok(!HELP_TYPES.some((o) => /missing|disaster/i.test(o.label)));
});

test('the feeling buttons are exactly the six requested, in order', () => {
  assert.deepEqual(
    FEELINGS.map((f) => f.label),
    ['Good', 'Okay', 'Not Good', 'Upset', 'Unsafe', 'Need Support'],
  );
  assert.ok(CRISIS_EMOTIONS.has('unsafe') && CRISIS_EMOTIONS.has('need_support'));
  assert.ok(NEGATIVE_EMOTIONS.has('upset') && !NEGATIVE_EMOTIONS.has('good'));
});

test('every default priority factor is 1-4 and every incident button has a default', () => {
  for (const o of ALL_INCIDENT_CATEGORIES) {
    const d = DEFAULT_PRIORITY[o.value];
    assert.ok(d, `no default for ${o.value}`);
    for (const v of [d.severity, d.urgency, d.affected]) assert.ok(v >= 1 && v <= 4, `${o.value} factor out of range`);
  }
});

test('P = S + U + A and the class follows 3-5 low, 6-8 moderate, 9-11 high, 12 critical', () => {
  assert.deepEqual(defaultPriorityFor('fire_smoke'), { index: 12, level: 'critical' });
  assert.deepEqual(defaultPriorityFor('threat_violence'), { index: 11, level: 'high' });
  assert.deepEqual(defaultPriorityFor('bullying'), { index: 6, level: 'moderate' });
  assert.deepEqual(defaultPriorityFor('other_concern'), { index: 5, level: 'low' });
  assert.equal(classifyPriority(5), 'low');
  assert.equal(classifyPriority(8), 'moderate');
  assert.equal(classifyPriority(11), 'high');
  assert.equal(classifyPriority(12), 'critical');
  assert.deepEqual(Object.keys(PRIORITY_LEVELS).sort(), ['critical', 'high', 'low', 'moderate']);
});

test('life-safety categories default to High or Critical so they are not buried', () => {
  for (const c of ['fire_smoke', 'threat_violence', 'suspicious_person', 'injury_accident', 'structural_damage']) {
    const { level } = defaultPriorityFor(c);
    assert.ok(level === 'high' || level === 'critical', `${c} defaults to ${level}`);
  }
});

test('emergency, medical, and safety help start urgent; the rest wait for triage', () => {
  for (const h of ['emergency_help', 'medical_assistance', 'safety_assistance']) assert.equal(HELP_INITIAL_TRIAGE[h], 'urgent');
  for (const h of ['counseling_support', 'accessibility_assistance', 'other_help']) assert.equal(HELP_INITIAL_TRIAGE[h], 'awaiting_triage');
  for (const o of HELP_TYPES) assert.ok(HELP_INITIAL_TRIAGE[o.value], `no routing for ${o.value}`);
});

test('older feelings and categories still have readable labels', () => {
  assert.equal(labelFor('stressed'), 'Stressed');
  assert.equal(labelFor('emergency'), 'Emergency');
  assert.equal(labelFor('water_chemical_spill'), 'Water / Chemical Spill');
});
