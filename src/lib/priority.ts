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

// Default Priority Index factors applied by the system when a report arrives
// (public.default_incident_priority). Conservative on purpose: when the true
// extent is unknown the default errs towards the higher class, and a responder
// confirms or changes it while evaluating the report. P = S + U + A.
export const DEFAULT_PRIORITY: Record<string, { severity: number; urgency: number; affected: number; why: string }> = {
  fire_smoke: { severity: 4, urgency: 4, affected: 4, why: 'Spreads fast and can reach the whole building' },
  threat_violence: { severity: 4, urgency: 4, affected: 3, why: 'Life-threatening and immediate, likely a class or more' },
  suspicious_person: { severity: 3, urgency: 4, affected: 3, why: 'Possible threat that needs eyes on it now' },
  injury_accident: { severity: 3, urgency: 4, affected: 2, why: 'Serious until checked, needs a response now, may involve a few' },
  structural_damage: { severity: 3, urgency: 3, affected: 3, why: 'Collapse risk for whoever uses the space' },
  electrical_hazard: { severity: 3, urgency: 3, affected: 2, why: 'Shock or fire risk, within the hour' },
  water_chemical_spill: { severity: 2, urgency: 3, affected: 2, why: 'Slip or exposure risk, within the hour' },
  bullying: { severity: 3, urgency: 2, affected: 1, why: 'Serious for wellbeing, handled the same day' },
  unsafe_facility: { severity: 2, urgency: 2, affected: 2, why: 'Needs fixing today for the people who use it' },
  other_concern: { severity: 2, urgency: 2, affected: 1, why: 'Unknown until evaluated' },
  emergency: { severity: 4, urgency: 4, affected: 2, why: 'Older category' },
  medical: { severity: 3, urgency: 4, affected: 1, why: 'Older category' },
  security: { severity: 3, urgency: 3, affected: 2, why: 'Older category' },
  other: { severity: 2, urgency: 2, affected: 1, why: 'Older category' },
};

export function defaultPriorityFor(category: string): { index: number; level: PriorityLevel } {
  const d = DEFAULT_PRIORITY[category] ?? DEFAULT_PRIORITY.other;
  const index = d.severity + d.urgency + d.affected;
  return { index, level: classifyPriority(index) };
}
