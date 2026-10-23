import { useMemo, useState } from 'react';
import { countBy, dailyAverage, dailyCount, generateInsights, incidentSummary, sentimentSummary, since, type AlertTemplate, type Insight } from '../lib/analytics';
import type { SchoolData } from '../lib/data';
import type { Quake, WeatherSnapshot } from '../lib/weather';
import type { Role } from '../roles';
import { BarList, ChartCard, ColumnChart, LineChart, StatTile, StatusChip } from './Charts';
import { shortDay } from './WeatherPanel';

export const RANGES = [7, 14, 30] as const;
export type Range = (typeof RANGES)[number];

export function RangeFilter({ days, onDays }: { days: Range; onDays: (d: Range) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <button type="button" key={r} className={`filter-button${days === r ? ' is-active' : ''}`} aria-pressed={days === r} onClick={() => onDays(r)}>
          {r}d
        </button>
      ))}
    </div>
  );
}

type View = 'operations' | 'wellbeing';

type Props = {
  role: Role;
  days: Range;
  data: SchoolData;
  weather: WeatherSnapshot | null;
  quakes: Quake[];
  onDraftAlert: (template: AlertTemplate) => void;
};

// What needs attention first, then one view at a time: operations (incidents,
// help, reports) or wellbeing (feelings). The period is chosen in the top bar,
// and the map covers "where".
export function AnalyticsPanel({ role, days, data, weather, quakes, onDraftAlert }: Props) {
  const [view, setView] = useState<View>('operations');
  const [showTables, setShowTables] = useState(false);
  const insights = useMemo(
    () => generateInsights({ role, weather, quakes, submissions: data.submissions, incidents: data.incidents, checkIns: data.checkIns, locations: data.placeNames }),
    [role, weather, quakes, data],
  );

  const submissions = since(data.submissions, days, (s) => s.created_at);
  const reports = submissions.filter((s) => s.kind !== 'sentiment');
  const sentiments = submissions.filter((s) => s.kind === 'sentiment');
  const incidents = since(data.incidents, days, (i) => i.created_at).filter((i) => i.status !== 'cancelled');

  return (
    <div className="insights">
      {insights.length > 0 && (
        <section className="card insight-list" aria-label="What needs attention">
          <h2 className="section-title">What needs attention</h2>
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} onDraftAlert={onDraftAlert} />
          ))}
        </section>
      )}

      <div className="panel-toolbar">
        <div className="segmented" role="group" aria-label="Analytics view">
          <button type="button" className={`filter-button${view === 'operations' ? ' is-active' : ''}`} aria-pressed={view === 'operations'} onClick={() => setView('operations')}>
            Operations
          </button>
          <button type="button" className={`filter-button${view === 'wellbeing' ? ' is-active' : ''}`} aria-pressed={view === 'wellbeing'} onClick={() => setView('wellbeing')}>
            Wellbeing
          </button>
        </div>
        <label className="check-row">
          <input type="checkbox" checked={showTables} onChange={(e) => setShowTables(e.target.checked)} /> Show data tables
        </label>
      </div>

      {view === 'operations' ? (
        <OperationsView reports={reports} incidents={incidents} days={days} data={data} showTables={showTables} />
      ) : (
        <WellbeingView sentiments={sentiments} days={days} showTables={showTables} />
      )}
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
        <button type="button" className="action-small" onClick={() => onDraftAlert(insight.draftAlert!)}>
          Draft alert
        </button>
      )}
    </article>
  );
}

function WellbeingView({ sentiments, days, showTables }: { sentiments: SchoolData['submissions']; days: number; showTables: boolean }) {
  const summary = sentimentSummary(sentiments);
  const stressDaily = dailyAverage(sentiments, days, (s) => s.created_at, (s) => s.stress_level);
  const moods = countBy(sentiments, (s) => s.sub_type);

  return (
    <>
      <div className="kpi-row">
        <StatTile label="Feelings shared" value={String(summary.total)} sub={`last ${days} days`} />
        <StatTile label="Average stress" value={summary.avgStress === null ? '—' : `${summary.avgStress.toFixed(1)} / 5`} severity={summary.avgStress === null ? undefined : summary.avgStress >= 3.5 ? 'serious' : summary.avgStress >= 2.5 ? 'warning' : 'good'} />
        <StatTile label="Negative feelings" value={summary.negativeShare === null ? '—' : `${Math.round(summary.negativeShare * 100)}%`} />
        <StatTile label="Need follow-up" value={String(summary.needsFollowUp.length)} severity={summary.needsFollowUp.length ? 'critical' : 'good'} />
      </div>
      <div className="chart-grid">
        <ChartCard title="Average stress by day" subtitle="1 very low · 5 very high" showTable={showTables} table={{ columns: ['Day', 'Average stress', 'Feelings'], rows: stressDaily.map((d) => [d.date, d.value === null ? '—' : d.value.toFixed(2), d.n]) }}>
          <LineChart data={stressDaily.map((d) => ({ label: shortDay(d.date), value: d.value, detail: `${shortDay(d.date)} · ${d.n} feeling${d.n === 1 ? '' : 's'}` }))} yMin={1} yMax={5} />
        </ChartCard>
        <ChartCard title="How people feel" showTable={showTables} table={{ columns: ['Feeling', 'Count'], rows: moods.map((m) => [m.label, m.count]) }}>
          <BarList data={moods} />
        </ChartCard>
      </div>
    </>
  );
}

function OperationsView({ reports, incidents, days, data, showTables }: { reports: SchoolData['submissions']; incidents: SchoolData['incidents']; days: number; data: SchoolData; showTables: boolean }) {
  const summary = incidentSummary(data.incidents);
  const helpToday = since(data.checkIns, 1, (c) => c.checked_in_at).filter((c) => c.status === 'need_help' && c.triage_status !== 'resolved').length;
  const byCategory = countBy(incidents, (i) => i.category);
  const byType = countBy(reports, (s) => s.sub_type);
  const daily = dailyCount([...reports.map((r) => r.created_at), ...incidents.map((i) => i.created_at)], days, (d) => d);

  return (
    <>
      <div className="kpi-row">
        <StatTile label="Open incidents" value={String(summary.open)} severity={summary.open ? 'warning' : 'good'} />
        <StatTile label="Waiting for review" value={String(summary.unacknowledged)} severity={summary.overdue.length ? 'critical' : summary.unacknowledged ? 'warning' : 'good'} />
        <StatTile label="Median response time" value={summary.medianAckMinutes === null ? '—' : `${Math.round(summary.medianAckMinutes)} min`} />
        <StatTile label="Open help requests" value={String(helpToday)} severity={helpToday ? 'critical' : 'good'} sub="last 24 hours" />
      </div>
      <div className="chart-grid">
        <ChartCard title="Reports and incidents per day" showTable={showTables} table={{ columns: ['Day', 'Count'], rows: daily.map((d) => [d.date, d.n]) }}>
          <ColumnChart data={daily.map((d) => ({ label: shortDay(d.date), value: d.n }))} />
        </ChartCard>
        <ChartCard title="Incidents by category" showTable={showTables} table={{ columns: ['Category', 'Count'], rows: byCategory.map((c) => [c.label, c.count]) }}>
          <BarList data={byCategory} empty="No incidents in this period." />
        </ChartCard>
        <ChartCard title="Concerns and suggestions" showTable={showTables} table={{ columns: ['Type', 'Count'], rows: byType.map((c) => [c.label, c.count]) }}>
          <BarList data={byType} empty="None in this period." />
        </ChartCard>
      </div>
    </>
  );
}
