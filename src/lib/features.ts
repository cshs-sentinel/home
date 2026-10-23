import type { Role, Tab } from '../roles';

// Mirrors public.role_feature_ceiling / role_default_features in the database
// (supabase/migrations/202610230011_three_roles_designations_registration.sql).
// The database rejects a designation whose features exceed its primary role, so
// keep these in sync. Features only shape menus and buttons; what a person may
// read or change is enforced by row-level security on their primary role.

export type Feature =
  | 'report.help'
  | 'report.safe'
  | 'report.feeling'
  | 'report.hazard'
  | 'report.incident'
  | 'report.observation'
  | 'alerts.view'
  | 'insights.view'
  | 'queue.view'
  | 'alerts.draft'
  | 'alerts.approve'
  | 'people.manage'
  | 'setup.locations'
  | 'setup.user_types';

export const FEATURE_GROUPS: { title: string; features: { key: Feature; label: string; hint: string }[] }[] = [
  {
    title: 'Report buttons',
    features: [
      { key: 'report.help', label: 'I need help', hint: 'Help request with location' },
      { key: 'report.safe', label: "I'm safe", hint: 'Safe check-in' },
      { key: 'report.feeling', label: 'How I feel', hint: 'Feelings and stress, visible to School Admins' },
      { key: 'report.hazard', label: 'Report a hazard', hint: 'Unsafe condition, bullying, suspicious activity' },
      { key: 'report.incident', label: 'Report an incident', hint: 'Emergency, medical, security, other' },
      { key: 'report.observation', label: 'Suggest or observe', hint: 'Suggestions and concerns' },
    ],
  },
  {
    title: 'Menus',
    features: [
      { key: 'alerts.view', label: 'Alerts', hint: 'Weather and published alerts' },
      { key: 'insights.view', label: 'Map and Analytics', hint: 'Decision cards, KPIs, and charts' },
      { key: 'queue.view', label: 'Queue', hint: 'Help requests, incidents, and reports to handle' },
      { key: 'alerts.draft', label: 'Draft alerts', hint: 'Write alerts for approval' },
      { key: 'alerts.approve', label: 'Approve alerts', hint: 'Approve, publish, and withdraw alerts' },
      { key: 'people.manage', label: 'People', hint: 'Assign positions, view the activity log' },
      { key: 'setup.locations', label: 'Setup: locations', hint: 'Campus, buildings, rooms, and place types' },
      { key: 'setup.user_types', label: 'Setup: positions', hint: 'Create positions, choose their role and features' },
    ],
  },
];

const REPORT: Feature[] = ['report.help', 'report.safe', 'report.feeling', 'report.hazard', 'report.incident', 'report.observation'];

const CEILING: Record<Role, Feature[]> = {
  community: [...REPORT, 'alerts.view'],
  school_admin: [...REPORT, 'alerts.view', 'insights.view', 'queue.view', 'alerts.draft', 'alerts.approve', 'people.manage', 'setup.locations'],
  system_admin: [...REPORT, 'alerts.view', 'people.manage', 'setup.locations', 'setup.user_types'],
};

export function allowedFeatures(role: Role): Feature[] {
  return CEILING[role];
}

export function defaultFeatures(role: Role): Feature[] {
  if (role === 'school_admin') return CEILING[role].filter((f) => f !== 'setup.locations');
  if (role === 'system_admin') return CEILING[role].filter((f) => f !== 'alerts.view');
  return CEILING[role];
}

// What a person can actually use: their type's features, never more than the
// primary role allows. People without a position get the role's defaults.
export function effectiveFeatures(role: Role, typeFeatures: string[] | null): Set<Feature> {
  const ceiling = new Set(CEILING[role]);
  const chosen = typeFeatures ?? defaultFeatures(role);
  return new Set(chosen.filter((f): f is Feature => ceiling.has(f as Feature)));
}

// The tabs a person sees, in sidebar order. Every tab follows the position's
// features, so a position without `report.help` has no Get Help tab.
// `simplified` is the Community Member layout: big-button tabs for feelings,
// incidents, help, and updates, then My Reports.
export function navFor(features: Set<Feature>, simplified = false): Tab[] {
  const has = (f: Feature) => features.has(f);
  if (simplified) {
    const open: Record<'feel' | 'incident' | 'help' | 'know' | 'mine', boolean> = {
      feel: has('report.feeling'),
      incident: has('report.incident') || has('report.hazard'),
      help: has('report.help') || has('report.safe'),
      know: has('alerts.view'),
      mine: REPORT.some(has),
    };
    return (['feel', 'incident', 'help', 'know', 'mine'] as const).filter((t) => open[t]);
  }
  type StaffTab = Exclude<Tab, 'feel' | 'incident' | 'help' | 'know' | 'mine'>;
  const available: Record<StaffTab, boolean> = {
    map: has('insights.view'),
    analytics: has('insights.view'),
    queue: has('queue.view'),
    alerts: has('alerts.view') || has('alerts.draft') || has('alerts.approve'),
    report: REPORT.some(has),
    people: has('people.manage'),
    setup: has('setup.locations') || has('setup.user_types'),
  };
  // Insight roles start on the Map; others start on whatever they manage.
  const order: StaffTab[] = available.map
    ? ['map', 'analytics', 'queue', 'alerts', 'report', 'people', 'setup']
    : ['setup', 'people', 'report', 'alerts', 'queue'];
  return order.filter((t) => available[t]);
}
