import { useEffect, useState } from 'react';
import { approveRegistration, fetchPendingInMyLocation, rejectRegistration, type PendingNearby } from '../lib/data';
import { PendingList } from './PendingList';
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

  async function decide(id: string, approve: boolean) {
    const person = pending.find((p) => p.id === id);
    setBusy(id);
    setMessage('');
    const r = approve ? await approveRegistration(id) : await rejectRegistration(id);
    if (!r.error) await load();
    setBusy(null);
    const name = person?.display_name ?? 'This account';
    setMessage(r.error ?? (approve ? `${name} is approved.` : `${name} was declined.`));
  }

  return (
    <div className="people">
      <section className="card">
        <h2 className="section-title">Waiting for approval</h2>
        <p className="fine-print">Sign-ups at your default place. Change your place in My Reports.</p>
        {error && <p className="error-text">{error}</p>}
        {message && <p className="notice">{message}</p>}
        {loading ? (
          <p className="empty-note">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="empty-note">Nobody is waiting right now.</p>
        ) : (
          <PendingList people={pending.map((p) => ({ id: p.id, name: p.display_name, detail: `${p.designation ?? 'No position'} · ${timeAgo(p.created_at)}` }))} busy={busy} onDecide={decide} />
        )}
      </section>
    </div>
  );
}
