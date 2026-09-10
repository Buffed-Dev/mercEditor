import { prefabObjects, type Prefab } from '../src/data/prefabs.ts';
import { pickedRows, rowsAsPrefab } from './prefabFromSelection.ts';
import type { MapDocument } from './document.ts';
import type { Selection } from './state/selection.ts';

/**
 * Copy and paste, for the things standing on a map.
 *
 * The clipboard is an arrangement remembered — which is what a prefab is,
 * minus the name and minus being written down. So it is one: the same
 * `normalizePrefab` that measures a prefab from its own corner measures this,
 * and the same `prefabObjects` that puts a placement's children on the map puts
 * a paste there. Two ways to say "these objects, together, at that tile" would
 * have been one too many.
 *
 * It lives in the module rather than in a document, so what you copied on one
 * map is still there when you open another — which is most of why anybody
 * reaches for copy and paste in a level editor at all.
 *
 * Not the system clipboard. That would mean a text format to serialise into
 * and parse back out of, a second one beside the map files, and the only thing
 * it would buy is pasting between two browser tabs.
 */

let held: Prefab | null = null;

/** How many objects are on the clipboard, for anything offering to paste. */
export const clipboardSize = (): number =>
  held ? Object.values(held).filter(Array.isArray).flat().length : 0;

/**
 * Remember what is picked, or what is selected if nothing is.
 *
 * Both, because Ctrl+C with one thing chosen means that thing — asking you to
 * pick it a second way first would be a rule with nothing behind it.
 *
 * @returns how many objects were copied
 */
export function copyObjects(
  doc: MapDocument,
  picked: ReadonlySet<string>,
  selection: Selection,
): number {
  const wanted =
    picked.size > 0
      ? picked
      : selection?.index !== undefined
        ? new Set([`${selection.list}:${selection.index}`])
        : new Set<string>();

  const rows = pickedRows(doc, wanted);
  if (!rows.length) return 0;

  held = rowsAsPrefab(rows, 'clipboard', 'Clipboard');
  return rows.length;
}

/**
 * Put what was copied down, with its top-left on the given tile.
 *
 * Its corner rather than its middle: a paste you can place by pointing at where
 * it starts is one you can line up against what is already there, and half a
 * tile of rounding is not something anybody wants to think about.
 *
 * Refused rather than clipped if any of it would land off the map. A map cannot
 * hold a tile that is not on it — `resize` drops those, and the serializer
 * would write coordinates no grid can read — so half a paste landing silently
 * is the one outcome worth spending a message on.
 *
 * Overlapping what is already there is allowed, unlike the Place tool, which
 * refuses a busy tile. A paste is a deliberate act on a group you already have,
 * and one that quietly dropped the two objects that happened to collide would
 * be worse than one you can see and move.
 *
 * One undo step.
 *
 * @returns why not, or null if it was pasted
 */
export function pasteObjects(doc: MapDocument, gx: number, gy: number): string | null {
  if (!held) return 'Nothing copied';

  const children = prefabObjects(held, { gx, gy });
  const all = Object.values(children).flat();
  if (!all.length) return 'Nothing copied';
  if (all.some((one) => !doc.inBounds(one.gx, one.gy))) {
    return 'That would put some of it off the map';
  }

  doc.checkpoint();
  for (const [list, made] of Object.entries(children)) {
    for (const one of made) doc.addObject(list, one, false);
  }
  return null;
}
