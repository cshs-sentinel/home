import { useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import { blockOf, blockStyle, childrenIndex } from '../lib/layout';
import type { Location } from '../lib/types';

type Props = {
  locations: Location[];
  rootId: string;
  onPick: (id: string) => void;
  selectedId?: string | null;
  shade?: (id: string) => string | undefined;
  value?: (id: string) => string | null;
  maxDepth?: number;
};

// The whole campus in one picture. Each place draws its children where the
// admin placed them on its grid; places whose children are not laid out yet
// get them auto-tiled (treemap-style) so nothing is left out.
export function NestedMap({ locations, rootId, onPick, selectedId, shade, value, maxDepth = 4 }: Props) {
  const index = useMemo(() => childrenIndex(locations), [locations]);
  const root = locations.find((l) => l.id === rootId);
  if (!root) return null;

  function interior(parent: Location, depth: number) {
    const kids = index.get(parent.id) ?? [];
    if (!kids.length || depth >= maxDepth) return null;
    const placed = kids.filter((k) => blockOf(k));
    const items: { loc: Location; style: CSSProperties }[] = placed.length
      ? placed.map((k) => ({ loc: k, style: blockStyle(blockOf(k)!, parent.grid_cols, parent.grid_rows) }))
      : autoTile([...kids].sort((a, b) => a.name.localeCompare(b.name)));
    const hidden = placed.length ? kids.length - placed.length : 0;
    return (
      <>
        {items.map(({ loc, style }) => block(loc, style, depth + 1))}
        {hidden > 0 && (
          <span className="nm-hidden" title={`${hidden} place${hidden === 1 ? '' : 's'} inside ${parent.name} not drawn on its map yet`}>
            +{hidden}
          </span>
        )}
      </>
    );
  }

  function block(loc: Location, style: CSSProperties, depth: number) {
    const inner = interior(loc, depth);
    const leaf = !inner;
    const shown = value?.(loc.id) ?? null;
    const pick = () => onPick(loc.id);
    return (
      <div
        key={loc.id}
        role="button"
        tabIndex={0}
        className={`nm-block${leaf ? ' is-leaf' : ''}${selectedId === loc.id ? ' is-selected' : ''}`}
        data-depth={Math.min(depth, 4)}
        style={{ ...style, background: leaf ? shade?.(loc.id) : undefined }}
        title={shown ? `${loc.name}: ${shown}` : loc.name}
        aria-label={shown ? `${loc.name}: ${shown}` : loc.name}
        onClick={(e) => {
          e.stopPropagation();
          pick();
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            pick();
          }
        }}
      >
        <span className="nm-label">
          {loc.name}
          {shown !== null && <strong> {shown}</strong>}
        </span>
        {inner && <span className="nm-inner">{inner}</span>}
      </div>
    );
  }

  return (
    <div
      className="nm-root"
      style={{ aspectRatio: `${root.grid_cols} / ${root.grid_rows}`, width: `min(100%, calc(62vh * ${root.grid_cols} / ${root.grid_rows}))` }}
    >
      {interior(root, 0) ?? <p className="empty-note nm-empty">Nothing inside {root.name} yet.</p>}
    </div>
  );
}

function autoTile(kids: Location[]): { loc: Location; style: CSSProperties }[] {
  const cols = Math.ceil(Math.sqrt(kids.length));
  const rows = Math.ceil(kids.length / cols);
  return kids.map((loc, i) => {
    const x = i % cols;
    const y = Math.floor(i / cols);
    return {
      loc,
      style: {
        left: `calc(${(x / cols) * 100}% + 2px)`,
        top: `calc(${(y / rows) * 100}% + 2px)`,
        width: `calc(${100 / cols}% - 4px)`,
        height: `calc(${100 / rows}% - 4px)`,
      },
    };
  });
}
