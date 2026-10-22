// The three fixed primary roles. They mirror the `app_role` values the database
// accepts (older enum labels still exist in Postgres but a CHECK constraint
// stops them from being stored). A person's designation (position) maps to
// exactly one of these roles; the role, not the label, grants access.
// See docs/roles-and-permissions.md.
export type Role = 'system_admin' | 'school_admin' | 'community';

export type Tab = 'report' | 'map' | 'analytics' | 'queue' | 'alerts' | 'people' | 'setup';

export const ROLE_ORDER: Role[] = ['community', 'school_admin', 'system_admin'];

export const TAB_LABELS: Record<Tab, { label: string; icon: string }> = {
  report: { label: 'Report', icon: '✚' },
  map: { label: 'Map', icon: '🗺' },
  analytics: { label: 'Analytics', icon: '◔' },
  queue: { label: 'Queue', icon: '☰' },
  alerts: { label: 'Alerts', icon: '📣' },
  people: { label: 'People', icon: '👥' },
  setup: { label: 'Setup', icon: '⚙' },
};

export const roleDetails: Record<Role, { label: string; icon: string; summary: string }> = {
  community: {
    label: 'Community Member',
    icon: '◉',
    summary: 'Tell us how you feel or report something unsafe in a few taps.',
  },
  school_admin: {
    label: 'School Admin',
    icon: '◆',
    summary: 'Coordinators and responders: watch the whole picture, handle reports, and approve alerts.',
  },
  system_admin: {
    label: 'System Admin',
    icon: '▦',
    summary: 'Set up the campus, places, positions, and accounts.',
  },
};
