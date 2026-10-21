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

export const ROLE_ORDER: Role[] = [
  'student',
  'teacher',
  'non_teaching',
  'security',
  'drrm',
  'guidance',
  'school_admin',
  'system_admin',
];

export const roleDetails: Record<Role, { label: string; icon: string; summary: string; actions: string[] }> = {
  student: {
    label: 'Student',
    icon: '◉',
    summary: 'Speak up about safety and wellbeing, and follow your own reports.',
    actions: [
      'Answer a school climate survey',
      'Report a hazard or incident',
      "Check in on how you're feeling",
      'Track the status of your own reports',
      'View alerts for your role',
    ],
  },
  teacher: {
    label: 'Teacher',
    icon: '✎',
    summary: 'Report concerns and help triage non-confidential student submissions.',
    actions: [
      'Report a hazard or incident',
      'Review non-confidential student submissions',
      'Update a report you can see',
      'View alerts for your role',
    ],
  },
  non_teaching: {
    label: 'Non-Teaching Staff',
    icon: '◇',
    summary: 'Support staff with the same reporting access as the wider school community.',
    actions: [
      'Report a hazard or incident',
      'Answer a school climate survey',
      'View approved alerts and announcements',
    ],
  },
  security: {
    label: 'Security',
    icon: '▣',
    summary: 'First responder for incidents — acknowledge, assign, and track.',
    actions: [
      'Acknowledge and assign incoming incidents',
      'Review all incident and check-in activity',
      'Add internal notes to a case',
      'Receive responder-only alerts',
    ],
  },
  drrm: {
    label: 'DRRM Coordinator',
    icon: '⌁',
    summary: 'Coordinate disaster-risk reduction response and keep leadership informed.',
    actions: [
      'Review all incidents and check-ins school-wide',
      'Draft an alert for school-leader approval',
      'Monitor non-confidential survey trends',
      'Add internal notes and assign cases',
    ],
  },
  guidance: {
    label: 'Guidance Counselor',
    icon: '❖',
    summary: 'Confidential access to wellbeing submissions, kept separate from general staff.',
    actions: [
      'Review confidential wellbeing submissions',
      'Respond to and resolve wellbeing cases',
      'Track your own caseload',
      'View alerts for your role',
    ],
  },
  school_admin: {
    label: 'School Admin',
    icon: '◆',
    summary: "Full operational authority: approvals, access, and the school's configuration.",
    actions: [
      'Approve and publish alerts',
      'Manage accounts and role assignments',
      'Configure locations, categories, and schedules',
      'Review the school audit log',
      'See every incident, check-in, and submission',
    ],
  },
  system_admin: {
    label: 'System Admin',
    icon: '▦',
    summary: 'Technical administration across schools, without access to confidential content.',
    actions: [
      'Review the audit log',
      'Support account and access issues',
      'Escalate confidential cases to Guidance or the School Admin',
    ],
  },
};
