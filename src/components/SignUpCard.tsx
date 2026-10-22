import { useEffect, useMemo, useState } from 'react';
import { fetchRegistrationOptions, registerAccount, GENDER_LABELS, type Gender, type RegistrationOptions } from '../lib/data';
import { placeLabel } from '../lib/layout';
import type { Location } from '../lib/types';
import { PlacePicker } from './PlacePicker';

// Public registration is for Community Members only, and asks for exactly
// five things beyond the sign-in credentials: Name, Member type, Specific
// Location, ID No., and Gender. The database decides the role from the
// Member type (the designation) and refuses anything that is not open for
// sign-up.
export function SignUpCard({ onLogin }: { onLogin: () => void }) {
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [idNumber, setIdNumber] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [pickingPlace, setPickingPlace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmEmail, setConfirmEmail] = useState(false);

  useEffect(() => {
    fetchRegistrationOptions().then((r) => {
      setOptions(r.data);
      setLoadError(r.error ?? '');
    });
  }, []);

  // The picker works on the same shape as the rest of the app.
  const places: Location[] = useMemo(
    () => (options?.locations ?? []).map((l) => ({ id: l.id, name: l.name, environment: 'indoor', parent_id: l.parent_id, grid_cols: 0, grid_rows: 0, layout_x: null, layout_y: null, layout_w: null, layout_h: null })),
    [options],
  );

  async function submit() {
    if (!locationId || !gender) return;
    setSubmitting(true);
    setError('');
    const r = await registerAccount({ email, password, displayName: name, designationId, locationId, idNumber, gender });
    setSubmitting(false);
    if (r.error) setError(r.error);
    else if (r.needsConfirmation) setConfirmEmail(true);
  }

  if (confirmEmail) {
    return (
      <article className="login-card">
        <p className="eyebrow">CHECK YOUR EMAIL</p>
        <h3>Almost done</h3>
        <p>We sent a confirmation link to {email}. Open it, then log in.</p>
        <button type="button" className="link-button" onClick={onLogin}>
          Back to log in
        </button>
      </article>
    );
  }

  const closed = options && !options.open;

  return (
    <article className="login-card">
      <p className="eyebrow">CREATE AN ACCOUNT</p>
      <h3>Join your school as a community member</h3>
      {!options && !loadError && <p>Loading…</p>}
      {loadError && <p className="error-text">{loadError}</p>}
      {closed && <p className="notice">Sign-up is closed right now. Ask your school's System Admin to create your account.</p>}
      {options && options.open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label>
            Name
            <input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Email
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            Member type
            <select className="role-select" required value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
              <option value="">Choose your member type</option>
              {options.designations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            ID No.
            <input required minLength={1} maxLength={40} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="Student or employee ID" />
          </label>
          <label>
            Gender
            <select className="role-select" required value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
              <option value="">Choose your gender</option>
              {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Specific location</span>
            {locationId && !pickingPlace ? (
              <p className="place-summary">
                📍 {placeLabel(locationId, places)}{' '}
                <button type="button" className="action-small" onClick={() => setPickingPlace(true)}>
                  Change
                </button>
              </p>
            ) : (
              <PlacePicker
                locations={places}
                initial={locationId}
                actionLabel="Use this place"
                skipLabel="Cancel"
                onPick={(id) => {
                  setLocationId(id);
                  setPickingPlace(false);
                }}
                onSkip={locationId ? () => setPickingPlace(false) : undefined}
              />
            )}
            <small className="fine-print">Where you usually are, for example your homeroom or office. Reports start from here and you can change it later.</small>
          </div>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={submitting || !locationId || !designationId || !gender}>
            {submitting ? 'Creating…' : 'Create account'}
          </button>
        </form>
      )}
      <button type="button" className="link-button" onClick={onLogin}>
        Already have an account? Log in
      </button>
    </article>
  );
}
