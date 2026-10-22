import { useState } from 'react';
import { CRISIS_EMOTIONS, iconFor, labelFor } from '../lib/catalog';
import { reviewSubmission, transitionIncident, type SchoolData } from '../lib/data';
import { locationName, OPEN_INCIDENT, since } from '../lib/analytics';
import type { Incident, IncidentStatus, Submission } from '../lib/types';
import type { Role } from '../roles';
import { StatusChip } from './Charts';

const NEXT_STEP: Partial<Record<IncidentStatus, { to: IncidentStatus; label: string }>> = {
  new: { to: 'acknowledged', label: 'Acknowledge' },
  acknowledged: { to: 'assigned', label: 'Take it' },
  assigned: { to: 'in_progress', label: 'Start' },
  in_progress: { to: 'resolved', label: 'Resolve' },
  resolved: { to: 'closed', label: 'Close' },
};

const RESPONDERS: Role[] = ['security', 'drrm', 'school_admin'];

export function QueuePanel({ role, data, onChanged }: { role: Role; data: SchoolData; onChanged: () => Promise<void> }) {
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

  const isResponder = RESPONDERS.includes(role);
  const help = since(data.checkIns, 1, (c) => c.checked_in_at).filter((c) => c.status === 'need_help');
  const activeIncidents = data.incidents.filter((i) => OPEN_INCIDENT.includes(i.status) || i.status === 'resolved');
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

      {isResponder && (
        <section>
          <h2 className="section-title">Help requests · last 24 hours</h2>
          {help.length === 0 ? (
            <p className="empty-note">No one has asked for help.</p>
          ) : (
            <ul className="queue-list">
              {help.map((c) => (
                <li key={c.id} className="queue-item urgent">
                  <span className="queue-icon" aria-hidden="true">🆘</span>
                  <div className="queue-main">
                    <strong>Help requested</strong>
                    <small>
                      {locationName(data.locations, c.location_id)} · {timeAgo(c.checked_in_at)}
                    </small>
                  </div>
                  <StatusChip severity="critical" />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isResponder && (
        <section>
          <h2 className="section-title">Incidents</h2>
          {activeIncidents.length === 0 ? (
            <p className="empty-note">No open incidents.</p>
          ) : (
            <ul className="queue-list">
              {activeIncidents.map((i) => (
                <IncidentRow key={i.id} incident={i} place={locationName(data.locations, i.location_id)} busy={busy === i.id} canCancel={role === 'school_admin'} onMove={(to, note) => run(i.id, () => transitionIncident(i.id, to, note))} />
              ))}
            </ul>
          )}
        </section>
      )}

      {role === 'guidance' && (
        <section>
          <h2 className="section-title">Wellbeing follow-ups</h2>
          {followUps.length === 0 ? (
            <p className="empty-note">No open wellbeing reports.</p>
          ) : (
            <ul className="queue-list">
              {followUps.map((s) => (
                <SubmissionRow key={s.id} submission={s} place={locationName(data.locations, s.location_id)} busy={busy === s.id} onReview={(to) => run(s.id, () => reviewSubmission(s.id, to))} />
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="section-title">Hazard and safety reports</h2>
        {reports.length === 0 ? (
          <p className="empty-note">No open reports.</p>
        ) : (
          <ul className="queue-list">
            {reports.map((s) => (
              <SubmissionRow key={s.id} submission={s} place={locationName(data.locations, s.location_id)} busy={busy === s.id} onReview={(to) => run(s.id, () => reviewSubmission(s.id, to))} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function IncidentRow({ incident, place, busy, canCancel, onMove }: { incident: Incident; place: string; busy: boolean; canCancel: boolean; onMove: (to: IncidentStatus, note?: string) => void }) {
  const next = NEXT_STEP[incident.status];
  return (
    <li className={`queue-item${incident.status === 'new' ? ' urgent' : ''}`}>
      <span className="queue-icon" aria-hidden="true">{iconFor(incident.category)}</span>
      <div className="queue-main">
        <strong>
          {incident.case_ref} · {labelFor(incident.category)}
        </strong>
        <small>
          {place} · {timeAgo(incident.created_at)}
        </small>
      </div>
      <span className={`chip status-${incident.status}`}>{incident.status.replace('_', ' ')}</span>
      <div className="queue-actions">
        {next && (
          <button type="button" className="action-small primary" disabled={busy} onClick={() => onMove(next.to, next.to === 'resolved' ? 'Resolved from queue' : undefined)}>
            {next.label}
          </button>
        )}
        {canCancel && OPEN_INCIDENT.includes(incident.status) && (
          <button type="button" className="action-small" disabled={busy} onClick={() => onMove('cancelled', 'Cancelled by School Admin')}>
            Cancel
          </button>
        )}
      </div>
    </li>
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
