import { useState } from 'react';
import { setMyDefaultLocation } from '../lib/data';
import { placeLabel } from '../lib/layout';
import type { Location, Profile } from '../lib/types';
import { PlacePicker } from './PlacePicker';

// The saved default campus location. It only pre-fills reports; each report
// still stores the place the person actually chooses.
export function DefaultLocationCard({ profile, locations, onChanged }: { profile: Profile; locations: Location[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const current = profile.primary_location_id;
  const usable = current ? locations.some((l) => l.id === current) : false;
  const needsReplacement = !usable;

  async function save(id: string) {
    setError('');
    const r = await setMyDefaultLocation(id);
    if (r.error) {
      setError(r.error);
      return;
    }
    await onChanged();
    setEditing(false);
    setSaved(true);
  }

  return (
    <div className="default-location">
      <h3 className="section-title">My default location</h3>
      {needsReplacement && !editing && (
        <p className="notice" role="alert">
          {current ? 'Your saved default location is no longer available.' : 'You have not saved a default location yet.'} Please choose one so reports can start from the right place.
        </p>
      )}
      {!needsReplacement && !editing && (
        <p className="place-summary">
          📍 {placeLabel(current, locations)}
          {saved && <small> · saved</small>}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {editing ? (
        <PlacePicker locations={locations} initial={usable ? current : null} actionLabel="Save as my default" skipLabel="Cancel" onPick={save} onSkip={() => setEditing(false)} />
      ) : (
        <button type="button" className="action-small" onClick={() => { setEditing(true); setSaved(false); }}>
          {needsReplacement ? 'Choose a default location' : 'Change'}
        </button>
      )}
    </div>
  );
}
