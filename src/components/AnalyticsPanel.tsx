import { useMemo } from 'react';
import {
  countBy,
  dailyAverage,
  dailyCount,
  generateInsights,
  hotspots,
  incidentSummary,
  sentimentSummary,
  since,
  type AlertTemplate,
  type Insight,
} from '../lib/analytics';
import type { SchoolData } from '../lib/data';
import type { Quake, WeatherSnapshot } from '../lib/weather';
import type { Role } from '../roles';
import { BarList, ChartCard, ColumnChart, LineChart, StatTile, StatusChip } from './Charts';
import { WeatherPanel, shortDay } from './WeatherPanel';

export const RANGES = [7, 14, 30] as const;
export type Range = (typeof RANGES)[number];

export function RangeFilter({ days, onDays }: { days: Range; onDays: (d: Range) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <button type="button" key={r} className={`filter-button${days === r ? ' is-active' : ''}`} aria-pressed={days === r} onClick={() => onDays(r)}>
          {r} days
        </button>
      ))}
    </div>
  );
}

type Props = {
  role: Role;
  days: Range;
  onDays: (d: Range) => void;
  data: SchoolData;
  weather: WeatherSnapshot | null;
  quakes: Quake[];
  weatherError: string;
  onDraftAlert: (template: AlertTemplate) => void;
};

export function AnalyticsPanel({ role, days, onDays, data, weather, quakes, weatherError, onDraftAlert }: Props) {
  const insights = useMemo(
    () => generateInsights({ role, weather, quakes, submissions: data.submissions, incidents: data.incidents, checkIns: data.checkIns, locations: data.placeNames }),
    [role, weather, quakes, data],
  );

  const submissions = since(data.submissions, days, (s) => s.created_at);
  const reports = submissions.filter((s) => s.kind !== 'sentiment');
  const sentiments = submissions.filter((s) => s.kind === 'sentiment');
  const incidents = since(data.incidents, days, (i) => i.created_at);

  return (
    <div className="insights">
      <RangeFilter days={days} onDays={onDays} />

      <section className="insight-list" aria-label="What needs attention">
        <h2 className="section-title">What needs attention</h2>
        {insights.map((insight) => (
          <InsightCard key={insight.id} insight={insight} onDraftAlert={onDraftAlert} />
        ))}
      </section>

      <WeatherPanel weather={weather} quakes={quakes} error={weatherError} />

      <OperationsView reports={reports} incidents={incidents} days={days} data={data} />
      <h2 className="section-title">Wellbeing</h2>
      <WellbeingView sentiments={sentiments} days={days} data={data} />
    </div>
  );
}

function InsightCard({ insight, onDraftAlert }: { insight: Insight; onDraftAlert: (t: AlertTemplate) => void }) {
  return (
    <article className={`insight-card sev-${insight.severity}`}>
      <StatusChip severity={insight.severity} />
      <div>
        <h3>{insight.title}</h3>
        <p>{insight.detail}</p>
      </div>
      {insight.draftAlert && (
        <button type="button" className="secondary" onClick={() => onDraftAlert(insight.draftAlert!)}>
          Draft alert
        </button>
      )}
    </article>
  );
}

