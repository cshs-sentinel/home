import { useState } from 'react';
import { setUserType, type SchoolData } from '../lib/data';
import type { Profile, UserType } from '../lib/types';
import { roleDetails } from '../roles';
import { timeAgo } from './QueuePanel';

export function PeoplePanel({ profile, data, onChanged }: { profile: Profile; data: SchoolData; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const isSystemAdmin = profile.role === 'system_admin';
  const typeById = new Map(data.userTypes.map((t) => [t.id, t]));
  const assignable = data.userTypes
    .filter((t) => t.is_active && (t.base_role !== 'system_admin' || isSystemAdmin))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function change(person: Profile, type: UserType) {
    setBusy(person.id);
    setMessage('');
    const r = await setUserType(person.id, type.id);
    if (!r.error) await onChanged();
    setBusy(null);
    setMessage(r.error ?? `${person.display_name ?? 'User'} is now ${type.name}.`);
  }

  // Deactivated accounts (for example retired demo logins) are kept for the activity log but not listed.
  const people = data.people.filter((p) => p.is_active !== false);
  const counts = data.userTypes
    .map((t) => ({ type: t, n: people.filter((p) => p.user_type_id === t.id).length }))
    .filter((c) => c.n > 0);

  return (
    <div className="people">
      <section>
        <h2 className="section-title">People in your school</h2>
        <div className="chip-row">
          {counts.map((c) => (
            <span key={c.type.id} className="chip">
              {c.type.name}: {c.n}
            </span>
          ))}
        </div>
        {message && <p className="notice">{message}</p>}
        <ul className="queue-list">
          {people.map((p) => {
            const type = p.user_type_id ? typeById.get(p.user_type_id) : undefined;
            const locked = p.id === profile.id || (p.role === 'system_admin' && !isSystemAdmin);
            return (
              <li key={p.id} className="queue-item">
                <span className="queue-icon" aria-hidden="true">{roleDetails[p.role].icon}</span>
                <div className="queue-main">
                  <strong>{p.display_name ?? 'Unnamed account'}</strong>
                  <small>
                    {p.id === profile.id ? 'You · ' : ''}
                    {type?.name ?? 'No position'} · {roleDetails[p.role].label}
                  </small>
                </div>
                {!locked && (
                  <select
                    className="role-select"
                    value={p.user_type_id ?? ''}
                    disabled={busy === p.id}
                    aria-label={`Position for ${p.display_name ?? 'user'}`}
                    onChange={(e) => {
                      const next = typeById.get(e.target.value);
                      if (next) change(p, next);
                    }}
                  >
                    {!type && <option value="">Choose a position</option>}
                    {type && !assignable.includes(type) && <option value={type.id}>{type.name}</option>}
                    {assignable.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {roleDetails[t.base_role].label}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
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
                <span>
                  {a.action.replace(/_/g, ' ')} · {a.entity_type.replace(/_/g, ' ')}
                </span>
                <small>{timeAgo(a.created_at)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
