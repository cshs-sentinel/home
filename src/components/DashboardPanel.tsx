import { countBy, since } from '../lib/analytics';
import { iconFor, labelFor } from '../lib/catalog';
import type { SchoolData } from '../lib/data';
import { placeLabel } from '../lib/layout';
import { BarList, ChartCard } from './Charts';
import { formatDateTime } from './IncidentEvaluation';
import { INCIDENT_STATUS_LABEL } from './MyReportsPanel';
import { PriorityChip } from './QueuePanel';
import type { Range } from './AnalyticsPanel';

const RECENT = 20;

// The School Admin's overview of what students and the community reported:
// incidents by category and the most recent incidents. Reports filed by School
// Admins or System Admins are left out. Tapping an ID opens its evaluation.
export function DashboardPanel({ days, data, onEvaluate }: { days: Range; data: SchoolData; onEvaluate: (id: string) => void }) {
  const staff = new Set(data.people.filter((p) => p.role !== 'community').map((p) => p.id));
  const reported = since(data.incidents, days, (i) => i.created_at).filter((i) => i.status !== 'cancelled' && !staff.has(i.created_by));
  const byCategory = countBy(reported, (i) => i.category);
  const recent = [...reported].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, RECENT);

  return (
    <div className="dashboard">
      <ChartCard title="Incidents by category" subtitle={`Reported by students and the community, last ${days} days`}>
        <BarList data={byCategory} empty="No incidents in this period." />
      </ChartCard>

      <section className="card">
        <div className="card-head">
          <h2 className="section-title">Recent incidents</h2>
          {reported.length > RECENT && <span className="muted">Latest {RECENT} of {reported.length}</span>}
        </div>
        {recent.length === 0 ? (
          <p className="empty-note">No incidents reported in this period.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Category</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Location</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date &amp; Time</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <button type="button" className="text-button" title="Open in Incident Evaluation" onClick={() => onEvaluate(i.id)}>
                        {i.case_ref}
                      </button>
                    </td>
                    <td>
                      <span aria-hidden="true">{iconFor(i.category)}</span> {labelFor(i.category)}
                    </td>
                    <td>
                      <PriorityChip level={i.priority_level} index={i.priority_index} auto={i.priority_set_by === null} />
                    </td>
                    <td>{placeLabel(i.location_id, data.locations)}</td>
                    <td>
                      <span className={`chip status-${i.status}`}>{INCIDENT_STATUS_LABEL[i.status]}</span>
                    </td>
                    <td className="nowrap">{formatDateTime(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
