/**
 * What the terrain paths cost, against the budgets written beside them.
 *
 * `terrainLayer.ts` names a threshold and the optimization to reach for when
 * it is crossed: a per-cell slot table keyed off the history rect, once a
 * 64x64 refresh measures over 2ms. It is the right call *when the number says
 * so*, and it is not worth its complexity before that. This is how to find out
 * which it is.
 *
 *   node --experimental-strip-types scripts/benchTerrain.ts
 *
 * The grid walk here is what `terrainLayer.refresh` does minus the upload to
 * the GPU: every cell's topology, then down its stack. The map it walks has
 * plateaus, holes and three terrains, because a flat field is the case that
 * flatters every one of these.
 */

import { createGrid, idx, type TerrainGrid } from '../Engine/src/data/terrain/grid.ts';
import { topologyOf, subSides } from '../Engine/src/data/terrain/mask.ts';
import { buildTemplates } from '../Engine/src/data/terrain/templates.ts';
import { normalizeRim, rimOf, DEFAULT_RIM } from '../Engine/src/data/terrain/profile.ts';
import { buildTerrainGeometry } from '../Engine/src/data/terrain/geometry.ts';

const LEVEL_H = 0.5;
const RIM = normalizeRim(DEFAULT_RIM);

/** A map with plateaus, holes and three terrains. */
function mapOf(cols: number, rows: number): TerrainGrid {
  const grid = createGrid(cols, rows);
  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const i = idx(grid, gx, gy);
      const n = Math.sin(gx * 0.21) * Math.cos(gy * 0.17) + Math.sin((gx + gy) * 0.09);
      if (n < -0.9) continue;
      grid.kind[i] = 1 + (Math.abs(Math.round(n * 3)) % 3);
      grid.level[i] = Math.max(0, Math.round(1.6 + n * 2));
    }
  }
  return grid;
}

function bench(name: string, budget: number | null, runs: number, fn: () => void): void {
  for (let i = 0; i < Math.min(runs, 20); i += 1) fn();
  const started = performance.now();
  for (let i = 0; i < runs; i += 1) fn();
  const each = (performance.now() - started) / runs;
  const verdict = budget === null ? '' : each > budget ? `  OVER ${budget}ms` : `  (budget ${budget}ms)`;
  console.log(`  ${name.padEnd(44)} ${each.toFixed(3)} ms${verdict}`);
}

/** `refresh()` without the upload: every cell's topology, then down its stack. */
function walk(grid: TerrainGrid): number {
  let blocks = 0;
  for (let gy = 0; gy < grid.rows; gy += 1) {
    for (let gx = 0; gx < grid.cols; gx += 1) {
      if (!grid.kind[idx(grid, gx, gy)]) continue;
      topologyOf(grid, gx, gy);
      blocks += 1;
      for (let at = grid.level[idx(grid, gx, gy)]! - 1; at >= 0; at -= 1) {
        if (!subSides(grid, gx, gy, at)) break;
        blocks += 1;
      }
    }
  }
  return blocks;
}

console.log('\nterrainLayer.refresh — the grid walk, budget 2ms at 64x64');
for (const size of [24, 64, 128]) {
  const grid = mapOf(size, size);
  bench(`${size}x${size} (${walk(grid)} blocks)`, size === 64 ? 2 : null, 200, () => walk(grid));
}

// Not a live path: the ground is drawn as instances of baked templates, and
// this is what that replaced. Kept here because it is what the numbers below
// are the alternative to — a couple of hundred quads a cell, once per tile.
console.log('\nbuildTerrainGeometry — whole-map build (no live caller)');
for (const size of [16, 24]) {
  const grid = mapOf(size, size);
  bench(`${size}x${size}`, null, 3, () =>
    buildTerrainGeometry(grid, { rim: RIM, levelH: LEVEL_H, baseY: -LEVEL_H }),
  );
}

console.log('\nbuildTemplates — one frame of dragging a rim slider');
{
  // A profile nobody has asked for before, which is what every frame of a drag
  // is, and then the templates a real map lights up.
  let width = 0.2;
  const tops = [0, 1, 3, 5, 7, 0x0b, 0x0f, 0x11, 0x13, 0x1f, 0x33, 0x77, 0xff];
  bench('bake the 18 templates a map uses', 4, 60, () => {
    const templates = buildTemplates(rimOf((width += 1e-6), 0.12), LEVEL_H);
    for (const topology of tops) templates.top(topology);
    for (const sides of [1, 3, 5, 7, 0x0f]) templates.sub(sides);
  });
}
console.log();
