import { CRISIS_EMOTIONS, NEGATIVE_EMOTIONS, labelFor } from './catalog';
import type { CheckIn, Incident, Location, Submission } from './types';
import { heatLevel, type Quake, type Severity, type WeatherSnapshot } from './weather';
import type { Role } from '../roles';

const DAY = 24 * 3600_000;

export function since<T>(rows: T[], days: number, dateOf: (row: T) => string, now = Date.now()): T[] {
  const cutoff = now - days * DAY;
  return rows.filter((r) => new Date(dateOf(r)).getTime() >= cutoff);
}

export function between<T>(rows: T[], fromDaysAgo: number, toDaysAgo: number, dateOf: (row: T) => string, now = Date.now()): T[] {
  const start = now - fromDaysAgo * DAY;
  const end = now - toDaysAgo * DAY;
  return rows.filter((r) => {
    const t = new Date(dateOf(r)).getTime();
    return t >= start && t < end;
  });
}

export type Count = { key: string; label: string; count: number };

export function countBy<T>(rows: T[], keyOf: (row: T) => string | null, labelOf: (key: string) => string = labelFor): Count[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, label: labelOf(key), count })).sort((a, b) => b.count - a.count);
}

export type DailyValue = { date: string; value: number | null; n: number };

export function dailyAverage<T>(rows: T[], days: number, dateOf: (row: T) => string, valueOf: (row: T) => number | null, now = new Date()): DailyValue[] {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    const v = valueOf(r);
    if (v === null) continue;
    const key = localDay(new Date(dateOf(r)));
    buckets.set(key, [...(buckets.get(key) ?? []), v]);
  }
  const out: DailyValue[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = localDay(new Date(now.getTime() - i * DAY));
    const vals = buckets.get(key) ?? [];
    out.push({ date: key, value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, n: vals.length });
  }
  return out;
}

export function dailyCount<T>(rows: T[], days: number, dateOf: (row: T) => string, now = new Date()): DailyValue[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = localDay(new Date(dateOf(r)));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: DailyValue[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = localDay(new Date(now.getTime() - i * DAY));
    const n = counts.get(key) ?? 0;
    out.push({ date: key, value: n, n });
  }
  return out;
}

export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function sentimentSummary(rows: Submission[]) {
  const sentiments = rows.filter((r) => r.kind === 'sentiment');
  const stress = sentiments.map((r) => r.stress_level).filter((v): v is number => v !== null);
  const negative = sentiments.filter((r) => NEGATIVE_EMOTIONS.has(r.sub_type)).length;
  return {
    total: sentiments.length,
    avgStress: mean(stress),
    negativeShare: sentiments.length ? negative / sentiments.length : null,
    highStress: sentiments.filter((r) => (r.stress_level ?? 0) >= 4).length,
    needsFollowUp: sentiments.filter((r) => r.status !== 'resolved' && (CRISIS_EMOTIONS.has(r.sub_type) || (r.stress_level ?? 0) >= 5)),
  };
}

export const OPEN_INCIDENT: Incident['status'][] = ['new', 'acknowledged', 'assigned', 'in_progress'];

export function incidentSummary(incidents: Incident[], now = Date.now()) {
  const open = incidents.filter((i) => OPEN_INCIDENT.includes(i.status));
  const unacknowledged = open.filter((i) => i.status === 'new');
  const overdue = unacknowledged
    .filter((i) => now - new Date(i.created_at).getTime() > 15 * 60_000)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const ackMinutes = incidents
    .filter((i) => i.acknowledged_at)
    .map((i) => (new Date(i.acknowledged_at!).getTime() - new Date(i.created_at).getTime()) / 60_000)
    .sort((a, b) => a - b);
  const median = ackMinutes.length ? ackMinutes[Math.floor(ackMinutes.length / 2)] : null;
  return { open: open.length, unacknowledged: unacknowledged.length, overdue, medianAckMinutes: median };
}

export function locationName(locations: Location[], id: string | null): string {
  if (!id) return 'No location given';
  return locations.find((l) => l.id === id)?.name ?? 'Unknown location';
}

export function hotspots(rows: { location_id: string | null }[], locations: Location[]): Count[] {
  return countBy(rows, (r) => r.location_id, (id) => locationName(locations, id));
}

// --- Decision insights -----------------------------------------------------

export type InsightSeverity = Severity | 'info';

export type AlertTemplate = 'heat' | 'rain' | 'wind' | 'quake' | 'wellbeing';

export type Insight = {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  draftAlert?: AlertTemplate;
};

type InsightInput = {
  role: Role;
  weather: WeatherSnapshot | null;
  quakes: Quake[];
  submissions: Submission[];
  incidents: Incident[];
  checkIns: CheckIn[];
  locations: Location[];
  now?: number;
};

