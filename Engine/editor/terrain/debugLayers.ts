import { EMPTY, idx, kindAt, type TerrainGrid } from '../../src/data/terrain/grid.ts';
import { sidesOf, topologyOf } from '../../src/data/terrain/mask.ts';
import { shapeOf } from '../../src/data/terrain/templates.ts';

/**
 * Ways of looking at the terrain data itself.
 *
 * The map draws what the terrain *means*; these draw what it *is*. When a block
 * comes out wearing the wrong lid the question is always which neighbourhood
 * the grid thinks that cell is in, and there is no way to see that from the
 * outside — the answer is baked into a mesh by the time anything is visible.
 *
 * Each layer is a pure reading of the grid, so a wrong picture here is a wrong
 * grid rather than a rendering fault, which is exactly what makes them worth
 * having.
 */

export type DebugLayer = {
  id: string;
  label: string;
  hint: string;
  /** The cells to outline, as indices into the grid. */
  cells: (grid: TerrainGrid) => number[];
};

/** Walk every cell that has ground, handing the caller its topology. */
function scan(grid: TerrainGrid, keep: (topology: number, at: number) => boolean): number[] {
  const cells: number[] = [];
  for (let gy = 0; gy < grid.rows; gy += 1) {
    for (let gx = 0; gx < grid.cols; gx += 1) {
      if (kindAt(grid, gx, gy) === EMPTY) continue;
      const topology = topologyOf(grid, gx, gy);
      if (topology === null) continue;
      const at = idx(grid, gx, gy);
      if (keep(topology, at)) cells.push(at);
    }
  }
  return cells;
}

export const DEBUG_LAYERS: readonly DebugLayer[] = [
  {
    id: 'occupied',
    label: 'Occupied',
    hint: 'Every cell that has ground in it. What the grid holds, whatever it draws as.',
    cells: (grid) => scan(grid, () => true),
  },
  {
    id: 'exposed',
    label: 'Exposed',
    hint: 'Cells with a drop on at least one side — the ones that wear a cliff.',
    cells: (grid) => scan(grid, (topology) => sidesOf(topology) !== 0),
  },
  {
    id: 'corners',
    label: 'Corners',
    hint: 'Cells the grid reads as a corner piece, where two edges meet.',
    cells: (grid) => scan(grid, (topology) => shapeOf(topology).shape === 'corner'),
  },
  {
    id: 'turned',
    label: 'Turned',
    hint: 'Cells whose block is rotated. A lid facing the wrong way shows up here.',
    cells: (grid) => scan(grid, (topology) => shapeOf(topology).rot !== 0),
  },
];

export const layerById = (id: string) => DEBUG_LAYERS.find((layer) => layer.id === id) ?? null;
