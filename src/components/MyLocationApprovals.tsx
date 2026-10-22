import { useEffect, useState } from 'react';
import { approveRegistration, fetchPendingInMyLocation, rejectRegistration, type PendingNearby } from '../lib/data';
import { timeAgo } from './QueuePanel';

// What a Classroom Adviser sees on the People tab: only the Community
// Members waiting to be approved at their own default location — nothing
// else a School Admin or System Admin can do (no roster, no positions, no
// activity log, no Add Person).
export function MyLocationApprovals() {
  const [pending, setPending] = useState<PendingNearby[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    const r = await fetchPendingInMyLocation();
    setPending(r.data);
    setError(r.error ?? '');
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(person: PendingNearby, approve: boolean) {
    setBusy(person.id);
    setMessage('');
    const r = approve ? await approveRegistration(person.id) : await rejectRegistration(person.id);
    if (!r.error) await load();
    setBusy(null);
    setMessage(r.error ?? (approve ? `${person.display_name ?? 'This account'} is approved.` : `${person.display_name ?? 'This account'} was declined.`));
  }

  return (
    <div className="people">
      <section>
        <h2 className="section-title">Waiting for approval at your location</h2>
        <p className="fine-print">
          As a Classroom Adviser you approve Community Member sign-ups only for your own default location. Change it from Report ›
          My default location if it isn't right.
        </p>
        {error && <p className="error-text">{error}</p>}
        {message && <p className="notice">{message}</p>}
        {loading ? (
          <p className="empty-note">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="empty-note">Nobody is waiting right now.</p>
        ) : (
          <ul className="queue-list">
            {pending.map((p) => (
              <li key={p.id} className="queue-item">
                <span className="queue-icon" aria-hidden="true">◉</span>
                <div className="queue-main">
                  <strong>{p.display_name ?? 'Unnamed account'}</strong>
                  <small>{p.designation ?? 'No position'} · {timeAgo(p.created_at)}</small>
                </div>
                <div className="queue-actions">
                  <button type="button" className="action-small primary" disabled={busy === p.id} onClick={() => decide(p, true)}>
                    Approve
                  </button>
                  <button type="button" className="action-small" disabled={busy === p.id} onClick={() => decide(p, false)}>
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
