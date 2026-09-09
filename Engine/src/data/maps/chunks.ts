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

import {
  MAP_LISTS,
  SPAWN_CHAR,
  type GameMap,
  type MapEnvInput,
  type MapObject,
  type Placed,
} from '../mapFormat.ts';

/** The object lists a chunk carries out of the map with it. */
const LISTS = MAP_LISTS;

export const CHUNK_ROLES = [
  ['', 'Filler'],
  ['start', 'Entrance'],
  ['end', 'Way down'],
] as const;

/** What a chunk is for: the way in, the way down, or neither. */
export type ChunkRole = (typeof CHUNK_ROLES)[number][0];

/** A rectangle of a hand-drawn map, cut out to be reused as a room. */
export type Chunk = {
  gx: number;
  gy: number;
  w: number;
  h: number;
  name: string;
  role: ChunkRole;
};

/** A chunk as a map file writes it. */
export type ChunkInput = Partial<Omit<Chunk, 'role'>> & { role?: string };

/** One chunk cut out and moved to its own origin, ready to be placed. */
export type ChunkPart = {
  id: string;
  name: string;
  role: ChunkRole;
  rows: string[];
  spawns: Record<string, Placed>;
  env: MapEnvInput;
  /** What an assembled run is called. Set by whoever supplies the parts. */
  clusterName?: string;
} & { [K in (typeof MAP_LISTS)[number]]: MapObject[] };

/** How many chunks a run places when the map does not say. */
export const DEFAULT_CHUNK_COUNT = 10;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function defaultChunk(gx = 0, gy = 0): Chunk {
  return { gx, gy, w: 8, h: 8, name: 'chunk', role: '' };
}

/** Fill in anything a hand-written chunk left out. Never smaller than a tile. */
export function normalizeChunk(chunk: ChunkInput = {}, index = 0): Chunk {
  const whole = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) ? Math.max(1, Math.round(value as number)) : fallback;
  return {
    gx: Number.isFinite(chunk.gx) ? Math.max(0, Math.round(chunk.gx as number)) : 0,
    gy: Number.isFinite(chunk.gy) ? Math.max(0, Math.round(chunk.gy as number)) : 0,
    w: whole(chunk.w, 8),
    h: whole(chunk.h, 8),
    name: chunk.name || `chunk${index + 1}`,
    role: chunk.role === 'start' || chunk.role === 'end' ? chunk.role : '',
  };
}

/** Whether this map is assembled from its chunks rather than walked as drawn. */
export const isGenerated = (map: GameMap | null | undefined): boolean =>
  Boolean(map?.generated) && (map?.chunks ?? []).length > 0;

/** How many pieces a run of this map places. */
export function chunkCount(map: { chunkCount?: unknown } | null | undefined): number {
  // Typed by the one field it reads rather than by GameMap, so the editor can
  // ask about the map it is part way through building.
  const wanted = map?.chunkCount;
  return typeof wanted === 'number' && Number.isFinite(wanted) && wanted > 0
    ? Math.round(wanted)
    : DEFAULT_CHUNK_COUNT;
}

/**
 * Cut the chunks out of a map, as the parts the generator fits together.
 *
 * Each comes out as an ordinary little map — its own rows, its own objects,
 * everything moved so its top-left corner is the origin — because that is what
 * the generator already knows how to rotate and place.
 */
export function chunksOf(map: GameMap): ChunkPart[] {
  const chunks = (map?.chunks ?? []).map((chunk, index) =>
    normalizeChunk(chunk as ChunkInput, index),
  );
  const env = clone(map?.env ?? {});

  // The seven lists are reached by name, which an object type cannot be
  // indexed by on its own. One cast here beats seven near-identical branches.
  const lists = map as unknown as Record<string, readonly MapObject[] | undefined>;

  return chunks.map((chunk) => {
    const inside = (o: Placed) =>
      o.gx >= chunk.gx && o.gx < chunk.gx + chunk.w && o.gy >= chunk.gy && o.gy < chunk.gy + chunk.h;
    const move = <T extends Placed>(o: T): T => ({
      ...o,
      gx: o.gx - chunk.gx,
      gy: o.gy - chunk.gy,
    });

    // Short rows and a short grid are both possible: a chunk may hang off the
    // edge of what has been drawn, and the missing part is simply floor.
    const rows = Array.from({ length: chunk.h }, (_, i) => {
      const row = map.rows?.[chunk.gy + i] ?? '';
      return row.slice(chunk.gx, chunk.gx + chunk.w).padEnd(chunk.w, '.');
    });

    const spawns: Record<string, Placed> = {};
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
    } as ChunkPart;
    for (const list of LISTS) {
      part[list] = clone((lists[list] ?? []).filter(inside)).map(move);
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
export function strayCount(map: GameMap): number {
  const chunks = (map?.chunks ?? []).map((chunk, index) =>
    normalizeChunk(chunk as ChunkInput, index),
  );
  const lists = map as unknown as Record<string, readonly MapObject[] | undefined>;
  const covered = (gx: number, gy: number) =>
    chunks.some((c) => gx >= c.gx && gx < c.gx + c.w && gy >= c.gy && gy < c.gy + c.h);

  let strays = 0;
  (map?.rows ?? []).forEach((row, gy) => {
    [...row].forEach((char, gx) => {
      if (char !== '.' && !covered(gx, gy)) strays++;
    });
  });
  for (const list of LISTS) {
    strays += (lists[list] ?? []).filter((o) => !covered(o.gx, o.gy)).length;
  }
  return strays;
}