const SEVERITY_RANK: Record<InsightSeverity, number> = { critical: 0, serious: 1, warning: 2, info: 3, good: 4 };

export function generateInsights(input: InsightInput): Insight[] {
  const { role, weather, quakes, submissions, incidents, checkIns, locations } = input;
  const now = input.now ?? Date.now();
  const out: Insight[] = [];
  const canDraftAlerts = role === 'drrm' || role === 'school_admin';

  if (weather) {
    const peak = weather.peakToday;
    const level = heatLevel(peak.heatIndex);
    if (level.severity !== 'good' && level.severity !== 'warning') {
      out.push({
        id: 'heat',
        severity: level.severity,
        title: `Heat index peaks at ${Math.round(peak.heatIndex)}°C around ${formatHour(peak.time)} (${level.label})`,
        detail: level.advice,
        draftAlert: canDraftAlerts ? 'heat' : undefined,
      });
    }
    if (weather.thunderstormAhead || weather.heavyRainHours > 0) {
      out.push({
        id: 'rain',
        severity: weather.thunderstormAhead ? 'serious' : 'warning',
        title: weather.thunderstormAhead ? 'Thunderstorms expected in the next 24 hours' : `Heavy rain expected for ${weather.heavyRainHours} hour(s)`,
        detail: 'Check drainage and covered walkways, and prepare for possible flooding near entrances.',
        draftAlert: canDraftAlerts ? 'rain' : undefined,
      });
    }
    if (weather.maxGustKmh >= 60) {
      out.push({
        id: 'wind',
        severity: weather.maxGustKmh >= 89 ? 'critical' : 'serious',
        title: `Wind gusts up to ${Math.round(weather.maxGustKmh)} km/h`,
        detail: 'Secure loose objects outdoors and avoid open areas near trees and signage.',
        draftAlert: canDraftAlerts ? 'wind' : undefined,
      });
    }
  }

  const strongQuake = quakes.find((q) => q.magnitude >= 5 || (q.magnitude >= 4 && q.distanceKm <= 100 && now - q.time.getTime() < DAY));
  if (strongQuake) {
    out.push({
      id: 'quake',
      severity: strongQuake.magnitude >= 6 ? 'critical' : 'serious',
      title: `M${strongQuake.magnitude.toFixed(1)} earthquake ${Math.round(strongQuake.distanceKm)} km away`,
      detail: `${strongQuake.place}. Inspect buildings for cracks and review evacuation routes.`,
      draftAlert: canDraftAlerts ? 'quake' : undefined,
    });
  }

  const needHelp = since(checkIns, 1, (c) => c.checked_in_at, now)
    .filter((c) => c.status === 'need_help')
    .sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at));
  if (needHelp.length && (role === 'security' || role === 'drrm' || role === 'school_admin')) {
    out.push({
      id: 'need-help',
      severity: 'critical',
      title: `${needHelp.length} "I need help" check-in${needHelp.length > 1 ? 's' : ''} in the last 24 hours`,
      detail: `Latest at ${locationName(locations, needHelp[0].location_id)}. Reach out in person.`,
    });
  }

  const { overdue } = incidentSummary(incidents, now);
  if (overdue.length) {
    out.push({
      id: 'overdue',
      severity: 'critical',
      title: `${overdue.length} incident${overdue.length > 1 ? 's' : ''} not acknowledged after 15 minutes`,
      detail: `Oldest: ${overdue[overdue.length - 1].case_ref}. Acknowledge so the reporter knows help is coming.`,
    });
  }

  const reports = submissions.filter((s) => s.kind !== 'sentiment');
  const recentReports = since(reports, 7, (s) => s.created_at, now);
  const top = hotspots(recentReports, locations)[0];
  if (top && top.count >= 3 && top.key) {
    out.push({
      id: 'hotspot',
      severity: 'warning',
      title: `${top.label} has ${top.count} reports this week`,
      detail: 'Several reports point to the same place. Schedule an inspection there.',
    });
  }

  const bullyingNow = since(reports, 7, (s) => s.created_at, now).filter((s) => s.sub_type === 'bullying').length;
  const bullyingBefore = between(reports, 14, 7, (s) => s.created_at, now).filter((s) => s.sub_type === 'bullying').length;
  if (bullyingNow >= 2 && bullyingNow >= bullyingBefore * 1.5 && bullyingNow > bullyingBefore) {
    out.push({
      id: 'bullying',
      severity: 'serious',
      title: `Bullying reports rose to ${bullyingNow} this week (from ${bullyingBefore})`,
      detail: 'Coordinate with Guidance on a targeted anti-bullying session.',
    });
  }

  if (role === 'guidance') {
    const thisWeek = sentimentSummary(since(submissions, 7, (s) => s.created_at, now));
    const lastWeek = sentimentSummary(between(submissions, 14, 7, (s) => s.created_at, now));
    if (thisWeek.needsFollowUp.length) {
      out.push({
        id: 'follow-up',
        severity: 'critical',
        title: thisWeek.needsFollowUp.length === 1 ? '1 wellbeing report needs a follow-up' : `${thisWeek.needsFollowUp.length} wellbeing reports need a follow-up`,
        detail: 'Reports of feeling hopeless or lonely, or stress at 5 of 5, that are not yet resolved.',
      });
    }
    if (thisWeek.total >= 5 && (thisWeek.negativeShare ?? 0) >= 0.5) {
      out.push({
        id: 'negative-share',
        severity: 'serious',
        title: `${Math.round((thisWeek.negativeShare ?? 0) * 100)}% of feelings shared this week are negative`,
        detail: 'Consider a class-wide wellbeing activity or a short counseling drop-in. Ask the DRRM Coordinator or School Admin to post a wellbeing notice.',
      });
    }
    if (thisWeek.avgStress !== null && lastWeek.avgStress !== null && thisWeek.avgStress - lastWeek.avgStress >= 0.5) {
      out.push({
        id: 'stress-rise',
        severity: 'warning',
        title: `Average stress rose from ${lastWeek.avgStress.toFixed(1)} to ${thisWeek.avgStress.toFixed(1)}`,
        detail: 'Check whether exams or deadlines are clustering this week.',
      });
    }
    const link = stressHeatLink(submissions, weather);
    if (link) out.push(link);
  }

  if (!out.length) {
    out.push({ id: 'all-clear', severity: 'good', title: 'No risks need action right now', detail: 'Weather, reports, and check-ins are within normal ranges.' });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// Compares average stress on hot days with cooler days. Reported as an
// observation only: a difference here is not evidence that heat causes stress.
function stressHeatLink(submissions: Submission[], weather: WeatherSnapshot | null): Insight | null {
  if (!weather) return null;
  const hotDays = new Set(weather.days.filter((d) => d.maxHeatIndex >= 33).map((d) => d.date));
  const hot: number[] = [];
  const cool: number[] = [];
  for (const s of submissions) {
    if (s.kind !== 'sentiment' || s.stress_level === null) continue;
    const day = localDay(new Date(s.created_at));
    if (!weather.days.some((d) => d.date === day)) continue;
    (hotDays.has(day) ? hot : cool).push(s.stress_level);
  }
  if (hot.length < 5 || cool.length < 5) return null;
  const h = mean(hot)!;
  const c = mean(cool)!;
  const diff = h - c;
  if (Math.abs(diff) < 0.3) {
    return { id: 'heat-link', severity: 'info', title: 'Stress looks about the same on hot and cooler days', detail: `Average ${h.toFixed(1)} on hot days vs ${c.toFixed(1)} on cooler days (last 14 days).` };
  }
  return {
    id: 'heat-link',
    severity: 'info',
    title: `Stress averages ${h.toFixed(1)} on hot days vs ${c.toFixed(1)} on cooler days`,
    detail: `Based on ${hot.length + cool.length} check-ins over 14 days. This shows a pattern, not a cause.`,
  };
}

export function formatHour(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric' });
}

export const ALERT_TEMPLATES: Record<AlertTemplate, { title: string; body: string; severity: 'info' | 'advisory' | 'urgent' }> = {
  heat: {
    title: 'Heat advisory: limit outdoor activities',
    body: 'High heat index expected today. Outdoor classes and PE move indoors from late morning to mid-afternoon. Bring water and take breaks in shaded or cool areas.',
    severity: 'advisory',
  },
  rain: {
    title: 'Heavy rain advisory',
    body: 'Heavy rain or thunderstorms are expected. Use covered walkways, avoid flooded areas, and wait for instructions before leaving campus.',
    severity: 'advisory',
  },
  wind: {
    title: 'Strong wind advisory',
    body: 'Strong wind gusts are expected. Stay away from trees, signage, and open areas. Outdoor activities are suspended until further notice.',
    severity: 'urgent',
  },
  quake: {
    title: 'Post-earthquake building check',
    body: 'An earthquake was recorded nearby. Facilities staff will inspect buildings. Report any cracks or damage using SENTINEL.',
    severity: 'advisory',
  },
  wellbeing: {
    title: 'Wellbeing drop-in this week',
    body: 'Guidance is holding open drop-in sessions this week. Everyone is welcome to talk about stress, worries, or anything on their mind.',
    severity: 'info',
  },
};
