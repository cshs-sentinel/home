import { useEffect, useMemo, useState } from 'react';
import { HAZARDS, INCIDENTS, NEGATIVE_EMOTIONS, OBSERVATIONS, iconFor, labelFor, type Option } from '../lib/catalog';
import { fetchSentimentByLocation, type PlaceSentiment, type SchoolData } from '../lib/data';
import { blockOf, blockStyle, childrenIndex, pathTo, placeLabel, subtreeIds } from '../lib/layout';
import { OPEN_INCIDENT, since } from '../lib/analytics';
import type { Role } from '../roles';
import { NestedMap } from './NestedMap';
import { RangeFilter, type Range } from './AnalyticsPanel';
import { timeAgo } from './QueuePanel';

type Layer = 'all' | 'incidents' | 'hazards' | 'concerns' | 'help' | 'sentiment';

type Item = { id: string; locationId: string | null; icon: string; title: string; when: string; status: string; stress?: number };

type Stats = { value: number | null; count: number; items: Item[] | null; suppressed?: boolean };

const RESPONDERS: Role[] = ['security', 'drrm', 'school_admin'];

const LAYERS: { key: Layer; label: string; roles?: Role[] }[] = [
  { key: 'all', label: 'All reports' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'hazards', label: 'Hazards' },
  { key: 'concerns', label: 'Concerns and suggestions' },
  { key: 'help', label: 'Help requests', roles: RESPONDERS },
  { key: 'sentiment', label: 'Sentiment', roles: ['guidance', 'school_admin'] },
];

const TYPE_FILTERS: Partial<Record<Layer, Option[]>> = {
  incidents: INCIDENTS,
  hazards: HAZARDS,
  concerns: OBSERVATIONS,
};

const UNITS: Record<Layer, string> = {
  all: 'reports',
  incidents: 'incidents',
  hazards: 'hazard reports',
  concerns: 'concerns and suggestions',
  help: 'help requests',
  sentiment: 'average stress',
};

type Props = { role: Role; days: Range; onDays: (d: Range) => void; data: SchoolData };

