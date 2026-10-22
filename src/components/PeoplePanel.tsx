import { useState } from 'react';
import { setUserRole, type SchoolData } from '../lib/data';
import type { Profile } from '../lib/types';
import { ROLE_ORDER, roleDetails, type Role } from '../roles';
import { timeAgo } from './QueuePanel';

export function PeoplePanel({ profile, data, onChanged }: { profile: Profile; data: SchoolData; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const assignable = ROLE_ORDER.filter((r) => r !== 'system_admin' || profile.role === 'system_admin');

  async function change(person: Profile, role: Role) {
    setBusy(person.id);
    setMessage('');
    const r = await setUserRole(person.id, role);
    if (!r.error) await onChanged();
    setBusy(null);
    setMessage(r.error ?? `${person.display_name ?? 'User'} is now ${roleDetails[role].label}.`);
  }

  const counts = ROLE_ORDER.map((r) => ({ role: r, n: data.people.filter((p) => p.role === r).length })).filter((c) => c.n);

  return (
    <div className="people">
      <section>
        <h2 className="section-title">People in your school</h2>
        <div className="chip-row">
          {counts.map((c) => (
            <span key={c.role} className="chip">
              {roleDetails[c.role].label}: {c.n}
            </span>
          ))}
        </div>
        {message && <p className="notice">{message}</p>}
        <ul className="queue-list">
          {data.people.map((p) => (
            <li key={p.id} className="queue-item">
              <span className="queue-icon" aria-hidden="true">{roleDetails[p.role].icon}</span>
              <div className="queue-main">
                <strong>{p.display_name ?? 'Unnamed account'}</strong>
                <small>{p.id === profile.id ? 'You' : roleDetails[p.role].label}</small>
              </div>
              {p.id !== profile.id && (p.role !== 'system_admin' || profile.role === 'system_admin') && (
                <select className="role-select" value={p.role} disabled={busy === p.id} aria-label={`Role for ${p.display_name ?? 'user'}`} onChange={(e) => change(p, e.target.value as Role)}>
                  {assignable.map((r) => (
                    <option key={r} value={r}>
                      {roleDetails[r].label}
                    </option>
                  ))}
                </select>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="section-title">Recent activity log</h2>
        {data.audit.length === 0 ? (
          <p className="empty-note">No logged activity.</p>
        ) : (
          <ul className="audit-list">
            {data.audit.map((a) => (
              <li key={a.id}>
                <span>{a.action.replace(/_/g, ' ')}</span>
                <small>
                  {a.entity_type} · {timeAgo(a.created_at)}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
