import { PREFAB_LISTS, normalizePrefab, type Prefab } from '../src/data/prefabs.ts';
import { blankMap } from './document.ts';
import type { GameMap, MapObject } from '../src/data/mapFormat.ts';

/**
 * A prefab, as a map you can open — and back again.
 *
 * The whole reason a prefab is shaped like a map is so that editing one needs
 * no second editor: `createDocument` opens this, the object tree walks it, the
 * inspector edits it, the tools place into it. These two functions are the
 * entire adaptation.
 *
 * The map they make is a scratch surface, not a thing that is saved. Its id
 * carries a prefix no map file could be called, so a prefab left open cannot be
 * mistaken for a map on the way to disk.
 */

/** No map file can be called this, which is the point. */
export const PREFAB_MAP = '__prefab:';

/** How much bare floor a prefab is edited on, past its own footprint. */
const MARGIN = 3;

/**
 * A prefab opened as a map.
 *
 * Floored rather than left empty. A prefab brings no ground with it — that is
 * what makes it droppable anywhere — but building one over a void means judging
 * by the grid lines alone, and every object sitting at the same height reads as
 * a row of things floating. One terrain, level 0, everywhere: something to
 * stand on that is thrown away on the way back out.
 *
 * @param prefab what to open
 * @param floor which terrain to lay down, or none if the game has no terrains
 */
export function prefabToMap(prefab: Prefab, floor = ''): GameMap {
  const cols = Math.max(prefab.w, 1) + MARGIN * 2;
  const rows = Math.max(prefab.h, 1) + MARGIN * 2;
  const map = blankMap(`${PREFAB_MAP}${prefab.id}`, cols, rows) as Record<string, unknown>;

  // Placed in from the corner, so there is room to work on every side of it and
  // so the turn of a prefab has somewhere to swing.
  for (const list of PREFAB_LISTS) {
    map[list] = prefab[list].map((one) => ({ ...one, gx: one.gx + MARGIN, gy: one.gy + MARGIN }));
  }

  // No fog. The default weather is tuned for a map you walk across, and its
  // reach is most of the way over a surface this size -- so a prefab would be
  // judged through a haze and come out lit for a fog that is not there where it
  // is finally placed.
  map.env = { ...(map.env as Record<string, unknown>), fog: false };

  if (floor) {
    map.terrainKeys = { aa: floor };
    map.terrain = Array.from({ length: rows }, () => 'aa'.repeat(cols));
    map.height = Array.from({ length: rows }, () => '.'.repeat(cols));
  }
  return map as unknown as GameMap;
}

/**
 * What was built on that surface, as a prefab again.
 *
 * Terrain, spawns, chunks and env do not come back: the floor was scenery for
 * the editing, and a prefab is what stands on the ground rather than the ground.
 *
 * The margin is not subtracted here. `normalizePrefab` moves whatever it is
 * given to its own corner, so wherever on the surface you built it, it comes
 * back measured from its own top-left — which also means a prefab dragged
 * around while being edited does not drift.
 */
export function mapToPrefab(map: GameMap, was: Prefab): Prefab {
  const lists: Record<string, MapObject[]> = {};
  const from = map as unknown as Record<string, MapObject[] | undefined>;
  for (const list of PREFAB_LISTS) lists[list] = [...(from[list] ?? [])];
  return normalizePrefab({ id: was.id, label: was.label, path: was.path, ...lists });
}

/**
 * Whether a document is a prefab being edited rather than a map.
 *
 * For anything that would otherwise write it to `maps/`.
 */
export const isPrefabMap = (id: unknown): boolean => String(id ?? '').startsWith(PREFAB_MAP);

/** Whether anything has been built on the surface yet, for an empty state. */
export function prefabIsEmpty(map: GameMap): boolean {
  const from = map as unknown as Record<string, MapObject[] | undefined>;
  return PREFAB_LISTS.every((list) => !(from[list] ?? []).length);
}

/** The tile a prefab's own corner sits on, for the grid overlay. See MARGIN. */
export const PREFAB_ORIGIN = MARGIN;
