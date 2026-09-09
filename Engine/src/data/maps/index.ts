// The maps of whichever game this was built for. Finding the files is the
// game folder's own job — see Games/<Name>/game.js — so this only holds them.
import { maps as GAME_MAPS, startMap } from '#game';
import type { GameMap } from '../mapFormat.ts';

// `#game` is content, outside the type checker. Naming the two shapes once
// here keeps the `any` its exports would otherwise carry out of this module.
const gameMaps = GAME_MAPS as GameMap[];
const startMapId = startMap as string;

/**
 * A map file, as the registry holds it.
 *
 * Only the parts every map is guaranteed to have are named. The rest — the
 * object lists, the environment, the chunks — is what `mapFormat.ts` describes
 * and what `document.js` reads; naming all of it a second time here would be
 * two definitions to keep in step rather than one.
 *
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   terrain: string[],
 *   [key: string]: unknown,
 * }} MapFile
 */

/** @type {Record<string, MapFile>} */
export const MAPS: Record<string, GameMap> = {};

/**
 * Add or replace a map without reloading the page.
 *
 * The editor writes a map file and then says so here, because the alternative
 * is letting Vite notice the file and reload — which throws away whatever you
 * were part way through editing. The file on disk and this are the same map;
 * the reload was only ever how the two were kept in step.
 */
export function registerMap<T extends GameMap>(map: T): T {
  if (map?.id && map?.terrain) MAPS[map.id] = map;
  return map;
}

/**
 * Throw the registry away and fill it from another game's maps.
 *
 * Only the editor calls this, and only because it can open a game other than
 * the one it was loaded with. A running game has exactly one set of maps and
 * never reaches for this.
 */
/** @param {MapFile[]} list */
export function resetMaps(list: readonly GameMap[]): void {
  for (const id of Object.keys(MAPS)) delete MAPS[id];
  for (const map of list) registerMap(map);
}

for (const map of gameMaps) registerMap(map);

export const START_MAP = startMapId;

/** Everything the editor can open. */
export function mapIds(): string[] {
  return Object.keys(MAPS).sort();
}

/**
 * Everywhere a portal can lead.
 *
 * Every map, generated or not: a generated one is a whole place from outside,
 * whatever it does on the way in. Its chunks are not on the list because they
 * are not maps — they are rectangles drawn on this one.
 */
export function destinationIds(): string[] {
  return mapIds();
}

/**
 * The map behind an id.
 */
export function getMap(id: string): GameMap {
  const map = MAPS[id];
  if (!map) throw new Error(`Unknown map "${id}" (have: ${mapIds().join(', ')})`);
  // A generated map resolves to the run you are on: assembled the first time
  // you go in and kept after that, so stepping out to base and back is the same
  // dungeon. `endRun` is what makes the next one different.
  return isGenerated(map) ? currentRun(id) : map;
}

// At the bottom, and imported rather than re-exported for a reason: generate.js
// reads MAPS from here, so this pair is a cycle. It resolves because neither
// side touches the other until something is actually called.
import { isGenerated } from './chunks.ts';
import { currentRun } from './generate.ts';
