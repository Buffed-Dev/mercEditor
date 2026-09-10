import { PREFAB_LISTS, normalizePrefab, prefabObjects, type Prefab, type PlacedPrefab } from '../src/data/prefabs.ts';
import { objectRows } from './schema.ts';
import { rowId } from './state/selection.ts';
import type { DataDocument } from './dataDocument.ts';
import type { MapDocument } from './document.ts';
import type { MapObject } from '../src/data/mapFormat.ts';

/**
 * Turning what is on the map into a prefab, and back again.
 *
 * Both directions in one file because they are the same fact read two ways: a
 * prefab is objects, and a placement is a prefab. Making one has to leave the
 * map looking exactly as it did, and unpacking has to give back exactly what
 * was drawn — which it does by calling the very function the renderer uses, so
 * there is no second copy of the rotation to get wrong.
 *
 * Free functions rather than methods on the document, because both need the map
 * document *and* the rules document, and the map document has no business
 * knowing the rules exist.
 */

/** Lists a prefab can hold, as a set, for testing membership. */
const CARRIES = new Set<string>(PREFAB_LISTS);

/**
 * Make a prefab out of the picked objects, and stand one where they were.
 *
 * One undo step. The document is checkpointed once and everything after it is
 * written uncheckpointed, which is the escape hatch `checkpoint` exists for:
 * this is many writes and one decision.
 *
 * Removed in descending order within each list, because removing shifts every
 * index after it — ascending, the second removal would take the wrong object.
 *
 * @returns the prefab that was made, or a reason it could not be
 */
export function prefabFromSelection(
  doc: MapDocument,
  picked: ReadonlySet<string>,
  rules: DataDocument,
  id: string,
): { prefab: Prefab; index: number } | string {
  const rows = objectRows(doc.map as unknown as Record<string, unknown>).filter(
    (row) =>
      row.index !== undefined &&
      CARRIES.has(row.list) &&
      picked.has(rowId({ list: row.list, index: row.index, key: row.key })),
  );
  // A spawn is a name for a tile rather than a thing standing on it, and a
  // chunk is a rectangle drawn *around* things. Neither is content, so neither
  // is offered -- `CARRIES` is what says so.
  if (!rows.length) return 'Pick some objects first';

  const tiles = rows.map((row) => row.entry as unknown as MapObject);
  const ox = Math.min(...tiles.map((one) => one.gx));
  const oy = Math.min(...tiles.map((one) => one.gy));

  const lists: Record<string, MapObject[]> = {};
  for (const row of rows) {
    const one = row.entry as unknown as MapObject;
    (lists[row.list] ??= []).push({
      ...structuredClone(one),
      gx: one.gx - ox,
      gy: one.gy - oy,
    });
  }

  const made = rules.add('prefabs');
  if (!made) return 'Could not make a prefab';
  const held = rules.list('prefabs')[made.index];
  rules.update('prefabs', made.index, {
    ...normalizePrefab({ ...lists, id: String(held.id), label: id, path: String(held.path ?? '') }),
  });

  doc.checkpoint();
  // Grouped by list and taken from the back, so the indices still standing are
  // the ones this has not reached yet.
  const byList = new Map<string, number[]>();
  for (const row of rows) {
    if (row.index === undefined) continue;
    const seen = byList.get(row.list) ?? [];
    seen.push(row.index);
    byList.set(row.list, seen);
  }
  for (const [list, indices] of byList) {
    for (const index of [...indices].sort((a, b) => b - a)) {
      doc.removeObject(list, index, false);
    }
  }
  const index = doc.addPrefab(String(held.id), ox, oy, false);

  return { prefab: rules.list('prefabs')[made.index] as unknown as Prefab, index };
}

/**
 * Explode a placement back into the objects it stood for.
 *
 * The way out when a prefab is nearly right: unpack it, change the one thing,
 * and the map keeps loose objects. It is deliberately not reversible into the
 * prefab — that is what making one from a selection is for.
 *
 * The children come from `prefabObjects`, which is what expansion calls, so an
 * unpacked prefab is exactly what was on screen a moment before. The marker
 * saying which placement drew a child is dropped: these are the map's now.
 *
 * One undo step, like making one.
 */
export function unpackPrefab(
  doc: MapDocument,
  index: number,
  prefabOf: (id: string) => Prefab | null,
): string | null {
  const at = doc.map.prefabs?.[index];
  if (!at) return 'Nothing to unpack';
  const prefab = prefabOf(String(at.id ?? ''));
  if (!prefab) return `No prefab called "${String(at.id ?? '')}"`;

  const children = prefabObjects(prefab, at as unknown as PlacedPrefab);

  doc.checkpoint();
  for (const [list, made] of Object.entries(children)) {
    for (const child of made) {
      const { prefab: _drawnBy, ...loose } = child;
      doc.addObject(list, loose, false);
    }
  }
  doc.removeObject('prefabs', index, false);
  return null;
}
