import { useMemo, useState } from 'react';
import { iconFor, labelFor } from '../lib/catalog';
import { blockOf, blockStyle, childrenIndex, pathTo, subtreeIds } from '../lib/layout';
import { since } from '../lib/analytics';
import type { CheckIn, Incident, Location, Submission } from '../lib/types';
import type { Role } from '../roles';
import { timeAgo } from './QueuePanel';

type Layer = 'reports' | 'help' | 'stress';

type Item = { id: string; locationId: string | null; icon: string; title: string; when: string; status: string; stress?: number };

const RESPONDERS: Role[] = ['security', 'drrm', 'school_admin'];

type Props = {
  role: Role;
  days: number;
  locations: Location[];
  submissions: Submission[];
  incidents: Incident[];
  checkIns: CheckIn[];
};

export function CampusMap({ role, days, locations, submissions, incidents, checkIns }: Props) {
  const layers: { key: Layer; label: string }[] = [
    { key: 'reports', label: 'Reports and incidents' },
    ...(RESPONDERS.includes(role) ? [{ key: 'help' as const, label: 'Help requests' }] : []),
    ...(role === 'guidance' ? [{ key: 'stress' as const, label: 'Average stress' }] : []),
  ];
  const [layer, setLayer] = useState<Layer>('reports');
  const index = useMemo(() => childrenIndex(locations), [locations]);
  const startId = useMemo(() => {
    const withMap = locations.find((l) => (index.get(l.id) ?? []).some((k) => blockOf(k)) && !l.parent_id);
    return withMap?.id ?? locations.find((l) => (index.get(l.id) ?? []).some((k) => blockOf(k)))?.id ?? null;
  }, [locations, index]);
  const [parentId, setParentId] = useState<string | null>(startId);
  const [selected, setSelected] = useState<string | null>(null);
  const currentId = parentId ?? startId;

  const items: Item[] = useMemo(() => {
    if (layer === 'help') {
      return since(checkIns, days, (c) => c.checked_in_at)
        .filter((c) => c.status === 'need_help')
        .map((c) => ({ id: c.id, locationId: c.location_id, icon: '🆘', title: 'Help requested', when: c.checked_in_at, status: 'help' }));
    }
    if (layer === 'stress') {
      return since(submissions, days, (s) => s.created_at)
        .filter((s) => s.kind === 'sentiment')
        .map((s) => ({ id: s.id, locationId: s.location_id, icon: iconFor(s.sub_type), title: `${labelFor(s.sub_type)} · stress ${s.stress_level}/5`, when: s.created_at, status: s.status, stress: s.stress_level ?? undefined }));
    }
    return [
      ...since(submissions, days, (s) => s.created_at)
        .filter((s) => s.kind !== 'sentiment')
        .map((s) => ({ id: s.id, locationId: s.location_id, icon: iconFor(s.sub_type), title: labelFor(s.sub_type), when: s.created_at, status: s.status })),
      ...since(incidents, days, (i) => i.created_at).map((i) => ({ id: i.id, locationId: i.location_id, icon: iconFor(i.category), title: `${i.case_ref} · ${labelFor(i.category)}`, when: i.created_at, status: i.status })),
    ];
  }, [layer, days, submissions, incidents, checkIns]);

  if (!currentId) {
    return (
      <section className="chart-card map-card">
        <header>
          <h3>Campus map</h3>
          <p>No map yet. A System Admin can draw one in Setup › Map layout.</p>
        </header>
      </section>
    );
  }

  const current = locations.find((l) => l.id === currentId)!;
  const kids = index.get(currentId) ?? [];
  const placed = kids.filter((k) => blockOf(k));
  const unplaced = kids.filter((k) => !blockOf(k));

  const statsFor = (placeId: string) => {
    const ids = subtreeIds(placeId, index);
    const here = items.filter((i) => i.locationId && ids.has(i.locationId));
    const stressValues = here.map((i) => i.stress).filter((v): v is number => v !== undefined);
    const value = layer === 'stress' ? (stressValues.length ? stressValues.reduce((a, b) => a + b, 0) / stressValues.length : null) : here.length;
    return { items: here, value, count: here.length };
  };

  const blockStats = new Map(kids.map((k) => [k.id, statsFor(k.id)]));
  const counts = [...blockStats.values()].map((s) => s.value ?? 0);
  const scaleMin = layer === 'stress' ? 1 : 0;
  const scaleMax = layer === 'stress' ? 5 : Math.max(1, ...counts);
  const shade = (value: number | null) => {
    if (value === null || (layer !== 'stress' && value === 0)) return undefined;
    const t = Math.min(1, Math.max(0, (value - scaleMin) / (scaleMax - scaleMin)));
    return `color-mix(in srgb, var(--viz-series) ${Math.round(14 + 76 * t)}%, var(--surface))`;
  };
  const format = (value: number | null) => (value === null ? '—' : layer === 'stress' ? value.toFixed(1) : String(value));
  const unit = layer === 'stress' ? 'average stress' : layer === 'help' ? 'help requests' : 'reports';
  const directHere = items.filter((i) => i.locationId === currentId);

  const selectedLoc = selected ? kids.find((k) => k.id === selected) : null;
  const selectedStats = selectedLoc ? blockStats.get(selectedLoc.id)! : null;
  const path = pathTo(currentId, locations);
  const roots = (index.get(null) ?? []).filter((r) => (index.get(r.id) ?? []).length > 0);

  return (
    <section className="chart-card map-card">
      <header>
        <h3>Campus map</h3>
        <p>
          Shaded by {unit} in the last {days} days, counting everything inside each place. Tap a block for details.
        </p>
      </header>

      <div className="chip-row map-controls" role="group" aria-label="Map layer">
        {layers.map((l) => (
          <button type="button" key={l.key} className={`filter-button${layer === l.key ? ' is-active' : ''}`} aria-pressed={layer === l.key} onClick={() => setLayer(l.key)}>
            {l.label}
          </button>
        ))}
      </div>

      <nav className="crumbs" aria-label="Map level">
        {roots.length > 1 && path[0] ? (
          <select className="role-select" value={path[0].id} onChange={(e) => { setParentId(e.target.value); setSelected(null); }} aria-label="Campus">
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        ) : (
          path[0] && (
            <button type="button" className="text-button" onClick={() => { setParentId(path[0].id); setSelected(null); }}>
              {path[0].name}
            </button>
          )
        )}
        {roots.length > 1 && path.length > 1 && (
          <button type="button" className="text-button" onClick={() => { setParentId(path[0].id); setSelected(null); }}>
            {path[0].name}
          </button>
        )}
        {path.slice(1).map((p) => (
          <span key={p.id}>
            <span aria-hidden="true"> › </span>
            <button type="button" className="text-button" onClick={() => { setParentId(p.id); setSelected(null); }}>
              {p.name}
            </button>
          </span>
        ))}
      </nav>

      {placed.length === 0 ? (
        <p className="empty-note">Nothing inside {current.name} is on the map yet.</p>
      ) : (
        <div className="map-canvas" style={{ aspectRatio: `${current.grid_cols} / ${current.grid_rows}`, width: `min(100%, calc(60vh * ${current.grid_cols} / ${current.grid_rows}))`, backgroundSize: `${100 / current.grid_cols}% ${100 / current.grid_rows}%` }}>
          {placed.map((k) => {
            const stats = blockStats.get(k.id)!;
            return (
              <button
                type="button"
                key={k.id}
                className={`map-block${selected === k.id ? ' is-selected' : ''}`}
                style={{ ...blockStyle(blockOf(k)!, current.grid_cols, current.grid_rows), background: shade(stats.value) }}
                aria-label={`${k.name}: ${format(stats.value)} ${unit}`}
                aria-pressed={selected === k.id}
                onClick={() => setSelected(selected === k.id ? null : k.id)}
              >
                <span className="block-label">
                  {k.name}
                  <strong>{format(stats.value)}</strong>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="map-legend" aria-hidden="true">
        <span>{layer === 'stress' ? '1 low' : '0'}</span>
        <span className="legend-bar" />
        <span>{layer === 'stress' ? '5 high' : `${scaleMax} ${unit}`}</span>
      </div>

      {selectedLoc && selectedStats && (
        <div className="map-detail">
          <div className="map-detail-head">
            <strong>
              {selectedLoc.name} · {format(selectedStats.value)} {unit}
              {layer === 'stress' && ` (${selectedStats.count} check-ins)`}
            </strong>
            {(index.get(selectedLoc.id) ?? []).some((c) => blockOf(c)) && (
              <button type="button" className="action-small" onClick={() => { setParentId(selectedLoc.id); setSelected(null); }}>
                Open map ›
              </button>
            )}
          </div>
          {selectedStats.items.length === 0 ? (
            <p className="empty-note">Nothing here in this period.</p>
          ) : (
            <ul className="activity-list">
              {[...selectedStats.items]
                .sort((a, b) => b.when.localeCompare(a.when))
                .slice(0, 8)
                .map((i) => (
                  <li key={i.id}>
                    <span aria-hidden="true">{i.icon}</span>
                    <span className="activity-main">
                      <strong>{i.title}</strong>
                      <small>
                        {locations.find((l) => l.id === i.locationId)?.name ?? 'Unknown place'} · {timeAgo(i.when)}
                      </small>
                    </span>
                    <span className={`chip status-${i.status}`}>{i.status.replace('_', ' ')}</span>
                  </li>
                ))}
            </ul>
          )}
          {selectedStats.items.length > 8 && <p className="fine-print">And {selectedStats.items.length - 8} more. See Queue for the full list.</p>}
        </div>
      )}

      {(unplaced.length > 0 || directHere.length > 0) && (
        <div className="chip-row map-extra">
          {directHere.length > 0 && (
            <span className="chip">
              Filed at {current.name} itself: {directHere.length}
            </span>
          )}
          {unplaced.map((k) => (
            <span key={k.id} className="chip">
              {k.name} (not on map): {format(blockStats.get(k.id)!.value)}
            </span>
          ))}
        </div>
      )}

      <details className="table-view">
        <summary>View as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Place</th>
              <th scope="col">{layer === 'stress' ? 'Average stress' : 'Count'}</th>
              {layer === 'stress' && <th scope="col">Check-ins</th>}
            </tr>
          </thead>
          <tbody>
            {kids.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>{format(blockStats.get(k.id)!.value)}</td>
                {layer === 'stress' && <td>{blockStats.get(k.id)!.count}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
