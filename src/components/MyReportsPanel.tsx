import { useState } from 'react';
import { TRIAGE_LABELS, iconFor, labelFor } from '../lib/catalog';
import { transitionIncident } from '../lib/data';
import { placeLabel } from '../lib/layout';
import type { CheckIn, Incident, IncidentStatus, Location, Profile } from '../lib/types';
import { DefaultLocationCard } from './DefaultLocationCard';
import { timeAgo } from './QueuePanel';

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  pending_evaluation: 'Pending evaluation',
  new: 'Received',
  acknowledged: 'Acknowledged',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

// My Reports: what this person has sent and where each one stands, plus the
// default location that reports start from. Community Members only ever receive
// their own rows (row-level security), so nothing here filters by hand for safety.
export function MyReportsPanel({ profile, locations, incidents, checkIns, onChanged, onProfileChanged }: { profile: Profile; locations: Location[]; incidents: Incident[]; checkIns: CheckIn[]; onChanged: () => void; onProfileChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const mine = incidents.filter((i) => i.created_by === profile.id);
  const help = checkIns.filter((c) => c.profile_id === profile.id && c.status === 'need_help');
  const safe = checkIns.filter((c) => c.profile_id === profile.id && c.status === 'safe').slice(0, 3);

  async function cancel(i: Incident) {
    setBusy(i.id);
    setError('');
    const r = await transitionIncident(i.id, 'cancelled', 'Cancelled by reporter');
    if (r.error) setError(r.error);
    else onChanged();
    setBusy(null);
  }

  // One list, newest first: incident reports, help requests, and safe check-ins.
  const rows = [
    ...mine.map((i) => ({ when: i.created_at, node: (
      <li key={i.id}>
        <span aria-hidden="true">{iconFor(i.category)}</span>
        <span className="activity-main">
          <strong>{labelFor(i.category)}</strong>
          <small>
            {i.case_ref} · {placeLabel(i.location_id, locations)} · {timeAgo(i.created_at)}
          </small>
        </span>
        <span className={`chip status-${i.status}`}>{INCIDENT_STATUS_LABEL[i.status]}</span>
        {(i.status === 'pending_evaluation' || i.status === 'new') && (
          <button type="button" className="text-button" disabled={busy === i.id} onClick={() => cancel(i)}>
            Cancel
          </button>
        )}
      </li>
    ) })),
    ...help.map((c) => ({ when: c.checked_in_at, node: (
      <li key={c.id}>
        <span aria-hidden="true">{iconFor(c.help_type ?? 'emergency_help')}</span>
        <span className="activity-main">
          <strong>{labelFor(c.help_type ?? 'emergency_help')}</strong>
          <small>
            {placeLabel(c.location_id, locations)} · {timeAgo(c.checked_in_at)}
          </small>
        </span>
        <span className={`chip triage-${c.triage_status ?? 'awaiting_triage'}`}>{TRIAGE_LABELS[c.triage_status ?? 'awaiting_triage']}</span>
      </li>
    ) })),
    ...safe.map((c) => ({ when: c.checked_in_at, node: (
      <li key={c.id}>
        <span aria-hidden="true">✅</span>
        <span className="activity-main">
          <strong>Checked in safe</strong>
          <small>{timeAgo(c.checked_in_at)}</small>
        </span>
      </li>
    ) })),
  ].sort((a, b) => b.when.localeCompare(a.when));

  return (
    <div className="my-reports">
      <section className="card">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {rows.length === 0 ? <p className="empty-note">Nothing sent yet.</p> : <ul className="activity-list">{rows.map((r) => r.node)}</ul>}
      </section>
      <DefaultLocationCard profile={profile} locations={locations} onChanged={onProfileChanged} />
    </div>
  );
}
