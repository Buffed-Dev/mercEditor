/**
 * ASCII fixtures for terrain topology tests.
 *
 * '-' is empty, a digit is an occupied cell at that level. Terrain kind is 1
 * everywhere unless a second grid of letters says otherwise, because almost
 * every topology question is about shape and must not be able to see type.
 */
import { createGrid, idx, type TerrainGrid } from '../../Engine/src/data/terrain/grid.ts';

export function gridOf(rows: string[], kinds?: string[]): TerrainGrid {
  const grid = createGrid(rows[0]!.length, rows.length);
  for (let gy = 0; gy < rows.length; gy += 1) {
    for (let gx = 0; gx < rows[gy]!.length; gx += 1) {
      const char = rows[gy]![gx];
      if (!char || char === '-' || char === ' ') continue;
      const i = idx(grid, gx, gy);
      grid.level[i] = Number.parseInt(char, 10);
      grid.kind[i] = kinds ? kinds[gy]!.charCodeAt(gx) - 96 : 1;
    }
  }
  return grid;
}

/** Sides/corners as a binary string, so a failure message is readable. */
export const bits = (value: number): string => value.toString(2).padStart(4, '0');

/**
 * A document-shaped object for the serializer, from a grid of height chars.
 *
 * The serializer reads the live typed arrays rather than row strings now, so a
 * test that wants to check what a map file says has to hand it a real grid.
 */
export function mapDoc(height: string[], extra: Record<string, unknown> = {}) {
  return {
    id: 'x',
    name: 'X',
    terrain: gridOf(height),
    terrainIds: ['grass'],
    ...extra,
  };
}
