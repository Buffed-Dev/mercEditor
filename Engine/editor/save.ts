import { registerMap } from '../src/data/maps/index.ts';
import type { EditorMap } from './serialize.ts';
import type { Terrain } from '../src/data/terrains.ts';
import type { RuleKind } from './serializeData.ts';
import { serializeMap } from './serialize.ts';
import { LIBRARY_KINDS_SAVED, libraryWrites, serializeAllRules } from './serializeData.ts';

/**
 * Writing the game folder back, through the dev server.
 *
 * The browser cannot write files, so the editor posts serialized *module
 * source* and the dev plugin puts it on disk — which is why what lands in
 * Games/ is readable, reviewable JavaScript rather than a blob.
 *
 * Only the writing lives here. What to say about it afterwards, and what to
 * re-render, belong to whichever interface asked — which is what lets the same
 * two functions serve both.
 */

/** A terrain id to the two-character key a map's rows are written in. */
export const terrainCharOf =
  (terrains: readonly Terrain[]) =>
  (id: string): string =>
    terrains.find((terrain) => terrain.id === id)?.char ?? '';

/**
 * Write one map module into the game folder.
 *
 * @returns {Promise<string>} the file that was written
 */
export async function writeMap(
  game: string,
  map: EditorMap,
  terrains: readonly Terrain[],
): Promise<string> {
  const response = await fetch('/__maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      game,
      id: map.id,
      source: serializeMap(map, terrainCharOf(terrains)),
    }),
  });
  const body = (await response.json()) as { error?: string; file: string };
  if (!response.ok) throw new Error(body.error ?? 'Save failed');
  // The file is written; this is the same map going into the registry the game
  // reads, so the editor stays open and the save is live at once.
  registerMap(structuredClone(map));
  return body.file;
}

/**
 * Write a document back: the rules as modules, the library as record files.
 *
 * Two requests, because the two halves live in different shapes on disk. The
 * rules are nine modules under rules/ and go together in one batch, since they
 * reference each other and a partial write would leave an effect pointing at
 * an attribute that is not there yet. The library is a json file per record,
 * each inside the folder holding the pictures it names.
 *
 * The library half is declarative: it sends every record it has and names the
 * kinds it is answering for, and the server removes any record file of those
 * kinds that was not sent. That is what makes deleting a record stick without
 * a delete request of its own. It prunes record json only — never a picture or
 * a model, which are bytes nothing else has a copy of.
 *
 * Rules first. If the second half fails, what is on disk is the old library
 * and the new rules, which is the pair that still opens.
 *
 * @returns {Promise<number>} how many files were written
 */
export async function writeRules(
  game: string,
  data: Partial<Record<RuleKind, unknown>>,
): Promise<number> {
  const response = await fetch('/__data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game, files: serializeAllRules(data) }),
  });
  const body = (await response.json()) as { error?: string; files: unknown[] };
  if (!response.ok) throw new Error(body.error ?? 'Save failed');

  const writes = libraryWrites(data);
  const library = await fetch('/__library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game, writes, prune: LIBRARY_KINDS_SAVED }),
  });
  const written = (await library.json()) as { error?: string; wrote?: number };
  if (!library.ok) throw new Error(written.error ?? 'Saving the library failed');

  return body.files.length + (written.wrote ?? 0);
}
