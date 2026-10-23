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
  const current = profile.primary_location_id;
  const usable = current ? locations.some((l) => l.id === current) : false;

  async function save(id: string) {
    setError('');
    const r = await setMyDefaultLocation(id);
    if (r.error) {
      setError(r.error);
      return;
    }
    await onChanged();
    setEditing(false);
  }

  return (
    <section className="card default-location">
      <div className="card-head">
        <h3 className="section-title">My default place</h3>
        {!editing && (
          <button type="button" className="text-button" onClick={() => setEditing(true)}>
            {usable ? 'Change' : 'Choose'}
          </button>
        )}
      </div>
      {!editing && <p className={usable ? 'place-summary' : 'notice'}>{usable ? `📍 ${placeLabel(current, locations)}` : 'Not set. Choose one so reports start from the right place.'}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {editing && <PlacePicker locations={locations} initial={usable ? current : null} actionLabel="Save" skipLabel="Cancel" onPick={save} onSkip={() => setEditing(false)} />}
    </section>
  );
}
