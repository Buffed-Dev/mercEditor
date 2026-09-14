/**
 * The terrain half of a map file, to and from text.
 *
 * A map is a hand-editable ES module, and terrain is the part of it a person
 * most wants to read — so it is written as rows you can see the shape of:
 *
 *   height   one char per cell: '.' at level 0, '1'-'9' above it
 *   terrain  two chars per cell: a key from the map's own legend, '..' empty
 *
 * A map written before ramps were removed also carries a `tops` list. It is read
 * and dropped: those cells become ordinary flat ground, and the list is gone the
 * next time the map is saved.
 *
 * Two chars for terrain rather than one because one runs out at twenty-six, and
 * because the old format's "widen every row when a two-char name appears" is
 * how a resized map lost its ground. It is always two. There is nothing to get
 * wrong.
 *
 * **The legend lives in the map, not in the rules.** A map that read its keys
 * out of the terrain records would repaint itself the moment somebody renamed a
 * terrain's letter — silently, across every cell. Writing the legend down means
 * a map means the same thing forever, and it means you can read the file.
 */

import { createGrid, idx, EMPTY, type TerrainGrid } from './grid.ts';

/** Level 0 is '.' rather than '0': it is what a hand-written map already uses. */
export const EMPTY_KEY = '..';
export const GROUND_CHAR = '.';
export const MAX_LEVEL = 9;
const KEY_WIDTH = 2;

export type TerrainRows = {
  height: string[];
  terrain: string[];
  /** Two-char key to terrain id. The map's own legend. */
  terrainKeys: Record<string, string>;
  /** Ramps, from map files written before they were removed. Read and dropped. */
  tops?: unknown[];
};

export type DecodeResult = {
  grid: TerrainGrid;
  /** Terrain ids by table index - 1, so kind 1 is terrainIds[0]. */
  terrainIds: string[];
  problems: string[];
};

const levelChar = (level: number): string => {
  const clamped = Math.min(MAX_LEVEL, Math.max(0, Math.round(level)));
  return clamped === 0 ? GROUND_CHAR : String(clamped);
};

const levelFromChar = (char: string): number => {
  const level = Number.parseInt(char, 10);
  return Number.isNaN(level) ? 0 : Math.min(MAX_LEVEL, Math.max(0, level));
};

/**
 * A two-char key for a terrain, from whatever its record calls itself.
 *
 * One-char names are doubled rather than padded, because a pad character is a
 * character a name could also contain: "gg" reads as grass where "g " reads as
 * a bug. Collisions fall back to a numbered key, which is ugly and correct;
 * validation reports the clash so it can be fixed in the record.
 */
export function terrainKeys(
  ids: readonly string[],
  charOf: (id: string) => string,
): Record<string, string> {
  const keys: Record<string, string> = {};
  const taken = new Set([EMPTY_KEY]);
  ids.forEach((id, index) => {
    const raw = (charOf(id) || id.slice(0, 2) || 'x').replace(/\s/g, '').slice(0, KEY_WIDTH);
    let key = raw.length === 1 ? raw + raw : raw;
    if (key.length < KEY_WIDTH) key = 'xx';
    let bump = index + 1;
    while (taken.has(key)) key = String(bump++).padStart(KEY_WIDTH, '0').slice(-KEY_WIDTH);
    taken.add(key);
    keys[key] = id;
  });
  return keys;
}

/** The grid as rows, plus the legend needed to read them back. */
export function encodeTerrain(
  grid: TerrainGrid,
  terrainIds: readonly string[],
  charOf: (id: string) => string = () => '',
): TerrainRows {
  const keys = terrainKeys(terrainIds, charOf);
  const keyByKind = ['', ...Object.keys(keys)];

  const height: string[] = [];
  const terrain: string[] = [];

  for (let gy = 0; gy < grid.rows; gy += 1) {
    let heightRow = '';
    let terrainRow = '';
    for (let gx = 0; gx < grid.cols; gx += 1) {
      const i = idx(grid, gx, gy);
      const kind = grid.kind[i]!;
      if (kind === EMPTY) {
        heightRow += GROUND_CHAR;
        terrainRow += EMPTY_KEY;
        continue;
      }
      heightRow += levelChar(grid.level[i]!);
      terrainRow += keyByKind[kind] ?? EMPTY_KEY;
    }
    height.push(heightRow);
    terrain.push(terrainRow);
  }

  return { height, terrain, terrainKeys: keys };
}

