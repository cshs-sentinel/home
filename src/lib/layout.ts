import type { Block, Location } from './types';

export function blockOf(l: Location): Block | null {
  if (l.layout_x === null || l.layout_y === null || l.layout_w === null || l.layout_h === null) return null;
  return { x: l.layout_x, y: l.layout_y, w: l.layout_w, h: l.layout_h };
}

export function clampBlock(b: Block, cols: number, rows: number): Block {
  const w = Math.max(1, Math.min(b.w, cols));
  const h = Math.max(1, Math.min(b.h, rows));
  return { w, h, x: Math.max(0, Math.min(b.x, cols - w)), y: Math.max(0, Math.min(b.y, rows - h)) };
}

export function overlaps(a: Block, b: Block): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function childrenIndex(locations: Location[]): Map<string | null, Location[]> {
  const index = new Map<string | null, Location[]>();
  for (const l of locations) index.set(l.parent_id, [...(index.get(l.parent_id) ?? []), l]);
  return index;
}

// Every place id inside `rootId`, including itself.
export function subtreeIds(rootId: string, index: Map<string | null, Location[]>): Set<string> {
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of index.get(id) ?? []) {
      if (!out.has(child.id)) {
        out.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return out;
}

export function pathTo(id: string | null, locations: Location[]): Location[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const path: Location[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current && path.length < 100) {
    path.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

export function blockStyle(b: Block, cols: number, rows: number) {
  return {
    left: `${(b.x / cols) * 100}%`,
    top: `${(b.y / rows) * 100}%`,
    width: `${(b.w / cols) * 100}%`,
    height: `${(b.h / rows) * 100}%`,
  };
}

// "Admin › 1st Floor › Room 101". The campus is left out when there is only one.
export function placeLabel(id: string | null, locations: Location[]): string {
  if (!id) return 'No location';
  const path = pathTo(id, locations);
  if (!path.length) return 'Unknown location';
  const singleCampus = locations.filter((l) => !l.parent_id).length === 1;
  const shown = singleCampus && path.length > 1 ? path.slice(1) : path;
  return shown.map((p) => p.name).join(' › ');
}

// Mirrors public.location_fits(): Campus > Building > Floor or wing > Room,
// and other locations (level 5) inside a campus, building, or floor.
export function locationFits(childLevel: number, parentLevel: number | null): boolean {
  if (parentLevel === null) return childLevel === 1;
  if (childLevel === 5) return parentLevel >= 1 && parentLevel <= 3;
  return parentLevel < 5 && childLevel === parentLevel + 1;
}
