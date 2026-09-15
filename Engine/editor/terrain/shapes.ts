import { idx, type TerrainGrid } from '../../src/data/terrain/grid.ts';

/**
 * The cell sets the terrain tools work on, as flat indices.
 *
 * All pure and all bounds-clipped: a brush near the edge of the map returns
 * fewer cells rather than cells that are not there, so no caller has to check.
 */

/** A cell, and where inside it the pointer was when there was one: world x and z. */
export type Cell = { gx: number; gy: number; x?: number | undefined; z?: number | undefined };

const clip = (grid: TerrainGrid, gx: number, gy: number, out: number[]) => {
  if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows) return;
  out.push(idx(grid, gx, gy));
};

/**
 * A square brush centred on a cell.
 *
 * Odd widths only, because an even one has no middle: it would land half a cell
 * off the cursor and the tile you clicked would not be the tile you painted.
 */
export function brushCells(grid: TerrainGrid, at: Cell, size = 1): number[] {
  const width = Math.max(1, Math.round(size) | 1);
  const reach = (width - 1) / 2;
  const out: number[] = [];
  for (let gy = at.gy - reach; gy <= at.gy + reach; gy += 1) {
    for (let gx = at.gx - reach; gx <= at.gx + reach; gx += 1) clip(grid, gx, gy, out);
  }
  return out;
}

/** A rectangle between two corners, in either drag direction. */
export function rectCells(grid: TerrainGrid, a: Cell, b: Cell, filled = true): number[] {
  const x0 = Math.min(a.gx, b.gx);
  const x1 = Math.max(a.gx, b.gx);
  const y0 = Math.min(a.gy, b.gy);
  const y1 = Math.max(a.gy, b.gy);
  const out: number[] = [];
  for (let gy = y0; gy <= y1; gy += 1) {
    for (let gx = x0; gx <= x1; gx += 1) {
      if (!filled && gx !== x0 && gx !== x1 && gy !== y0 && gy !== y1) continue;
      clip(grid, gx, gy, out);
    }
  }
  return out;
}

/**
 * Every cell on the line from a to b, both ends included.
 *
 * Bresenham rather than sampling the segment at some step: any fixed step
 * either skips cells on a long throw or repeats them on a short one, and the
 * step that is right for both does not exist. Consecutive cells in the result
 * are always neighbours, which is the property "must not skip cells" actually
 * means.
 */
export function cellLine(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  let x = a.gx;
  let y = a.gy;
  const dx = Math.abs(b.gx - x);
  const sx = x < b.gx ? 1 : -1;
  const dy = -Math.abs(b.gy - y);
  const sy = y < b.gy ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    cells.push({ gx: x, gy: y });
    if (x === b.gx && y === b.gy) return cells;
    const e2 = 2 * err;
    // Both branches can fire on a perfect diagonal, which steps corner to
    // corner. That is what a diagonal line is; it is not a skipped cell.
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
