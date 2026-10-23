import { useState, type CSSProperties, type ReactNode } from 'react';
import { labelFor } from '../lib/catalog';
import { setIncidentPriority, transitionIncident, type SchoolData } from '../lib/data';
import { placeLabel } from '../lib/layout';
import { OPEN_INCIDENT } from '../lib/analytics';
import { DEFAULT_PRIORITY, PRIORITY_FACTORS, PRIORITY_LEVELS, classifyPriority } from '../lib/priority';
import type { Incident } from '../lib/types';
import { INCIDENT_STATUS_LABEL } from './MyReportsPanel';

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Waiting for evaluation first, then the highest Priority Index, then oldest.
function evaluationOrder(a: Incident, b: Incident): number {
  const pending = (i: Incident) => Number(i.status === 'pending_evaluation');
  return pending(b) - pending(a) || (b.priority_index ?? 0) - (a.priority_index ?? 0) || a.created_at.localeCompare(b.created_at);
}

// Incident Evaluation and Priority: one open incident's details, the three
// scores, P = S + U + A, and the class it lands in. Saving goes through
// set_incident_priority, so the database recomputes the index itself.
export function IncidentEvaluation({ data, selectedId, onSelect, onChanged }: { data: SchoolData; selectedId: string | null; onSelect: (id: string) => void; onChanged: () => Promise<void> }) {
  const open = data.incidents.filter((i) => OPEN_INCIDENT.includes(i.status)).sort(evaluationOrder);
  const incident = data.incidents.find((i) => i.id === selectedId) ?? open[0];

  return (
    <section className="card evaluation" aria-labelledby="evaluation-title">
      <div className="card-head">
        <h2 id="evaluation-title" className="section-title">
          Incident Evaluation
        </h2>
        {open.length > 0 && (
          <label className="field evaluation-pick">
            <span className="sr-only">Incident to evaluate</span>
            <select className="role-select" value={incident?.id ?? ''} onChange={(e) => onSelect(e.target.value)}>
              {incident && !open.includes(incident) && <option value={incident.id}>{incident.case_ref} · {labelFor(incident.category)}</option>}
              {open.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.case_ref} · {labelFor(i.category)} · {INCIDENT_STATUS_LABEL[i.status]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {incident ? <Evaluation key={incident.id} incident={incident} data={data} onChanged={onChanged} /> : <p className="empty-note">No open incidents to evaluate.</p>}
    </section>
  );
}

function Evaluation({ incident, data, onChanged }: { incident: Incident; data: SchoolData; onChanged: () => Promise<void> }) {
  const fallback = DEFAULT_PRIORITY[incident.category] ?? DEFAULT_PRIORITY.other;
  const [scores, setScores] = useState({
    severity: incident.priority_severity ?? fallback.severity,
    urgency: incident.priority_urgency ?? fallback.urgency,
    affected: incident.priority_affected ?? fallback.affected,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const nameOf = (id: string | null | undefined) => (id ? data.people.find((p) => p.id === id)?.display_name : null) ?? null;
  const total = scores.severity + scores.urgency + scores.affected;
  const level = classifyPriority(total);
  const p = PRIORITY_LEVELS[level];
  const saved = incident.priority_index === total && incident.priority_severity === scores.severity && incident.priority_urgency === scores.urgency && incident.priority_affected === scores.affected;
  const pending = incident.status === 'pending_evaluation';

  async function save(validate: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    const r = await setIncidentPriority(incident.id, scores.severity, scores.urgency, scores.affected);
    const v = !r.error && validate ? await transitionIncident(incident.id, 'acknowledged', 'Validated during evaluation') : r;
    setBusy(false);
    if (r.error || v.error) {
      setError(r.error ?? v.error ?? '');
      return;
    }
    setMessage(validate ? 'Priority saved and incident validated.' : 'Priority saved.');
    await onChanged();
  }

  const details: [string, ReactNode][] = [
    ['Incident ID', incident.case_ref],
    ['Category', labelFor(incident.category)],
    ['Location', placeLabel(incident.location_id, data.locations)],
    ['Date & Time', formatDateTime(incident.created_at)],
    ['Reported By', nameOf(incident.created_by) ?? 'N/A'],
    ['Status', <span className={`chip status-${incident.status}`}>{INCIDENT_STATUS_LABEL[incident.status]}</span>],
    ['Assigned To', nameOf(incident.assigned_to) ?? 'Not assigned'],
    ['Acknowledged', incident.acknowledged_at ? formatDateTime(incident.acknowledged_at) : 'Not yet'],
  ];

  return (
    <div className="evaluation-body">
      <section className="eval-block">
        <h3>Incident Details</h3>
        <dl className="eval-details">
          {details.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="eval-block">
        <h3>Evaluation Scores</h3>
        <div className="eval-scores">
          {PRIORITY_FACTORS.map((f, n) => (
            <label key={f.key} className="field">
              <span>
                {f.label} ({'SUA'[n]})
              </span>
              <input
                type="number"
                min={1}
                max={4}
                step={1}
                value={scores[f.key]}
                onChange={(e) => {
                  const v = Math.min(4, Math.max(1, Math.round(Number(e.target.value) || 1)));
                  setScores((s) => ({ ...s, [f.key]: v }));
                }}
              />
              <small className="fine-print">
                {scores[f.key]} · {f.scale[scores[f.key] - 1]} (1 low, 4 critical)
              </small>
            </label>
          ))}
        </div>
      </section>

      <div className="eval-result">
        <section className="eval-calc">
          <h3>Priority Calculation</h3>
          <p>P = S + U + A</p>
          <p>
            P = {scores.severity} + {scores.urgency} + {scores.affected} = <strong>{total}</strong>
          </p>
          {incident.priority_basis && incident.priority_basis.length > 0 && (
            <div className="eval-basis">
              <h4>{incident.priority_set_by === null ? 'How the system read this report' : 'System reading before review'}</h4>
              <ul>
                {incident.priority_basis.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="eval-priority" style={{ '--priority': p.color } as CSSProperties} aria-live="polite">
          <h3>Assigned Priority</h3>
          <span className="eval-badge">{p.label}</span>
          <p>
            <strong>
              Score: {total} ({p.label})
            </strong>
          </p>
          <p>{p.action}</p>
          {(!saved || incident.priority_set_by === null) && <p className="fine-print">{saved ? 'Scored automatically from the report. Save to confirm.' : 'Not saved yet.'}</p>}
        </section>
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && <p className="notice">{message}</p>}
      <div className="chip-row">
        <button type="button" className="action-small primary" disabled={busy || (saved && incident.priority_set_by !== null)} onClick={() => save(false)}>
          {busy ? 'Saving…' : 'Save priority'}
        </button>
        {pending && (
          <button type="button" className="action-small" disabled={busy} onClick={() => save(true)}>
            Save and validate
          </button>
        )}
      </div>
    </div>
  );
}
