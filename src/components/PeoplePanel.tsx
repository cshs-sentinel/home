import { useState } from 'react';
import { addPerson, approveRegistration, rejectRegistration, setUserType, type SchoolData } from '../lib/data';
import { placeLabel } from '../lib/layout';
import type { Location, Profile, UserType } from '../lib/types';
import { roleDetails } from '../roles';
import { PendingList } from './PendingList';
import { PlacePicker } from './PlacePicker';
import { timeAgo } from './QueuePanel';

export function PeoplePanel({ profile, data, onChanged }: { profile: Profile; data: SchoolData; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
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

  return (
    <div className="people">
      {pending.length > 0 && (
        <section className="card">
          <h2 className="section-title">
            Waiting for approval <span className="count">{pending.length}</span>
          </h2>
          <PendingList
            people={pending.map((p) => ({ id: p.id, name: p.display_name, detail: `${(p.user_type_id && typeById.get(p.user_type_id)?.name) || 'No position'} · ${roleDetails[p.role].label}` }))}
            busy={busy}
            onDecide={(id, approve) => {
              const person = pending.find((p) => p.id === id);
              if (person) decide(person, approve);
            }}
          />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="section-title">
            People <span className="count">{people.length}</span>
          </h2>
          {!adding && (
            <button type="button" className="action-small primary" onClick={() => setAdding(true)}>
              + Add person
            </button>
          )}
        </div>
        {adding && (
          <AddPersonForm
            assignable={assignable}
            isSystemAdmin={isSystemAdmin}
            locations={data.locations}
            onClose={() => setAdding(false)}
            onAdded={async (r) => {
              setAdded(r);
              setAdding(false);
              await onChanged();
            }}
          />
        )}
        {added && (
          <p className="notice">
            {added.email} is ready.{' '}
            {added.setupLink ? (
              <>
                Share this one-time link so they can set a password:
                <br />
                <code>{added.setupLink}</code>
              </>
            ) : (
              'Ask them to use "Forgot password" on the sign-in page to set one.'
            )}
          </p>
        )}
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
      <details className="card disclosure">
        <summary>Activity log</summary>
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
      </details>
    </div>
  );
}

type Added = { email: string; setupLink: string | null };

// Creates an account directly, outside public sign-up — the only way a
// School Admin or System Admin gets created. A School Admin's position
// choices here are limited to Community Member positions by `assignable`.
function AddPersonForm({ assignable, isSystemAdmin, locations, onAdded, onClose }: { assignable: UserType[]; isSystemAdmin: boolean; locations: Location[]; onAdded: (r: Added) => Promise<void>; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [pickingPlace, setPickingPlace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!designationId) {
      setError('Choose a position.');
      return;
    }
    setSubmitting(true);
    setError('');
    const r = await addPerson({ email, displayName, designationId, locationId });
    setSubmitting(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    await onAdded({ email: r.email ?? email.trim(), setupLink: r.setupLink ?? null });
  }

  return (
    <div className="new-person">
      {!isSystemAdmin && <p className="fine-print">Only a System Admin can add a School Admin or System Admin.</p>}
          <form
            className="form-grid"
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
            <div className="field">
              <span>Default place (optional)</span>
              {locationId && !pickingPlace ? (
                <p className="place-summary">
                  📍 {placeLabel(locationId, locations)}{' '}
                  <button type="button" className="text-button" onClick={() => setPickingPlace(true)}>
                    Change
                  </button>
                  <button type="button" className="text-button" onClick={() => setLocationId(null)}>
                    Clear
                  </button>
                </p>
              ) : pickingPlace ? (
                <PlacePicker
                  locations={locations}
                  initial={locationId}
                  actionLabel="Use this place"
                  skipLabel="Cancel"
                  onPick={(id) => {
                    setLocationId(id);
                    setPickingPlace(false);
                  }}
                  onSkip={() => setPickingPlace(false)}
                />
              ) : (
                <button type="button" className="action-small" onClick={() => setPickingPlace(true)}>
                  Choose a place
                </button>
              )}
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="queue-actions">
              <button type="submit" className="action-small primary" disabled={submitting}>
                {submitting ? 'Adding…' : 'Create account'}
              </button>
              <button type="button" className="action-small" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
    </div>
  );
}