function WellbeingView({ sentiments, days, data }: { sentiments: SchoolData['submissions']; days: number; data: SchoolData }) {
  const summary = sentimentSummary(sentiments);
  const stressDaily = dailyAverage(sentiments, days, (s) => s.created_at, (s) => s.stress_level);
  const moods = countBy(sentiments, (s) => s.sub_type);
  const places = hotspots(sentiments, data.locations);

  return (
    <>
      <div className="kpi-row">
        <StatTile label="Feelings shared" value={String(summary.total)} sub={`last ${days} days`} />
        <StatTile label="Average stress" value={summary.avgStress === null ? '—' : `${summary.avgStress.toFixed(1)} / 5`} severity={summary.avgStress === null ? undefined : summary.avgStress >= 3.5 ? 'serious' : summary.avgStress >= 2.5 ? 'warning' : 'good'} />
        <StatTile label="Negative feelings" value={summary.negativeShare === null ? '—' : `${Math.round(summary.negativeShare * 100)}%`} />
        <StatTile label="Need follow-up" value={String(summary.needsFollowUp.length)} severity={summary.needsFollowUp.length ? 'critical' : 'good'} sub="hopeless, lonely, or stress 5" />
      </div>
      <div className="chart-grid">
        <ChartCard title="Average stress by day" subtitle="1 = very low, 5 = very high. Gaps are days with no check-ins." table={{ columns: ['Day', 'Average stress', 'Check-ins'], rows: stressDaily.map((d) => [d.date, d.value === null ? '—' : d.value.toFixed(2), d.n]) }}>
          <LineChart data={stressDaily.map((d) => ({ label: shortDay(d.date), value: d.value, detail: `${shortDay(d.date)} · ${d.n} check-in${d.n === 1 ? '' : 's'}` }))} yMin={1} yMax={5} />
        </ChartCard>
        <ChartCard title="How people feel" subtitle="Feelings shared in this period" table={{ columns: ['Feeling', 'Count'], rows: moods.map((m) => [m.label, m.count]) }}>
          <BarList data={moods} />
        </ChartCard>
        <ChartCard title="Where feelings were shared" subtitle="Places with the most check-ins" table={{ columns: ['Place', 'Count'], rows: places.map((p) => [p.label, p.count]) }}>
          <BarList data={places.slice(0, 8)} />
        </ChartCard>
      </div>
    </>
  );
}

function OperationsView({ reports, incidents, days, data }: { reports: SchoolData['submissions']; incidents: SchoolData['incidents']; days: number; data: SchoolData }) {
  const summary = incidentSummary(data.incidents);
  const helpToday = since(data.checkIns, 1, (c) => c.checked_in_at).filter((c) => c.status === 'need_help').length;
  const openHazards = data.submissions.filter((s) => s.kind === 'incident_hazard' && s.status !== 'resolved').length;
  const byCategory = countBy(incidents, (i) => i.category);
  const byType = countBy(reports, (s) => s.sub_type);
  const places = hotspots([...reports, ...incidents], data.locations);
  const daily = dailyCount([...reports.map((r) => r.created_at), ...incidents.map((i) => i.created_at)], days, (d) => d);
  const wellbeingOpen = data.counts?.submissions_sentiment_open;

  return (
    <>
      <div className="kpi-row">
        <StatTile label="Open incidents" value={String(summary.open)} severity={summary.open ? 'warning' : 'good'} />
        <StatTile label="Not acknowledged" value={String(summary.unacknowledged)} severity={summary.overdue.length ? 'critical' : summary.unacknowledged ? 'warning' : 'good'} />
        <StatTile label="Time to acknowledge" value={summary.medianAckMinutes === null ? '—' : `${Math.round(summary.medianAckMinutes)} min`} sub="median" />
        <StatTile label="Help requests" value={String(helpToday)} severity={helpToday ? 'critical' : 'good'} sub="last 24 hours" />
        <StatTile label="Open hazards" value={String(openHazards)} severity={openHazards ? 'warning' : 'good'} />
        <StatTile label="Open wellbeing reports" value={String(wellbeingOpen)} severity={wellbeingOpen ? 'warning' : 'good'} />
      </div>
      <div className="chart-grid">
        <ChartCard title="Reports and incidents per day" table={{ columns: ['Day', 'Count'], rows: daily.map((d) => [d.date, d.n]) }}>
          <ColumnChart data={daily.map((d) => ({ label: shortDay(d.date), value: d.n }))} />
        </ChartCard>
        <ChartCard title="Incidents by category" table={{ columns: ['Category', 'Count'], rows: byCategory.map((c) => [c.label, c.count]) }}>
          <BarList data={byCategory} empty="No incidents in this period." />
        </ChartCard>
        <ChartCard title="Reports by type" subtitle="Hazards and observations" table={{ columns: ['Type', 'Count'], rows: byType.map((c) => [c.label, c.count]) }}>
          <BarList data={byType} />
        </ChartCard>
        <ChartCard title="Hotspots" subtitle="Reports and incidents by place" table={{ columns: ['Place', 'Count'], rows: places.map((p) => [p.label, p.count]) }}>
          <BarList data={places.slice(0, 8)} />
        </ChartCard>
      </div>
    </>
  );
}
