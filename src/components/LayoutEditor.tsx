import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { placeBlock, setGridSize } from '../lib/data';
import { blockOf, blockStyle, childrenIndex, clampBlock, overlaps, pathTo } from '../lib/layout';
import type { Block, Location, SetupLocation } from '../lib/types';

type Drag =
  | { id: string; mode: 'move'; start: { cx: number; cy: number }; origin: Block }
  | { id: string; mode: 'resize'; origin: Block }
  | { id: string; mode: 'new'; size: Block };

const GRID_SIZES = [12, 16, 24, 32, 40];

function sameBlock(a: Block, b: Block): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function LayoutEditor({ locations, onPatch }: { locations: SetupLocation[]; onPatch: (id: string, patch: Partial<Location>) => void }) {
  const active = useMemo(() => locations.filter((l) => l.status !== 'archived'), [locations]);
  const index = useMemo(() => childrenIndex(active), [active]);
  const roots = index.get(null) ?? [];
  const [parentId, setParentId] = useState<string | null>(roots[0]?.id ?? null);
  const parent = active.find((l) => l.id === parentId) ?? null;
  const cols = parent?.grid_cols ?? 24;
  const rows = parent?.grid_rows ?? 16;
  const kids = (parentId ? index.get(parentId) : roots) ?? [];
  const placed = kids.filter((k) => blockOf(k));
  const tray = kids.filter((k) => !blockOf(k));

  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Block | null>(null);
  const [outside, setOutside] = useState(false);
  const [status, setStatus] = useState('');

  function cellAt(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    const cx = Math.floor(((clientX - rect.left) / rect.width) * cols);
    const cy = Math.floor(((clientY - rect.top) / rect.height) * rows);
    return { cx: Math.max(0, Math.min(cols - 1, cx)), cy: Math.max(0, Math.min(rows - 1, cy)), inside };
  }

  // Listeners are attached on pointerdown itself (not in an effect) so a fast
  // drag cannot finish before the editor starts listening.
  const live = useRef<{ drag: Drag; preview: Block | null; outside: boolean } | null>(null);

  function track(e: PointerEvent) {
    const state = live.current;
    if (!state) return;
    const d = state.drag;
    const { cx, cy, inside } = cellAt(e.clientX, e.clientY);
    let next: Block | null;
    if (d.mode === 'move') next = clampBlock({ ...d.origin, x: d.origin.x + cx - d.start.cx, y: d.origin.y + cy - d.start.cy }, cols, rows);
    else if (d.mode === 'resize') next = clampBlock({ ...d.origin, w: Math.max(1, cx - d.origin.x + 1), h: Math.max(1, cy - d.origin.y + 1) }, cols, rows);
    else next = inside ? clampBlock({ ...d.size, x: cx - Math.floor(d.size.w / 2), y: cy - Math.floor(d.size.h / 2) }, cols, rows) : null;
    live.current = { drag: d, preview: next, outside: !inside };
    setPreview(next);
    setOutside(!inside);
  }

  function finish(e: PointerEvent) {
    window.removeEventListener('pointermove', track);
    window.removeEventListener(e.type === 'pointerup' ? 'pointercancel' : 'pointerup', finish);
    if (e.type !== 'pointercancel') track(e);
    const state = live.current;
    live.current = null;
    setDrag(null);
    setPreview(null);
    setOutside(false);
    if (!state || e.type === 'pointercancel') return;
    const { drag: d, preview: target, outside: out } = state;
    const removing = d.mode === 'move' && out;
    if (removing) return void save(d.id, null);
    if (!target) return;
    if (d.mode !== 'new' && sameBlock(target, d.origin)) return;
    void save(d.id, target);
  }

  const attached = useRef<{ track: typeof track; finish: typeof finish } | null>(null);

  function begin(d: Drag, initial: Block | null) {
    live.current = { drag: d, preview: initial, outside: false };
    attached.current = { track, finish };
    setDrag(d);
    setPreview(initial);
    window.addEventListener('pointermove', track);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  }

  useEffect(
    () => () => {
      const handlers = attached.current;
      if (!handlers) return;
      window.removeEventListener('pointermove', handlers.track);
      window.removeEventListener('pointerup', handlers.finish);
      window.removeEventListener('pointercancel', handlers.finish);
    },
    [],
  );

  async function save(id: string, block: Block | null) {
    const before = active.find((l) => l.id === id);
    const patch = block ? { layout_x: block.x, layout_y: block.y, layout_w: block.w, layout_h: block.h } : { layout_x: null, layout_y: null, layout_w: null, layout_h: null };
    onPatch(id, patch);
    setStatus('Saving…');
    const r = await placeBlock(id, block);
    if (r.error && before) {
      onPatch(id, { layout_x: before.layout_x, layout_y: before.layout_y, layout_w: before.layout_w, layout_h: before.layout_h });
      setStatus(r.error);
    } else {
      setStatus(block ? 'Saved' : `Removed ${before?.name ?? 'place'} from the map`);
    }
  }

  async function resizeGrid(nextCols: number, nextRows: number) {
    if (!parent) return;
    const tooSmall = placed.some((k) => {
      const b = blockOf(k)!;
      return b.x + b.w > nextCols || b.y + b.h > nextRows;
    });
    if (tooSmall) {
      setStatus('Move or shrink blocks near the edge before making the grid smaller.');
      return;
    }
    onPatch(parent.id, { grid_cols: nextCols, grid_rows: nextRows });
    const r = await setGridSize(parent.id, nextCols, nextRows);
    setStatus(r.error ?? 'Grid size saved');
  }

  function startMove(e: ReactPointerEvent, l: Location) {
    if (e.button !== 0) return;
    e.preventDefault();
    const { cx, cy } = cellAt(e.clientX, e.clientY);
    const origin = blockOf(l)!;
    begin({ id: l.id, mode: 'move', start: { cx, cy }, origin }, origin);
  }

  if (!active.length) return <p className="empty-note">Add a campus and its places first, then lay them out here.</p>;

  const path = pathTo(parentId, active);
  const dragging = drag ? active.find((l) => l.id === drag.id) : null;

  return (
    <section className="layout-editor">
      <div className="setup-head">
        <div>
          <h2 className="section-title">Map layout</h2>
          <p className="empty-note">Drag places from the tray onto the grid. Drag a block to move it, drag its corner to resize, or drag it off the grid to remove it. Changes save on drop.</p>
        </div>
      </div>

      <nav className="crumbs" aria-label="Map level">
        <select className="role-select" value={roots.some((r) => r.id === path[0]?.id) ? path[0]?.id : ''} onChange={(e) => setParentId(e.target.value)} aria-label="Campus">
          {roots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {path.length > 1 && (
          <button type="button" className="text-button" onClick={() => setParentId(path[0].id)}>
            {path[0].name}
          </button>
        )}
        {path.slice(1).map((p) => (
          <span key={p.id}>
            <span aria-hidden="true"> › </span>
            <button type="button" className="text-button" onClick={() => setParentId(p.id)}>
              {p.name}
            </button>
          </span>
        ))}
        <label className="grid-size">
          Grid
          <select className="role-select" value={cols} onChange={(e) => resizeGrid(Number(e.target.value), rows)} aria-label="Grid columns">
            {GRID_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          ×
          <select className="role-select" value={rows} onChange={(e) => resizeGrid(cols, Number(e.target.value))} aria-label="Grid rows">
            {GRID_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </nav>

      <div className="layout-workspace">
      <div className={`tray${drag?.mode === 'move' && outside ? ' is-drop-target' : ''}`}>
        <p className="tray-title">{drag?.mode === 'move' ? 'Drop here to remove from the map' : tray.length ? `Not on the map yet (${tray.length})` : 'Every place here is on the map.'}</p>
        <div className="tray-items">
          {tray.map((l) => (
            <span
              key={l.id}
              className={`tray-item${drag?.id === l.id ? ' is-dragging' : ''}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                const w = Math.max(2, Math.round(cols / 6));
                const h = Math.max(2, Math.round(rows / 5));
                begin({ id: l.id, mode: 'new', size: { x: 0, y: 0, w, h } }, null);
              }}
            >
              {l.name}
            </span>
          ))}
        </div>
      </div>
      <div
        ref={canvasRef}
        className={`map-canvas is-editing${drag?.mode === 'move' && outside ? ' is-removing' : ''}`}
        style={{ aspectRatio: `${cols} / ${rows}`, width: `min(100%, calc(62vh * ${cols} / ${rows}))`, backgroundSize: `${100 / cols}% ${100 / rows}%` }}
      >
        {placed.map((l) => {
          const b = drag?.id === l.id && preview ? preview : blockOf(l)!;
          const clash = placed.some((o) => o.id !== l.id && overlaps(b, blockOf(o)!));
          const hasKids = (index.get(l.id) ?? []).length > 0;
          return (
            <div
              key={l.id}
              className={`map-block is-draggable${drag?.id === l.id ? ' is-dragging' : ''}${clash ? ' is-overlap' : ''}`}
              style={blockStyle(b, cols, rows)}
              onPointerDown={(e) => startMove(e, l)}
              title={clash ? 'Overlaps another block' : undefined}
            >
              <span className="block-label">{l.name}</span>
              {hasKids && (
                <button type="button" className="block-open" onPointerDown={(e) => e.stopPropagation()} onClick={() => setParentId(l.id)} aria-label={`Open ${l.name}`}>
                  Open ›
                </button>
              )}
              <span
                className="block-resize"
                aria-hidden="true"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  begin({ id: l.id, mode: 'resize', origin: blockOf(l)! }, blockOf(l)!);
                }}
              />
            </div>
          );
        })}
        {drag?.mode === 'new' && preview && (
          <div className="map-block is-dragging is-ghost" style={blockStyle(preview, cols, rows)}>
            <span className="block-label">{dragging?.name}</span>
          </div>
        )}
      </div>
      </div>

      {status && (
        <p className={status === 'Saved' || status.startsWith('Removed') || status === 'Grid size saved' || status === 'Saving…' ? 'fine-print' : 'error-text'} role="status">
          {status}
        </p>
      )}
    </section>
  );
}
