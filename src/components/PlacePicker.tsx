import { useEffect, useMemo, useState } from 'react';
import { childrenIndex, pathTo, placeLabel } from '../lib/layout';
import type { Location } from '../lib/types';

const LEVEL_LABELS = ['Campus', 'Building or area', 'Floor, wing, or area', 'Room or area'];

// Cascading dropdowns: each one lists only the places inside the choice above it.
export function PlacePicker({ locations, initial, onPick, onSkip, actionLabel = 'Continue' }: { locations: Location[]; initial: string | null; onPick: (id: string) => void; onSkip: () => void; actionLabel?: string }) {
  const index = useMemo(() => childrenIndex(locations), [locations]);
  const roots = useMemo(() => sortByName(index.get(null) ?? []), [index]);
  const [path, setPath] = useState<string[]>(() => (initial ? pathTo(initial, locations).map((l) => l.id) : []));
  const onlyCampus = roots.length === 1 ? roots[0].id : null;

  useEffect(() => {
    if (onlyCampus) setPath((p) => (p.length ? p : [onlyCampus]));
  }, [onlyCampus]);

  const levels: { label: string; options: Location[]; value: string }[] = [];
  levels.push({ label: LEVEL_LABELS[0], options: roots, value: path[0] ?? '' });
  for (let i = 0; i < path.length; i++) {
    const kids = sortByName(index.get(path[i]) ?? []);
    if (!kids.length) break;
    levels.push({ label: LEVEL_LABELS[Math.min(i + 1, LEVEL_LABELS.length - 1)], options: kids, value: path[i + 1] ?? '' });
  }

  function choose(level: number, id: string) {
    setPath((p) => (id ? [...p.slice(0, level), id] : p.slice(0, level)));
  }

  const selected = path[path.length - 1] ?? null;

  if (!roots.length) {
    return (
      <div className="place-picker">
        <p className="empty-note">No places have been set up yet.</p>
        <button type="button" className="big-button primary" onClick={onSkip}>
          Continue without a place
        </button>
      </div>
    );
  }

  return (
    <div className="place-picker">
      {levels.map((level, i) => (
        <label key={i} className="field place-select">
          {level.label}
          <select className="role-select" value={level.value} onChange={(e) => choose(i, e.target.value)}>
            <option value="">{i === 0 ? 'Choose a campus' : `Anywhere in ${locations.find((l) => l.id === path[i - 1])?.name ?? 'here'}`}</option>
            {level.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <p className="place-summary" aria-live="polite">
        📍 {selected ? placeLabel(selected, locations) : 'No place chosen'}
      </p>
      <button type="button" className="big-button primary" disabled={!selected} onClick={() => selected && onPick(selected)}>
        {actionLabel}
      </button>
      <button type="button" className="big-button ghost" onClick={onSkip}>
        Skip, I'm not sure where
      </button>
    </div>
  );
}

function sortByName(list: Location[]): Location[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}
