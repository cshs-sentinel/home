import { useState, type CSSProperties, type ReactNode } from 'react';
import { CRISIS_EMOTIONS, TRIAGE_LABELS, iconFor, labelFor } from '../lib/catalog';
import { reviewSubmission, setIncidentPriority, transitionIncident, triageHelp, type SchoolData } from '../lib/data';
import { PRIORITY_FACTORS, PRIORITY_LEVELS, classifyPriority, type PriorityLevel } from '../lib/priority';
import { locationName, OPEN_INCIDENT, since } from '../lib/analytics';
import type { CheckIn, Incident, IncidentStatus, Submission } from '../lib/types';
import { StatusChip } from './Charts';
import { INCIDENT_STATUS_LABEL } from './MyReportsPanel';

const NEXT_STEP: Partial<Record<IncidentStatus, { to: IncidentStatus; label: string }>> = {
  pending_evaluation: { to: 'acknowledged', label: 'Validate' },
  new: { to: 'acknowledged', label: 'Acknowledge' },
  acknowledged: { to: 'assigned', label: 'Assign to me' },
  assigned: { to: 'in_progress', label: 'Start' },
  in_progress: { to: 'resolved', label: 'Resolve' },
  resolved: { to: 'closed', label: 'Close' },
};

export function QueuePanel({ data, onChanged }: { data: SchoolData; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function run(id: string, action: () => Promise<{ error: string | null }>) {
    setBusy(id);
    setError('');
    const r = await action();
    if (r.error) setError(r.error);
    else await onChanged();
    setBusy(null);
  }

  const help = since(data.checkIns, 1, (c) => c.checked_in_at)
    .filter((c) => c.status === 'need_help' && c.triage_status !== 'resolved')
    .sort((a, b) => Number(b.triage_status === 'urgent') - Number(a.triage_status === 'urgent') || b.checked_in_at.localeCompare(a.checked_in_at));
  const activeIncidents = data.incidents.filter((i) => OPEN_INCIDENT.includes(i.status) || i.status === 'resolved').sort(byPriority);
  const waiting = activeIncidents.filter((i) => i.status === 'pending_evaluation').length;
  const openSubmissions = data.submissions.filter((s) => s.status !== 'resolved');
  const followUps = openSubmissions.filter((s) => s.kind === 'sentiment').sort(urgencyFirst);
  const reports = openSubmissions.filter((s) => s.kind !== 'sentiment');

  return (
    <div className="queue">
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <QueueSection title="Help requests" note="last 24 hours" count={help.length}>
        {help.map((c) => (
          <HelpRow key={c.id} help={c} place={locationName(data.locations, c.location_id)} busy={busy === c.id} onTriage={(to) => run(c.id, () => triageHelp(c.id, to))} />
        ))}
      </QueueSection>

      <QueueSection title="Incidents" note={waiting > 0 ? `${waiting} waiting for evaluation` : undefined} count={activeIncidents.length}>
        {activeIncidents.map((i) => (
          <IncidentRow key={i.id} incident={i} place={locationName(data.locations, i.location_id)} busy={busy === i.id} onMove={(to, note) => run(i.id, () => transitionIncident(i.id, to, note))} onPriority={(sv, ug, af) => run(i.id, () => setIncidentPriority(i.id, sv, ug, af))} />
        ))}
      </QueueSection>

      <QueueSection title="Wellbeing follow-ups" count={followUps.length}>
        {followUps.map((s) => (
          <SubmissionRow key={s.id} submission={s} place={locationName(data.locations, s.location_id)} busy={busy === s.id} onReview={(to) => run(s.id, () => reviewSubmission(s.id, to))} />
        ))}
      </QueueSection>

      <QueueSection title="Concerns and suggestions" count={reports.length}>
        {reports.map((s) => (
          <SubmissionRow key={s.id} submission={s} place={locationName(data.locations, s.location_id)} busy={busy === s.id} onReview={(to) => run(s.id, () => reviewSubmission(s.id, to))} />
        ))}
      </QueueSection>
    </div>
  );
}

// A titled list with its count. An empty section shrinks to a single line.
function QueueSection({ title, note, count, children }: { title: string; note?: string; count: number; children: ReactNode }) {
  return (
    <section className={`card queue-section${count === 0 ? ' is-empty' : ''}`}>
      <div className="card-head">
        <h2 className="section-title">
          {title} <span className="count">{count}</span>
        </h2>
        {count === 0 ? <span className="muted">Nothing open</span> : note && <span className="muted">{note}</span>}
      </div>
      {count > 0 && <ul className="queue-list">{children}</ul>}
    </section>
  );
}

function IncidentRow({ incident, place, busy, onMove, onPriority }: { incident: Incident; place: string; busy: boolean; onMove: (to: IncidentStatus, note?: string) => void; onPriority: (severity: number, urgency: number, affected: number) => Promise<void> }) {
  const next = NEXT_STEP[incident.status];
  const [rating, setRating] = useState(false);
  return (
    <li className={`queue-item${incident.status === 'new' || incident.status === 'pending_evaluation' ? ' urgent' : ''}`}>
      <span className="queue-icon" aria-hidden="true">{iconFor(incident.category)}</span>
      <div className="queue-main">
        <strong>
          {incident.case_ref} · {labelFor(incident.category)}
        </strong>
        <small>
          {place} · {timeAgo(incident.created_at)}
        </small>
      </div>
      <PriorityChip level={incident.priority_level} index={incident.priority_index} auto={incident.priority_set_by === null} />
      <span className={`chip status-${incident.status}`}>{INCIDENT_STATUS_LABEL[incident.status]}</span>
      <div className="queue-actions">
        {next && (
          <button type="button" className="action-small primary" disabled={busy} onClick={() => onMove(next.to, next.to === 'resolved' ? 'Resolved from queue' : undefined)}>
            {next.label}
          </button>
        )}
        <button type="button" className="action-small" disabled={busy} aria-expanded={rating} onClick={() => setRating((r) => !r)}>
          {incident.priority_index === null ? 'Set priority' : 'Priority'}
        </button>
        {OPEN_INCIDENT.includes(incident.status) && (
          <button type="button" className="text-button quiet-link" disabled={busy} onClick={() => onMove('cancelled', incident.status === 'pending_evaluation' ? 'Dismissed after evaluation' : 'Cancelled by School Admin')}>
            {incident.status === 'pending_evaluation' ? 'Dismiss' : 'Cancel'}
          </button>
        )}
      </div>
      {rating && (
        <PriorityRater
          incident={incident}
          busy={busy}
          onCancel={() => setRating(false)}
          onSave={async (s, u, a) => {
            await onPriority(s, u, a);
            setRating(false);
          }}
        />
      )}
    </li>
  );
}

// `auto` marks the system default for the report's category: a responder has not
// confirmed or changed it yet.
export function PriorityChip({ level, index, auto = false }: { level: PriorityLevel | null; index: number | null; auto?: boolean }) {
  if (!level || index === null) return <span className="chip priority-chip is-unrated">Not rated</span>;
  const p = PRIORITY_LEVELS[level];
  return (
    <span className="chip priority-chip" style={{ '--priority': p.color } as CSSProperties} title={`Priority Index ${index} of 12 · ${p.label} (${p.range})${auto ? ' · system default for this category, not yet confirmed' : ''}`}>
      <span className="priority-dot" aria-hidden="true" />
      {p.label} · {index}
      {auto && <span className="priority-auto"> · default</span>}
    </span>
  );
}

function HelpRow({ help, place, busy, onTriage }: { help: CheckIn; place: string; busy: boolean; onTriage: (to: 'responding' | 'resolved') => void }) {
  const status = help.triage_status ?? 'awaiting_triage';
  return (
    <li className={`queue-item${status === 'urgent' ? ' urgent' : ''}`}>
      <span className="queue-icon" aria-hidden="true">{iconFor(help.help_type ?? 'emergency_help')}</span>
      <div className="queue-main">
        <strong>{labelFor(help.help_type ?? 'emergency_help')}</strong>
        <small>
          {place} · {timeAgo(help.checked_in_at)}
        </small>
      </div>
      <span className={`chip triage-${status}`}>{TRIAGE_LABELS[status]}</span>
      <div className="queue-actions">
        {status !== 'responding' && (
          <button type="button" className="action-small primary" disabled={busy} onClick={() => onTriage('responding')}>
            Respond
          </button>
        )}
        <button type="button" className="action-small" disabled={busy} onClick={() => onTriage('resolved')}>
          Resolve
        </button>
      </div>
    </li>
  );
}

function PriorityRater({ incident, busy, onSave, onCancel }: { incident: Incident; busy: boolean; onSave: (s: number, u: number, a: number) => Promise<void>; onCancel: () => void }) {
  const [values, setValues] = useState({
    severity: incident.priority_severity ?? 0,
    urgency: incident.priority_urgency ?? 0,
    affected: incident.priority_affected ?? 0,
  });
  const complete = values.severity > 0 && values.urgency > 0 && values.affected > 0;
  const total = values.severity + values.urgency + values.affected;
  const level = complete ? classifyPriority(total) : null;

  return (
    <div className="priority-rater">
      <p className="priority-formula">Priority Index = Severity + Urgency + Affected population</p>
      {PRIORITY_FACTORS.map((factor) => (
        <div key={factor.key} className="priority-factor" role="radiogroup" aria-label={factor.label}>
          <span className="control-label">{factor.label}</span>
          <div className="priority-scale">
            {factor.scale.map((label, i) => {
              const score = i + 1;
              const selected = values[factor.key] === score;
              return (
                <button
                  type="button"
                  key={score}
                  role="radio"
                  aria-checked={selected}
                  className={`priority-option${selected ? ' is-active' : ''}`}
                  onClick={() => setValues((v) => ({ ...v, [factor.key]: score }))}
                >
                  <strong>{score}</strong>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="priority-result" aria-live="polite">
        {complete ? (
          <>
            Total {total} of 12 · <PriorityChip level={level} index={total} />
          </>
        ) : (
          'Choose a score for each factor.'
        )}
      </div>
      <div className="chip-row">
        <button type="button" className="action-small primary" disabled={!complete || busy} onClick={() => onSave(values.severity, values.urgency, values.affected)}>
          {busy ? 'Saving…' : 'Save priority'}
        </button>
        <button type="button" className="action-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SubmissionRow({ submission, place, busy, onReview }: { submission: Submission; place: string; busy: boolean; onReview: (to: 'acknowledged' | 'resolved') => void }) {
  const urgent = submission.kind === 'sentiment' && isUrgent(submission);
  return (
    <li className={`queue-item${urgent ? ' urgent' : ''}`}>
      <span className="queue-icon" aria-hidden="true">{iconFor(submission.sub_type)}</span>
      <div className="queue-main">
        <strong>
          {labelFor(submission.sub_type)}
          {submission.stress_level !== null && ` · stress ${submission.stress_level}/5`}
        </strong>
        <small>
          {place} · {timeAgo(submission.created_at)}
        </small>
      </div>
      {urgent && <StatusChip severity="critical" label="Follow up" />}
      <div className="queue-actions">
        {submission.status === 'new' && (
          <button type="button" className="action-small primary" disabled={busy} onClick={() => onReview('acknowledged')}>
            Acknowledge
          </button>
        )}
        {submission.status === 'acknowledged' && (
          <button type="button" className="action-small primary" disabled={busy} onClick={() => onReview('resolved')}>
            Resolve
          </button>
        )}
      </div>
    </li>
  );
}

// Highest Priority Index first. Unrated incidents sit just below High so they
// get noticed and rated without burying anything High or Critical; ties go to
// whichever has waited longest.
function byPriority(a: Incident, b: Incident): number {
  const rank = (i: Incident) => i.priority_index ?? 8.5;
  return rank(b) - rank(a) || a.created_at.localeCompare(b.created_at);
}

function isUrgent(s: Submission): boolean {
  return CRISIS_EMOTIONS.has(s.sub_type) || (s.stress_level ?? 0) >= 5;
}

function urgencyFirst(a: Submission, b: Submission): number {
  return Number(isUrgent(b)) - Number(isUrgent(a)) || b.created_at.localeCompare(a.created_at);
}

export function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
