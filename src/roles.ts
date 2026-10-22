// Mirrors the `app_role` enum and RLS policies in the live Supabase project.
// Keep this in sync with the database — see docs/roles-and-permissions.md.
export type Role =
  | 'student'
  | 'teacher'
  | 'non_teaching'
  | 'security'
  | 'drrm'
  | 'guidance'
  | 'school_admin'
  | 'system_admin';

export type Tab = 'report' | 'insights' | 'queue' | 'alerts' | 'people' | 'setup';

export const ROLE_ORDER: Role[] = ['student', 'teacher', 'non_teaching', 'security', 'drrm', 'guidance', 'school_admin', 'system_admin'];

export const TAB_LABELS: Record<Tab, { label: string; icon: string }> = {
  report: { label: 'Report', icon: '✚' },
  insights: { label: 'Insights', icon: '◔' },
  queue: { label: 'Queue', icon: '☰' },
  alerts: { label: 'Alerts', icon: '📣' },
  people: { label: 'People', icon: '👥' },
  setup: { label: 'Setup', icon: '⚙' },
};

export const roleDetails: Record<Role, { label: string; icon: string; summary: string }> = {
  student: {
    label: 'Student',
    icon: '◉',
    summary: 'Tell us how you feel or report something unsafe in a few taps.',
  },
  teacher: {
    label: 'Teacher',
    icon: '✎',
    summary: 'Report concerns and triage non-confidential reports from your school.',
  },
  non_teaching: {
    label: 'Non-Teaching Staff',
    icon: '◇',
    summary: 'Report concerns and stay informed with school alerts.',
  },
  security: {
    label: 'Security',
    icon: '▣',
    summary: 'Respond to incidents and help requests as they come in.',
  },
  drrm: {
    label: 'DRRM Coordinator',
    icon: '⌁',
    summary: 'Watch hazards, weather, and incidents, and draft alerts for approval.',
  },
  guidance: {
    label: 'Guidance Counselor',
    icon: '❖',
    summary: 'Confidential view of how students feel, with follow-ups that need you.',
  },
  school_admin: {
    label: 'School Admin',
    icon: '◆',
    summary: 'See the whole picture and approve what the school is told.',
  },
  system_admin: {
    label: 'System Admin',
    icon: '▦',
    summary: 'Set up the campus, places, and user types, and manage accounts.',
  },
};
