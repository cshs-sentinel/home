import { useState } from 'react';
import { addPerson, approveRegistration, rejectRegistration, setUserType, type SchoolData } from '../lib/data';
import type { Profile, UserType } from '../lib/types';
import { roleDetails } from '../roles';
import { timeAgo } from './QueuePanel';

export function PeoplePanel({ profile, data, onChanged }: { profile: Profile; data: SchoolData; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const isSystemAdmin = profile.role === 'system_admin';
  const typeById = new Map(data.userTypes.map((t) => [t.id, t]));
  // A School Admin may only assign Community Member positions. Only a
  // System Admin can hand out (or take away) a School Admin or System Admin
  // position — those accounts are never created through public sign-up.
  const assignable = data.userTypes
    .filter((t) => t.is_active && (t.base_role === 'community' || isSystemAdmin))
    .sort((a, b) => a.name.localeCompare(b.name));

  async function change(person: Profile, type: UserType) {
    setBusy(person.id);
    setMessage('');
    const r = await setUserType(person.id, type.id);
    if (!r.error) await onChanged();
    setBusy(null);
    setMessage(r.error ?? `${person.display_name ?? 'User'} is now ${type.name}.`);
  }

  async function decide(person: Profile, approve: boolean) {
    setBusy(person.id);
    setMessage('');
    const r = approve ? await approveRegistration(person.id) : await rejectRegistration(person.id);
    if (!r.error) await onChanged();
    setBusy(null);
    setMessage(r.error ?? (approve ? `${person.display_name ?? 'This account'} is approved.` : `${person.display_name ?? 'This account'} was declined.`));
  }

  const active = data.people.filter((p) => p.is_active !== false);
  // Self-registered Community Members wait here until a School Admin or
  // System Admin approves them; admin-added people skip this entirely.
  const pending = active.filter((p) => p.status === 'pending');
  const people = active.filter((p) => p.status !== 'pending');
  const counts = data.userTypes
    .map((t) => ({ type: t, n: people.filter((p) => p.user_type_id === t.id).length }))
    .filter((c) => c.n > 0);

  return (
    <div className="people">
      <AddPersonForm assignable={assignable} isSystemAdmin={isSystemAdmin} onAdded={onChanged} />

      {pending.length > 0 && (
        <section>
          <h2 className="section-title">Waiting for approval</h2>
          <p className="fine-print">New community sign-ups need a School Admin or System Admin to approve them before they can sign in.</p>
          <ul className="queue-list">
            {pending.map((p) => {
              const type = p.user_type_id ? typeById.get(p.user_type_id) : undefined;
              return (
                <li key={p.id} className="queue-item">
                  <span className="queue-icon" aria-hidden="true">{roleDetails[p.role].icon}</span>
                  <div className="queue-main">
                    <strong>{p.display_name ?? 'Unnamed account'}</strong>
                    <small>{type?.name ?? 'No position'} · {roleDetails[p.role].label}</small>
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
              );
            })}
          </ul>
        </section>
      )}

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
            const locked = p.id === profile.id || ((p.role === 'system_admin' || p.role === 'school_admin') && !isSystemAdmin);
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

// Creates an account directly, outside public sign-up — the only way a
// School Admin or System Admin gets created. A School Admin's position
// choices here are limited to Community Member positions by `assignable`.
function AddPersonForm({ assignable, isSystemAdmin, onAdded }: { assignable: UserType[]; isSystemAdmin: boolean; onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ email: string; setupLink: string | null } | null>(null);

  async function submit() {
    if (!designationId) {
      setError('Choose a position.');
      return;
    }
    setSubmitting(true);
    setError('');
    setResult(null);
    const r = await addPerson({ email, displayName, designationId });
    setSubmitting(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    setResult({ email: r.email ?? email.trim(), setupLink: r.setupLink ?? null });
    setEmail('');
    setDisplayName('');
    setDesignationId('');
    await onAdded();
  }

  return (
    <section className="composer">
      <h2 className="section-title">Add a person</h2>
      {!open ? (
        <button type="button" className="action-small primary" onClick={() => setOpen(true)}>
          Add person
        </button>
      ) : (
        <>
          <p className="fine-print">
            {isSystemAdmin
              ? 'Create an account for any position, including School Admin and System Admin.'
              : 'Create a Community Member account. Only a System Admin can add a School Admin or System Admin.'}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="field">
              <span>Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Full name</span>
              <input type="text" required minLength={2} maxLength={120} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <label className="field">
              <span>Position</span>
              <select className="role-select" required value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
                <option value="">Choose a position</option>
                {assignable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {roleDetails[t.base_role].label}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="error-text">{error}</p>}
            <div className="queue-actions">
              <button type="submit" className="action-small primary" disabled={submitting}>
                {submitting ? 'Adding…' : 'Create account'}
              </button>
              <button
                type="button"
                className="action-small"
                onClick={() => {
                  setOpen(false);
                  setError('');
                  setResult(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </>
      )}
      {result && (
        <p className="notice">
          {result.email} is ready.{' '}
          {result.setupLink ? (
            <>
              Share this one-time link so they can set a password:
              <br />
              <code>{result.setupLink}</code>
            </>
          ) : (
            'Ask them to use "Forgot password" on the sign-in page to set one.'
          )}
        </p>
      )}
    </section>
  );
}
