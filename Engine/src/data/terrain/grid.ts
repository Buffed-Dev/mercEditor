/**
 * The terrain grid: what is where, as two flat planes.
 *
 * Struct-of-arrays rather than an array of cell objects, because every consumer
 * reads one plane and ignores the rest — the topology pass wants `level` and
 * never `kind`, flood fill compares `kind` alone. Flat typed arrays keep those
 * scans linear, cost one allocation instead of one per cell, and survive
 * `structuredClone` intact, which is what makes undo cheap.
 *
 * At 64x64 the whole grid is 8 KB.
 *
 * **Empty is a state, not a height.** A cell with no terrain is not "level 0",
 * it is not there: it is what a hole in a platform and the sea around an island
 * are both made of, and it is what every exposed edge in the world is measured
 * against. `levelAt` returns null for it rather than 0, and code that writes
 * `?? 0` against that has quietly filled in the hole.
 *
 * There used to be a third plane, `slope`, and a `surfaceLevel` that varied
 * across a cell to read it. Ramps are gone: a tile is flat and steps to its
 * neighbours, so height is one number per cell and `levelAt` is the whole of it.
 */

/** `kind` 0. Every other value is an index into the map's terrain table, + 1. */
export const EMPTY = 0;

export type TerrainGrid = {
  cols: number;
  rows: number;
  level: Uint8Array;
  kind: Uint8Array;
  /**
   * Per-edge profile overrides, four per cell in side order (E, N, W, S): 0 is
   * "auto" — use the terrain's default profile — and n is `edgeIds[n - 1]`.
   *
   * Optional, so a grid built by hand (or by a map written before overrides
   * existed) simply has every edge on auto.
   */
  edges?: Uint8Array;
  /** Profile ids by edge value - 1. Append-only, like a map's terrain ids. */
  edgeIds?: string[];
};

/** "auto": an edge that wears its terrain's default profile. */
export const AUTO = 0;

export function createGrid(cols: number, rows: number): TerrainGrid {
  const n = Math.max(0, cols * rows);
  return {
    cols,
    rows,
    level: new Uint8Array(n),
    kind: new Uint8Array(n),
    edges: new Uint8Array(n * 4),
    edgeIds: [],
  };
}

/** The profile id an edge is overridden to, or '' for auto. */
export function edgeOverride(grid: TerrainGrid, gx: number, gy: number, side: number): string {
  if (!grid.edges || !inBounds(grid, gx, gy)) return '';
  const value = grid.edges[idx(grid, gx, gy) * 4 + (((side % 4) + 4) % 4)] ?? AUTO;
  return value === AUTO ? '' : (grid.edgeIds?.[value - 1] ?? '');
}

/**
 * The grid value for a profile id, adding it to the table if new. '' is auto.
 * Makes the edge plane on a grid that has none yet.
 */
export function edgeValueOf(grid: TerrainGrid, id: string): number {
  if (!grid.edges) grid.edges = new Uint8Array(grid.cols * grid.rows * 4);
  if (!grid.edgeIds) grid.edgeIds = [];
  if (!id) return AUTO;
  const at = grid.edgeIds.indexOf(id);
  if (at >= 0) return at + 1;
  grid.edgeIds.push(id);
  return grid.edgeIds.length;
}

export const idx = (grid: TerrainGrid, gx: number, gy: number): number => gy * grid.cols + gx;

export const inBounds = (grid: TerrainGrid, gx: number, gy: number): boolean =>
  gx >= 0 && gy >= 0 && gx < grid.cols && gy < grid.rows;

/** Which terrain, as a table index. `EMPTY` off the edge of the map. */
export const kindAt = (grid: TerrainGrid, gx: number, gy: number): number =>
  inBounds(grid, gx, gy) ? grid.kind[idx(grid, gx, gy)]! : EMPTY;

/** How tall the column is, or null where there is no column at all. */
export function levelAt(grid: TerrainGrid, gx: number, gy: number): number | null {
  if (!inBounds(grid, gx, gy)) return null;
  const i = idx(grid, gx, gy);
  return grid.kind[i] === EMPTY ? null : grid.level[i]!;
}

/**
 * The same grid at a new size, anchored top-left.
 *
 * New cells are empty rather than level-0 ground. Growing a map should reveal
 * space to build in, not conjure a floor across it — which is what the old
 * resize did, back when every cell had to have a height.
 */
export function resizeGrid(grid: TerrainGrid, cols: number, rows: number): TerrainGrid {
  const next = createGrid(cols, rows);
  const w = Math.min(cols, grid.cols);
  const h = Math.min(rows, grid.rows);
  for (let gy = 0; gy < h; gy += 1) {
    const from = gy * grid.cols;
    const to = gy * cols;
    next.level.set(grid.level.subarray(from, from + w), to);
    next.kind.set(grid.kind.subarray(from, from + w), to);
    if (grid.edges) next.edges!.set(grid.edges.subarray(from * 4, (from + w) * 4), to * 4);
  }
  next.edgeIds = [...(grid.edgeIds ?? [])];
  return next;
}

/** A deep copy. Used by undo, and by anything that wants to compare before/after. */
export const cloneGrid = (grid: TerrainGrid): TerrainGrid => ({
  cols: grid.cols,
  rows: grid.rows,
  level: grid.level.slice(),
  kind: grid.kind.slice(),
  ...(grid.edges ? { edges: grid.edges.slice() } : {}),
  ...(grid.edgeIds ? { edgeIds: [...grid.edgeIds] } : {}),
});

/** True when no cell anywhere has terrain. A map like this draws nothing. */
export const isEmptyGrid = (grid: TerrainGrid): boolean => !grid.kind.some((k) => k !== EMPTY);
