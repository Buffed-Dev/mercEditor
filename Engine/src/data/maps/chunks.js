/**
 * Chunks: the pieces a generated map is assembled out of.
 *
 * A chunk is a named rectangle on the map's own grid. You draw the whole
 * dungeon on one canvas — rooms side by side with gaps between them — and mark
 * off which rectangles are the pieces; generation cuts those out and fits them
 * together into the map you actually walk.
 *
 * They live on the map rather than in files of their own because they are parts
 * of one place. The alternative — a file per piece, tied together by a shared
 * name — meant the editor had to paste them onto a canvas to show them and cut
 * them apart again to save, and anything the cutting did not know about was
 * lost on the way through. There is nothing to cut apart now: the canvas *is*
 * the file.
 *
 * Whatever is not inside a chunk is not part of anything. That is not a
 * mistake to guard against — it is the margin you draw in, and how you keep a
 * room you are not using yet.
 */

import { SPAWN_CHAR } from '../mapFormat.js';

/** The object lists a chunk carries out of the map with it. */
const LISTS = ['walls', 'portals', 'monsters', 'torches', 'stations', 'lights', 'doors'];

export const CHUNK_ROLES = [
  ['', 'Filler'],
  ['start', 'Entrance'],
  ['end', 'Way down'],
];

/** How many chunks a run places when the map does not say. */
export const DEFAULT_CHUNK_COUNT = 10;

const clone = (value) => JSON.parse(JSON.stringify(value));

export function defaultChunk(gx = 0, gy = 0) {
  return { gx, gy, w: 8, h: 8, name: 'chunk', role: '' };
}

/** Fill in anything a hand-written chunk left out. Never smaller than a tile. */
export function normalizeChunk(chunk = {}, index = 0) {
  const whole = (value, fallback) =>
    Number.isFinite(value) ? Math.max(1, Math.round(value)) : fallback;
  return {
    gx: Number.isFinite(chunk.gx) ? Math.max(0, Math.round(chunk.gx)) : 0,
    gy: Number.isFinite(chunk.gy) ? Math.max(0, Math.round(chunk.gy)) : 0,
    w: whole(chunk.w, 8),
    h: whole(chunk.h, 8),
    name: chunk.name || `chunk${index + 1}`,
    role: chunk.role === 'start' || chunk.role === 'end' ? chunk.role : '',
  };
}

/** Whether this map is assembled from its chunks rather than walked as drawn. */
export const isGenerated = (map) => Boolean(map?.generated) && (map?.chunks ?? []).length > 0;

/** How many pieces a run of this map places. */
export function chunkCount(map) {
  const wanted = map?.chunkCount;
  return Number.isFinite(wanted) && wanted > 0 ? Math.round(wanted) : DEFAULT_CHUNK_COUNT;
}

/**
 * Cut the chunks out of a map, as the parts the generator fits together.
 *
 * Each comes out as an ordinary little map — its own rows, its own objects,
 * everything moved so its top-left corner is the origin — because that is what
 * the generator already knows how to rotate and place.
 */
export function chunksOf(map) {
  const chunks = (map?.chunks ?? []).map(normalizeChunk);
  const env = clone(map?.env ?? {});

  return chunks.map((chunk) => {
    const inside = (o) =>
      o.gx >= chunk.gx && o.gx < chunk.gx + chunk.w && o.gy >= chunk.gy && o.gy < chunk.gy + chunk.h;
    const move = (o) => ({ ...o, gx: o.gx - chunk.gx, gy: o.gy - chunk.gy });

    // Short rows and a short grid are both possible: a chunk may hang off the
    // edge of what has been drawn, and the missing part is simply floor.
    const rows = Array.from({ length: chunk.h }, (_, i) => {
      const row = map.rows?.[chunk.gy + i] ?? '';
      return row.slice(chunk.gx, chunk.gx + chunk.w).padEnd(chunk.w, '.');
    });

    const spawns = {};
    for (const [name, at] of Object.entries(map?.spawns ?? {})) {
      if (inside(at)) spawns[name] = move(at);
    }

    const part = {
      id: chunk.name,
      name: chunk.name,
      role: chunk.role,
      rows,
      spawns,
      env,
    };
    for (const list of LISTS) {
      part[list] = clone((map?.[list] ?? []).filter(inside)).map(move);
    }

    // The arrival tile belongs to the entrance. A '@' in any other chunk is one
    // the parser would silently prefer, so it does not travel.
    if (chunk.role !== 'start') {
      part.rows = part.rows.map((row) => row.split(SPAWN_CHAR).join('.'));
    }
    return part;
  });
}

/**
 * What is drawn on the map but inside no chunk, and would not be generated.
 *
 * For the editor to say so out loud. A room you have drawn and not marked off
 * is the easiest thing in the world to not notice.
 */
export function strayCount(map) {
  const chunks = (map?.chunks ?? []).map(normalizeChunk);
  const covered = (gx, gy) =>
    chunks.some((c) => gx >= c.gx && gx < c.gx + c.w && gy >= c.gy && gy < c.gy + c.h);

  let strays = 0;
  (map?.rows ?? []).forEach((row, gy) => {
    [...row].forEach((char, gx) => {
      if (char !== '.' && !covered(gx, gy)) strays++;
    });
  });
  for (const list of LISTS) {
    strays += (map?.[list] ?? []).filter((o) => !covered(o.gx, o.gy)).length;
  }
  return strays;
}