/**
 * Rows back into a grid.
 *
 * Every disagreement in the file is reported rather than quietly resolved. A
 * short row, an unknown key, a height under an empty cell: each is something a
 * hand-edit did, and each is worth a message naming where. The decoder still
 * returns a usable grid — refusing to open a map because one cell is odd is
 * worse than opening it and saying so.
 */
export function decodeTerrain(
  rows: TerrainRows | { terrain?: unknown; terrainIds?: string[] } | null | undefined,
): DecodeResult {
  // The editor hands over a document whose terrain is already the live grid,
  // where a map file hands over rows. Both arrive here because both go on to
  // build a World, and this is the one place that knows how to read either.
  const live = rows?.terrain as TerrainGrid | undefined;
  if (live && live.kind instanceof Uint8Array) {
    return {
      grid: live,
      terrainIds: (rows as { terrainIds?: string[] }).terrainIds ?? [],
      problems: [],
    };
  }

  const problems: string[] = [];
  const tops = (rows as TerrainRows)?.tops;
  if (Array.isArray(tops) && tops.length) {
    problems.push(`${tops.length} ramps were dropped: terrain no longer slopes`);
  }
  const height = (rows as TerrainRows)?.height ?? [];
  const terrain = ((rows as TerrainRows)?.terrain as string[]) ?? [];
  const keys = (rows as TerrainRows)?.terrainKeys ?? {};

  const terrainIds = Object.values(keys);
  const kindByKey = new Map(Object.keys(keys).map((key, index) => [key, index + 1]));

  // Width comes from the widest row, not the first one. Taking it from the
  // first lets a truncated row silently redefine how big the map is, and then
  // every full row reads as too long — the damage reported at the wrong end.
  const cols = Math.max(
    0,
    ...height.map((row) => row.length),
    ...terrain.map((row) => Math.ceil(row.length / KEY_WIDTH)),
  );
  const rowCount = Math.max(height.length, terrain.length);
  const grid = createGrid(cols, rowCount);
  if (!cols || !rowCount) return { grid, terrainIds, problems };

  for (let gy = 0; gy < rowCount; gy += 1) {
    const terrainRow = terrain[gy] ?? '';
    const heightRow = height[gy] ?? '';
    if (terrainRow.length !== cols * KEY_WIDTH) {
      problems.push(
        `terrain row ${gy} is ${terrainRow.length} chars, expected ${cols * KEY_WIDTH}`,
      );
    }
    if (heightRow.length !== cols) {
      problems.push(`height row ${gy} is ${heightRow.length} chars, expected ${cols}`);
    }

    for (let gx = 0; gx < cols; gx += 1) {
      const key = terrainRow.slice(gx * KEY_WIDTH, gx * KEY_WIDTH + KEY_WIDTH);
      // The terrain row is authoritative about whether a cell exists. Off the
      // end of a short row is empty, not "the first terrain" — the old format
      // filled that in, and every eastern edge cell believed it had a neighbour.
      if (key === EMPTY_KEY || key.length < KEY_WIDTH) {
        const level = levelFromChar(heightRow[gx] ?? GROUND_CHAR);
        if (level > 0) problems.push(`cell ${gx},${gy} is empty but stands at level ${level}`);
        continue;
      }
      const kind = kindByKey.get(key);
      if (!kind) {
        problems.push(`cell ${gx},${gy} uses key "${key}", which the map's legend does not define`);
        continue;
      }
      const i = idx(grid, gx, gy);
      grid.kind[i] = kind;
      grid.level[i] = levelFromChar(heightRow[gx] ?? GROUND_CHAR);
    }
  }

  return { grid, terrainIds, problems };
}
