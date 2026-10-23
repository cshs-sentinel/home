// Every value here mirrors a CHECK constraint in the live database (see
// supabase/migrations/202610230018_button_reporting.sql). Adding an option
// without a matching migration will make inserts fail.

export type Option = { value: string; label: string; icon: string };

// The six feelings a Community Member can tap. `stress` is what the database
// derives when a feeling is saved without a stress level (validate_submission),
// kept here so tests can prove the two agree.
export const FEELINGS: (Option & { tone: 'positive' | 'negative'; stress: number })[] = [
  { value: 'good', label: 'Good', icon: '😊', tone: 'positive', stress: 1 },
  { value: 'okay', label: 'Okay', icon: '😐', tone: 'positive', stress: 2 },
  { value: 'not_good', label: 'Not Good', icon: '🙁', tone: 'negative', stress: 3 },
  { value: 'upset', label: 'Upset', icon: '😣', tone: 'negative', stress: 4 },
  { value: 'unsafe', label: 'Unsafe', icon: '😨', tone: 'negative', stress: 5 },
  { value: 'need_support', label: 'Need Support', icon: '🤝', tone: 'negative', stress: 5 },
];

// Feelings that earlier versions of the app saved. They are no longer offered
// but still appear in old reports, analytics, and the map.
// Also what the School Admin's own Report tab still offers.
export const LEGACY_EMOTIONS: (Option & { tone: 'positive' | 'negative' })[] = [
  { value: 'joy', label: 'Happy', icon: '😄', tone: 'positive' },
  { value: 'calm', label: 'Calm', icon: '😌', tone: 'positive' },
  { value: 'worried', label: 'Worried', icon: '😟', tone: 'negative' },
  { value: 'stressed', label: 'Stressed', icon: '😣', tone: 'negative' },
  { value: 'sad', label: 'Sad', icon: '😢', tone: 'negative' },
  { value: 'angry', label: 'Angry', icon: '😠', tone: 'negative' },
  { value: 'lonely', label: 'Lonely', icon: '🫥', tone: 'negative' },
  { value: 'hopeless', label: 'Hopeless', icon: '😞', tone: 'negative' },
];

export const EMOTIONS = [...FEELINGS, ...LEGACY_EMOTIONS];

export const STRESS_LEVELS: Option[] = [
  { value: '1', label: 'Very low', icon: '1' },
  { value: '2', label: 'Low', icon: '2' },
  { value: '3', label: 'Medium', icon: '3' },
  { value: '4', label: 'High', icon: '4' },
  { value: '5', label: 'Very high', icon: '5' },
];

export const HAZARDS: Option[] = [
  { value: 'unsafe_condition', label: 'Unsafe condition', icon: '⚠️' },
  { value: 'bullying', label: 'Bullying', icon: '🚫' },
  { value: 'suspicious_activity', label: 'Suspicious activity', icon: '👁️' },
];

export const OBSERVATIONS: Option[] = [
  { value: 'safety_concern', label: 'Safety concern', icon: '🛡️' },
  { value: 'report', label: 'General report', icon: '📝' },
  { value: 'suggestion', label: 'Suggestion', icon: '💡' },
];

// The four incident categories School Admins have always had in their own Report tab.
export const INCIDENTS: Option[] = [
  { value: 'emergency', label: 'Emergency', icon: '🚨' },
  { value: 'medical', label: 'Medical', icon: '🩺' },
  { value: 'security', label: 'Security', icon: '🔒' },
  { value: 'other', label: 'Other', icon: '❗' },
];

// Report an Incident buttons. Severe weather is deliberately not here: weather
// advisories live under Things You Need to Know Now.
export const INCIDENT_CATEGORIES: Option[] = [
  { value: 'bullying', label: 'Bullying', icon: '🚫' },
  { value: 'suspicious_person', label: 'Suspicious Person', icon: '🕵️' },
  { value: 'fire_smoke', label: 'Fire / Smoke', icon: '🔥' },
  { value: 'electrical_hazard', label: 'Electrical Hazard', icon: '⚡' },
  { value: 'structural_damage', label: 'Structural Damage', icon: '🏚️' },
  { value: 'injury_accident', label: 'Injury / Accident', icon: '🩹' },
  { value: 'threat_violence', label: 'Threat / Violence', icon: '⚠️' },
  { value: 'water_chemical_spill', label: 'Water / Chemical Spill', icon: '🧪' },
  { value: 'unsafe_facility', label: 'Unsafe Facility', icon: '🚧' },
  { value: 'other_concern', label: 'Other Concern', icon: '❗' },
];

// Every incident category that can exist, newest first, for filters and labels.
export const ALL_INCIDENT_CATEGORIES: Option[] = [...INCIDENT_CATEGORIES, ...INCIDENTS];

// Get Help buttons. Someone Missing and Disaster Assistance are not offered.
export const HELP_TYPES: Option[] = [
  { value: 'emergency_help', label: 'Emergency Help', icon: '🆘' },
  { value: 'medical_assistance', label: 'Medical Assistance', icon: '🩺' },
  { value: 'safety_assistance', label: 'Safety Assistance', icon: '🛡️' },
  { value: 'counseling_support', label: 'Counseling / Support', icon: '💬' },
  { value: 'accessibility_assistance', label: 'Accessibility Assistance', icon: '♿' },
  { value: 'other_help', label: 'Other Help', icon: '🙋' },
];

// How a help request is first routed. The database decides this from the type
// (validate_check_in); this copy is only for explaining it and for tests.
export const HELP_INITIAL_TRIAGE: Record<string, 'urgent' | 'awaiting_triage'> = {
  emergency_help: 'urgent',
  medical_assistance: 'urgent',
  safety_assistance: 'urgent',
  counseling_support: 'awaiting_triage',
  accessibility_assistance: 'awaiting_triage',
  other_help: 'awaiting_triage',
};

export const TRIAGE_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  awaiting_triage: 'Waiting for triage',
  responding: 'Help is on the way',
  resolved: 'Resolved',
};

const all = [...EMOTIONS, ...HAZARDS, ...OBSERVATIONS, ...ALL_INCIDENT_CATEGORIES, ...HELP_TYPES];

export function labelFor(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  return all.find((o) => o.value === value)?.label ?? value.replace(/_/g, ' ');
}

export function iconFor(value: string | null | undefined): string {
  return all.find((o) => o.value === value)?.icon ?? '•';
}

export const NEGATIVE_EMOTIONS = new Set(EMOTIONS.filter((e) => e.tone === 'negative').map((e) => e.value));
// Feelings that call for a follow-up from a School Admin.
export const CRISIS_EMOTIONS = new Set(['hopeless', 'lonely', 'unsafe', 'need_support']);
