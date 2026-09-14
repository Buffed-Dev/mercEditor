import { registerMap } from '../src/data/maps/index.ts';
import { count, list, post, text } from './devServer.ts';
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
  const what = `write ${map.id}`;
  const body = await post('/__maps', what, {
    game,
    id: map.id,
    source: serializeMap(map, terrainCharOf(terrains)),
  });
  // Read rather than cast: an answer with no `file` in it means the write did
  // not happen the way this is about to report that it did.
  const file = text(body, 'file', what);
  // The file is written; this is the same map going into the registry the game
  // reads, so the editor stays open and the save is live at once.
  registerMap(structuredClone(map));
  return file;
}

/**
 * Move or rename a folder under a game's assets/.
 *
 * The bytes first, the document afterwards through `setPath` — so a request
 * that fails leaves the records saying where things really are, rather than
 * the other way round, which is a library that looks right and 404s.
 *
 * Not undoable, and not queued until save. A folder is real: it is somewhere
 * else the moment this returns, and a pending-move model would mean the tree
 * showing a shape the disk disagreed with. Uploading a file has always worked
 * this way too.
 */
export async function moveFolder(game: string, from: string, to: string): Promise<void> {
  await post('/__library', `move ${from}`, { game, moves: [{ from, to }] });
}

/** Make an empty folder under a game's assets/. */
export async function makeFolder(game: string, path: string): Promise<void> {
  await post('/__library', `make ${path}`, { game, mkdirs: [path] });
}

/**
 * Remove a folder and everything in it, or one file.
 *
 * The one call here that destroys something nothing else has a copy of, which
 * is why whatever asks has to have asked the person first — `usedBy` on the
 * document says what would break, and it can only speak for the rules.
 */
export async function removeFile(game: string, path: string, recursive = false): Promise<void> {
  await post('/__library', `delete ${path}`, { game, deletes: [{ path, recursive }] });
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
  const body = await post('/__data', 'write the rules', {
    game,
    files: serializeAllRules(data),
  });

  const written = await post('/__library', 'write the library', {
    game,
    writes: libraryWrites(data),
    prune: LIBRARY_KINDS_SAVED,
  });

  return list(body, 'files').length + count(written, 'wrote');
}
