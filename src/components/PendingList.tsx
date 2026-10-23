export type PendingPerson = { id: string; name: string | null; detail: string };

// Sign-ups waiting for approval, with Approve and Decline on each row. Shared
// by the admin People tab and the Classroom Adviser's own-location view.
export function PendingList({ people, busy, onDecide }: { people: PendingPerson[]; busy: string | null; onDecide: (id: string, approve: boolean) => void }) {
  return (
    <ul className="queue-list">
      {people.map((p) => (
        <li key={p.id} className="queue-item">
          <span className="queue-icon" aria-hidden="true">
            👤
          </span>
          <div className="queue-main">
            <strong>{p.name ?? 'Unnamed account'}</strong>
            <small>{p.detail}</small>
          </div>
          <div className="queue-actions">
            <button type="button" className="action-small primary" disabled={busy === p.id} onClick={() => onDecide(p.id, true)}>
              Approve
            </button>
            <button type="button" className="text-button quiet-link" disabled={busy === p.id} onClick={() => onDecide(p.id, false)}>
              Decline
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