export function MapPanel({ role, days, onDays, data }: Props) {
  const locations = data.locations;
  const layers = LAYERS.filter((l) => !l.roles || l.roles.includes(role));
  const [layer, setLayer] = useState<Layer>('all');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [openOnly, setOpenOnly] = useState(false);
  const [view, setView] = useState<'campus' | 'level'>('campus');
  const [selected, setSelected] = useState<string | null>(null);
  const index = useMemo(() => childrenIndex(locations), [locations]);
  const startId = useMemo(() => {
    const roots0 = index.get(null) ?? [];
    const pick = roots0.find((r) => (index.get(r.id) ?? []).some((k) => blockOf(k))) ?? roots0.find((r) => (index.get(r.id) ?? []).length) ?? roots0[0];
    return pick?.id ?? null;
  }, [index]);
  const [parentId, setParentId] = useState<string | null>(null);
  const currentId = parentId ?? startId;

  // School Admins cannot read individual feelings, so their sentiment layer
  // comes from the database's privacy-safe totals.
  const aggregateSentiment = layer === 'sentiment' && role === 'school_admin';
  const [placeSentiment, setPlaceSentiment] = useState<Map<string, PlaceSentiment> | null>(null);
  const [sentimentError, setSentimentError] = useState('');
  useEffect(() => {
    if (!aggregateSentiment) return;
    let cancelled = false;
    setPlaceSentiment(null);
    fetchSentimentByLocation(days).then((r) => {
      if (cancelled) return;
      setSentimentError(r.error ?? '');
      setPlaceSentiment(new Map(r.data.map((row) => [row.location_id, row])));
    });
    return () => {
      cancelled = true;
    };
  }, [aggregateSentiment, days]);

  function chooseLayer(next: Layer) {
    setLayer(next);
    setTypeFilter('');
    setSelected(null);
  }

  const items: Item[] = useMemo(() => {
    const subs = since(data.submissions, days, (s) => s.created_at).filter((s) => !openOnly || s.status !== 'resolved');
    const incs = since(data.incidents, days, (i) => i.created_at).filter((i) => !openOnly || OPEN_INCIDENT.includes(i.status));
    const fromSub = (s: (typeof subs)[number]): Item => ({ id: s.id, locationId: s.location_id, icon: iconFor(s.sub_type), title: labelFor(s.sub_type), when: s.created_at, status: s.status });
    const fromInc = (i: (typeof incs)[number]): Item => ({ id: i.id, locationId: i.location_id, icon: iconFor(i.category), title: `${i.case_ref} · ${labelFor(i.category)}`, when: i.created_at, status: i.status });
    switch (layer) {
      case 'help':
        return since(data.checkIns, days, (c) => c.checked_in_at)
          .filter((c) => c.status === 'need_help')
          .map((c) => ({ id: c.id, locationId: c.location_id, icon: '🆘', title: 'Help requested', when: c.checked_in_at, status: 'help' }));
      case 'sentiment':
        return subs
          .filter((s) => s.kind === 'sentiment' && (typeFilter !== 'negative' || NEGATIVE_EMOTIONS.has(s.sub_type)))
          .map((s) => ({ ...fromSub(s), title: `${labelFor(s.sub_type)} · stress ${s.stress_level}/5`, stress: s.stress_level ?? undefined }));
      case 'incidents':
        return incs.filter((i) => !typeFilter || i.category === typeFilter).map(fromInc);
      case 'hazards':
        return subs.filter((s) => s.kind === 'incident_hazard' && (!typeFilter || s.sub_type === typeFilter)).map(fromSub);
      case 'concerns':
        return subs.filter((s) => s.kind === 'observation' && (!typeFilter || s.sub_type === typeFilter)).map(fromSub);
      default:
        return [...subs.filter((s) => s.kind !== 'sentiment').map(fromSub), ...incs.map(fromInc)];
    }
  }, [layer, typeFilter, openOnly, days, data]);

  if (!currentId) {
    return (
      <section className="chart-card map-card">
        <header>
          <h3>Campus map</h3>
          <p>No places yet. A System Admin can add them in Setup › Locations.</p>
        </header>
      </section>
    );
  }

  const statsFor = (placeId: string): Stats => {
    if (aggregateSentiment) {
      const row = placeSentiment?.get(placeId);
      return row ? { value: row.avg_stress, count: row.entries, items: null } : { value: null, count: 0, items: null, suppressed: true };
    }
    const ids = subtreeIds(placeId, index);
    const here = items.filter((i) => i.locationId && ids.has(i.locationId));
    if (layer === 'sentiment') {
      const stress = here.map((i) => i.stress).filter((v): v is number => v !== undefined);
      return { value: stress.length ? stress.reduce((a, b) => a + b, 0) / stress.length : null, count: here.length, items: here };
    }
    return { value: here.length, count: here.length, items: here };
  };

  const current = locations.find((l) => l.id === currentId)!;
  const kids = index.get(currentId) ?? [];
  const placed = kids.filter((k) => blockOf(k));
  const unplaced = kids.filter((k) => !blockOf(k));
  const blockStats = new Map(kids.map((k) => [k.id, statsFor(k.id)]));
  const path = pathTo(currentId, locations);
  const campusId = path[0]?.id ?? currentId;
  const campusPlaces = [...subtreeIds(campusId, index)].filter((id) => id !== campusId);
  const leafStats = new Map(campusPlaces.filter((id) => !(index.get(id) ?? []).length).map((id) => [id, statsFor(id)]));
  const isStress = layer === 'sentiment';
  const counts = (view === 'campus' ? [...leafStats.values()] : [...blockStats.values()]).map((s) => s.value ?? 0);
  const scaleMin = isStress ? 1 : 0;
  const scaleMax = isStress ? 5 : Math.max(1, ...counts);
  const shade = (value: number | null) => {
    if (value === null || (!isStress && value === 0)) return undefined;
    const t = Math.min(1, Math.max(0, (value - scaleMin) / (scaleMax - scaleMin)));
    return `color-mix(in srgb, var(--viz-series) ${Math.round(14 + 76 * t)}%, var(--surface))`;
  };
  const shadedStats = [...(view === 'campus' ? leafStats : blockStats).values()];
  const shaded = isStress ? shadedStats.some((st) => st.value !== null) : shadedStats.some((st) => (st.value ?? 0) > 0);
  const format = (s: Stats) => (s.suppressed ? 'too few' : s.value === null ? '—' : isStress ? s.value.toFixed(1) : String(s.value));
  const unit = UNITS[layer];
  const directHere = items.filter((i) => i.locationId === currentId);
  const selectedLoc = selected ? locations.find((l) => l.id === selected) ?? null : null;
  const selectedStats = selectedLoc ? statsFor(selectedLoc.id) : null;
  const roots = (index.get(null) ?? []).filter((r) => (index.get(r.id) ?? []).length > 0);
  const filters = layer === 'sentiment' && role === 'guidance' ? [{ value: 'negative', label: 'Negative feelings only', icon: '' }] : TYPE_FILTERS[layer];
  const canOpenOnly = layer !== 'help' && !aggregateSentiment;
  const go = (id: string) => {
    setParentId(id);
    setSelected(null);
  };

  return (
    <div className="map-panel">
      <div className="map-toolbar">
        <RangeFilter days={days} onDays={onDays} />
        <div className="segmented" role="group" aria-label="Map view">
          <button type="button" className={`filter-button${view === 'campus' ? ' is-active' : ''}`} aria-pressed={view === 'campus'} onClick={() => { setView('campus'); setSelected(null); }}>
            Whole campus
          </button>
          <button type="button" className={`filter-button${view === 'level' ? ' is-active' : ''}`} aria-pressed={view === 'level'} onClick={() => { setView('level'); setSelected(null); }}>
            One level
          </button>
        </div>
      </div>

      <section className="chart-card map-card">
        <header>
          <h3>Campus map</h3>
          <p>
            {view === 'campus'
              ? `Every building, floor, and room at once, shaded by ${unit} in the last ${days} days. Tap any block for details.`
              : `Shaded by ${unit} in the last ${days} days, counting everything inside each place. Tap a block for details.`}
          </p>
        </header>


        <div className="map-controls" role="group" aria-label="Heatmap type">
          <span className="control-label">Heatmap</span>
          <select className="role-select layer-select" value={layer} onChange={(e) => chooseLayer(e.target.value as Layer)} aria-label="Heatmap type">
            {layers.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
          <div className="chip-row layer-chips">
            {layers.map((l) => (
              <button type="button" key={l.key} className={`filter-button${layer === l.key ? ' is-active' : ''}`} aria-pressed={layer === l.key} onClick={() => chooseLayer(l.key)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {(filters || canOpenOnly) && (
          <div className="map-controls" role="group" aria-label="Filter">
            <span className="control-label">Show</span>
            <div className="chip-row">
              {filters && (
                <>
                  <button type="button" className={`filter-button${typeFilter === '' ? ' is-active' : ''}`} aria-pressed={typeFilter === ''} onClick={() => setTypeFilter('')}>
                    All types
                  </button>
                  {filters.map((f) => (
                    <button type="button" key={f.value} className={`filter-button${typeFilter === f.value ? ' is-active' : ''}`} aria-pressed={typeFilter === f.value} onClick={() => setTypeFilter(f.value)}>
                      {f.icon && <span aria-hidden="true">{f.icon} </span>}
                      {f.label}
                    </button>
                  ))}
                </>
              )}
              {canOpenOnly && (
                <label className="check-row open-only">
                  <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Still needs a response
                </label>
              )}
            </div>
          </div>
        )}

        {aggregateSentiment && (
          <p className="fine-print privacy-note">
            Totals only. Places with fewer than 3 feelings, or where a small group could be worked out from the totals around it, show as "too few". Individual feelings stay with Guidance.
          </p>
        )}
        {sentimentError && aggregateSentiment && <p className="error-text">{sentimentError}</p>}

        {roots.length > 1 && (view === 'campus' || path.length <= 1) && (
          <nav className="crumbs" aria-label="Campus">
            <select className="role-select" value={campusId} onChange={(e) => go(e.target.value)} aria-label="Campus">
              {roots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </nav>
        )}

        {view === 'campus' && (
          <NestedMap
            locations={locations}
            rootId={campusId}
            selectedId={selected}
            onPick={(id) => setSelected(selected === id ? null : id)}
            shade={(id) => (leafStats.has(id) ? shade(leafStats.get(id)!.value) : undefined)}
            value={(id) => (leafStats.has(id) ? format(leafStats.get(id)!) : null)}
          />
        )}

        {view === 'level' && (
          <>
            {path.length > 1 && (
              <nav className="crumbs" aria-label="Map level">
                {path.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && <span aria-hidden="true"> › </span>}
                    <button type="button" className="text-button" onClick={() => go(p.id)}>
                      {p.name}
                    </button>
                  </span>
                ))}
              </nav>
            )}
            {placed.length === 0 ? (
              <p className="empty-note">Nothing inside {current.name} is drawn on its map yet. Try Whole campus.</p>
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
                      aria-label={`${k.name}: ${format(stats)} ${unit}`}
                      aria-pressed={selected === k.id}
                      onClick={() => setSelected(selected === k.id ? null : k.id)}
                    >
                      <span className="block-label">
                        {k.name}
                        <strong>{format(stats)}</strong>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {shaded && (
        <div className="map-legend" aria-hidden="true">
          <span>{isStress ? '1 low' : '0'}</span>
          <span className="legend-bar" />
          <span>{isStress ? '5 high' : `${scaleMax} ${unit}`}</span>
        </div>
        )}

        {selectedLoc && selectedStats && (
          <div className="map-detail">
            <div className="map-detail-head">
              <strong>
                {placeLabel(selectedLoc.id, locations)} · {format(selectedStats)} {unit}
                {isStress && !selectedStats.suppressed && ` (${selectedStats.count} feelings)`}
              </strong>
              {(index.get(selectedLoc.id) ?? []).some((c) => blockOf(c)) && (
                <button type="button" className="action-small" onClick={() => { setParentId(selectedLoc.id); setView('level'); setSelected(null); }}>
                  Open map ›
                </button>
              )}
            </div>
            {selectedStats.items === null ? (
              <p className="empty-note">{selectedStats.suppressed ? 'Too few feelings here to show without risking someone being identified.' : 'Totals only. Individual feelings stay with Guidance.'}</p>
            ) : selectedStats.items.length === 0 ? (
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
                          {placeLabel(i.locationId, locations)} · {timeAgo(i.when)}
                        </small>
                      </span>
                      <span className={`chip status-${i.status}`}>{i.status.replace('_', ' ')}</span>
                    </li>
                  ))}
              </ul>
            )}
            {selectedStats.items && selectedStats.items.length > 8 && <p className="fine-print">And {selectedStats.items.length - 8} more. See Queue for the full list.</p>}
          </div>
        )}

        {view === 'level' && !aggregateSentiment && (unplaced.length > 0 || directHere.length > 0) && (
          <div className="chip-row map-extra">
            {directHere.length > 0 && <span className="chip">Filed at {current.name} itself: {directHere.length}</span>}
            {unplaced.map((k) => (
              <span key={k.id} className="chip">
                {k.name} (not on map): {format(blockStats.get(k.id)!)}
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
                <th scope="col">{isStress ? 'Average stress' : 'Count'}</th>
                {isStress && <th scope="col">Feelings</th>}
              </tr>
            </thead>
            <tbody>
              {(view === 'campus' ? campusPlaces : kids.map((k) => k.id)).map((id) => {
                const stats = statsFor(id);
                return (
                  <tr key={id}>
                    <td>{view === 'campus' ? placeLabel(id, locations) : locations.find((l) => l.id === id)?.name}</td>
                    <td>{format(stats)}</td>
                    {isStress && <td>{stats.suppressed ? 'too few' : stats.count}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      </section>
    </div>
  );
}
