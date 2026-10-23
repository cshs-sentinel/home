import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_ORDER, roleDetails } from '../src/roles.ts';
import { allowedFeatures, defaultFeatures, effectiveFeatures, navFor } from '../src/lib/features.ts';
import { locationFits, placeLabel } from '../src/lib/layout.ts';
import type { Location } from '../src/lib/types.ts';

test('there are exactly three fixed primary roles', () => {
  assert.deepEqual([...ROLE_ORDER].sort(), ['community', 'school_admin', 'system_admin']);
  assert.deepEqual(Object.keys(roleDetails).sort(), ['community', 'school_admin', 'system_admin']);
});

test('a Community Member can report and read alerts, nothing else', () => {
  const features = allowedFeatures('community');
  assert.ok(features.includes('report.help'));
  assert.ok(features.includes('alerts.view'));
  for (const f of ['insights.view', 'queue.view', 'people.manage', 'setup.locations', 'setup.user_types', 'alerts.approve'] as const) {
    assert.ok(!features.includes(f), `community must not have ${f}`);
  }
});

test('only the System Admin role can set up positions', () => {
  assert.ok(allowedFeatures('system_admin').includes('setup.user_types'));
  assert.ok(!allowedFeatures('school_admin').includes('setup.user_types'));
  assert.ok(!allowedFeatures('community').includes('setup.user_types'));
});

test('School Admin keeps the operational features, System Admin does not see the dashboards', () => {
  const admin = allowedFeatures('school_admin');
  for (const f of ['insights.view', 'queue.view', 'alerts.draft', 'alerts.approve', 'people.manage'] as const) assert.ok(admin.includes(f));
  assert.ok(!allowedFeatures('system_admin').includes('insights.view'));
  assert.ok(!allowedFeatures('system_admin').includes('queue.view'));
});

test('a position can never grant more than its role allows', () => {
  const granted = effectiveFeatures('community', ['report.help', 'queue.view', 'setup.user_types', 'people.manage']);
  assert.deepEqual([...granted], ['report.help']);
  const elevated = effectiveFeatures('school_admin', ['setup.user_types']);
  assert.equal(elevated.size, 0);
});

test('a person without a position gets the role defaults', () => {
  assert.deepEqual([...effectiveFeatures('community', null)].sort(), [...defaultFeatures('community')].sort());
  assert.ok(!effectiveFeatures('school_admin', null).has('setup.locations'));
});

test('navigation: community sees Report and Alerts, School Admin gets Dashboard, Map and Analytics first', () => {
  const community = navFor(effectiveFeatures('community', null));
  assert.deepEqual([...community].sort(), ['alerts', 'report']);
  const admin = navFor(effectiveFeatures('school_admin', null));
  assert.deepEqual(admin.slice(0, 3), ['dashboard', 'map', 'analytics']);
  assert.ok(admin.includes('queue') && admin.includes('people'));
  const system = navFor(effectiveFeatures('system_admin', null));
  assert.ok(system.includes('setup') && system.includes('people'));
});

const place = (id: string, name: string, parent: string | null): Location => ({
  id, name, parent_id: parent, environment: 'indoor', grid_cols: 0, grid_rows: 0, layout_x: null, layout_y: null, layout_w: null, layout_h: null,
});

test('a default location is shown as its path from the campus down', () => {
  const places = [place('c', 'Campus', null), place('b', 'Admin', 'c'), place('r', 'Room 101', 'b')];
  assert.equal(placeLabel('r', places), 'Admin › Room 101');
  assert.equal(placeLabel(null, places), 'No location');
});

test('the location hierarchy only allows Campus > Building > Area > Room', () => {
  assert.ok(locationFits(1, null));
  assert.ok(!locationFits(2, null));
  assert.ok(locationFits(4, 3));
  assert.ok(!locationFits(4, 1));
});
