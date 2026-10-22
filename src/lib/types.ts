import type { Role } from '../roles';

export type Profile = {
  id: string;
  role: Role;
  display_name: string | null;
  school_id: string | null;
};

export type Location = {
  id: string;
  name: string;
  environment: 'indoor' | 'outdoor' | 'covered';
  parent_id: string | null;
};

export type SubmissionKind = 'sentiment' | 'incident_hazard' | 'observation';
export type ReviewStatus = 'new' | 'acknowledged' | 'resolved';

export type Submission = {
  id: string;
  kind: SubmissionKind;
  sub_type: string;
  emotion: string | null;
  stress_level: number | null;
  message: string;
  status: ReviewStatus;
  location_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

export type IncidentStatus = 'new' | 'acknowledged' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'cancelled';

export type Incident = {
  id: string;
  case_ref: string;
  category: 'emergency' | 'medical' | 'security' | 'other';
  description: string;
  status: IncidentStatus;
  location_id: string | null;
  created_by: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
};

export type CheckIn = {
  id: string;
  profile_id: string;
  status: 'safe' | 'need_help';
  location_id: string | null;
  checked_in_at: string;
};

export type AlertStatus = 'draft' | 'approved' | 'published' | 'corrected' | 'cancelled';

export type Alert = {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'advisory' | 'urgent';
  status: AlertStatus;
  target_scope: 'all' | 'role' | 'responders';
  target_role: Role | null;
  created_by: string;
  created_at: string;
  published_at: string | null;
};

export type AuditEntry = {
  id: number;
  action: string;
  entity_type: string;
  created_at: string;
};
