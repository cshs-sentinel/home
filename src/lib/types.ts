import type { Role } from '../roles';

export type Profile = {
  id: string;
  role: Role;
  display_name: string | null;
  school_id: string | null;
  user_type_id: string | null;
};

export type UserType = {
  id: string;
  name: string;
  description: string | null;
  base_role: Role;
  features: string[];
  is_active: boolean;
  is_system: boolean;
};

export type Environment = 'indoor' | 'outdoor' | 'covered';

export type Location = {
  id: string;
  name: string;
  environment: Environment;
  parent_id: string | null;
  grid_cols: number;
  grid_rows: number;
  layout_x: number | null;
  layout_y: number | null;
  layout_w: number | null;
  layout_h: number | null;
};

export type Block = { x: number; y: number; w: number; h: number };

export type SetupLocation = Location & {
  category_id: string;
  code: string | null;
  status: 'active' | 'inactive' | 'archived';
};

export type LocationType = {
  id: string;
  name: string;
  level: 1 | 2 | 3 | 4 | 5;
  environment: 'indoor' | 'outdoor' | 'either';
  is_active: boolean;
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
  priority_severity: number | null;
  priority_urgency: number | null;
  priority_affected: number | null;
  priority_index: number | null;
  priority_level: 'low' | 'moderate' | 'high' | 'critical' | null;
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
