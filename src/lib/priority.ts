// Incident Priority Index = Severity + Urgency + Affected Population.
// Each factor is 1-4. The database computes the index and class
// (incidents.priority_index / priority_level); this mirrors it for the
// live preview while a responder is still choosing.

export type PriorityLevel = 'low' | 'moderate' | 'high' | 'critical';

export const PRIORITY_LEVELS: Record<PriorityLevel, { label: string; range: string; color: string }> = {
  low: { label: 'Low', range: '3–5', color: '#16A34A' },
  moderate: { label: 'Moderate', range: '6–8', color: '#2563EB' },
  high: { label: 'High', range: '9–11', color: '#EA580C' },
  critical: { label: 'Critical', range: '12', color: '#DC2626' },
};

export function classifyPriority(total: number): PriorityLevel {
  if (total >= 12) return 'critical';
  if (total >= 9) return 'high';
  if (total >= 6) return 'moderate';
  return 'low';
}

export const PRIORITY_FACTORS: { key: 'severity' | 'urgency' | 'affected'; label: string; scale: string[] }[] = [
  { key: 'severity', label: 'Severity', scale: ['Minor', 'Moderate', 'Serious', 'Life-threatening'] },
  { key: 'urgency', label: 'Urgency', scale: ['Can wait', 'Today', 'Within the hour', 'Immediate'] },
  { key: 'affected', label: 'Affected population', scale: ['One person', 'A few (2–10)', 'A class (11–50)', 'Many (50+)'] },
];
