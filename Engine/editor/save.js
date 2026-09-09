import { registerMap } from '../src/data/maps/index.js';
import { serializeMap } from './serialize.js';
import { serializeAllRules } from './serializeData.js';

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
export const terrainCharOf = (terrains) => (id) =>
  terrains.find((terrain) => terrain.id === id)?.char ?? '';

/**
 * Write one map module into the game folder.
 *
 * @returns {Promise<string>} the file that was written
 */
export async function writeMap(game, map, terrains) {
  const response = await fetch('/__maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      game,
      id: map.id,
      source: serializeMap(map, terrainCharOf(terrains)),
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Save failed');
  // The file is written; this is the same map going into the registry the game
  // reads, so the editor stays open and the save is live at once.
  registerMap(structuredClone(map));
  return body.file;
}

/**
 * Write every rules list into the game's rules/ folder.
 *
 * All of them in one request: they reference each other, so a partial write
 * would leave an effect pointing at an attribute that is not there yet.
 *
 * @returns {Promise<number>} how many files were written
 */
export async function writeRules(game, data) {
  const response = await fetch('/__data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game, files: serializeAllRules(data) }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Save failed');
  return body.files.length;
}
