// Every value here mirrors a CHECK constraint in the live database. Adding an
// option without a matching migration will make inserts fail.

export type Option = { value: string; label: string; icon: string };

export const EMOTIONS: (Option & { tone: 'positive' | 'negative' })[] = [
  { value: 'joy', label: 'Happy', icon: '😄', tone: 'positive' },
  { value: 'calm', label: 'Calm', icon: '😌', tone: 'positive' },
  { value: 'worried', label: 'Worried', icon: '😟', tone: 'negative' },
  { value: 'stressed', label: 'Stressed', icon: '😣', tone: 'negative' },
  { value: 'sad', label: 'Sad', icon: '😢', tone: 'negative' },
  { value: 'angry', label: 'Angry', icon: '😠', tone: 'negative' },
  { value: 'lonely', label: 'Lonely', icon: '🫥', tone: 'negative' },
  { value: 'hopeless', label: 'Hopeless', icon: '😞', tone: 'negative' },
];

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

export const INCIDENTS: Option[] = [
  { value: 'emergency', label: 'Emergency', icon: '🚨' },
  { value: 'medical', label: 'Medical', icon: '🩺' },
  { value: 'security', label: 'Security', icon: '🔒' },
  { value: 'other', label: 'Other', icon: '❗' },
];

const all = [...EMOTIONS, ...HAZARDS, ...OBSERVATIONS, ...INCIDENTS];

export function labelFor(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  return all.find((o) => o.value === value)?.label ?? value.replace(/_/g, ' ');
}

export function iconFor(value: string | null | undefined): string {
  return all.find((o) => o.value === value)?.icon ?? '•';
}

export const NEGATIVE_EMOTIONS = new Set(EMOTIONS.filter((e) => e.tone === 'negative').map((e) => e.value));
export const CRISIS_EMOTIONS = new Set(['hopeless', 'lonely']);
