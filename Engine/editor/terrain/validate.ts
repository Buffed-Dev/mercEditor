import { kindAt, isEmptyGrid, EMPTY, type TerrainGrid } from '../../src/data/terrain/grid.ts';
import { validateTerrains, type Terrain } from '../../src/data/terrains.ts';

/**
 * What is wrong with a map's terrain, as sentences naming where.
 *
 * Reported rather than repaired. A map that quietly fixes itself on load is a
 * map whose file and whose contents disagree, and the next save writes the
 * repair back over whatever the author actually meant.
 *
 * The one hard failure is a map with no terrain at all: it draws nothing, with
 * no error, and looks exactly like a renderer that has broken.
 */
export type Problem = { text: string; fatal?: boolean };

export function validateTerrain(
  grid: TerrainGrid,
  terrainIds: readonly string[],
  defs: readonly Terrain[],
  decodeProblems: readonly string[] = [],
): Problem[] {
  const problems: Problem[] = decodeProblems.map((text) => ({ text }));

  if (isEmptyGrid(grid)) {
    problems.push({
      text: 'This map has no terrain anywhere, so it will draw nothing at all.',
      fatal: true,
    });
  }

  // A map names its terrains by id, so a renamed or deleted record leaves cells
  // that still exist and no longer know what they are made of.
  const known = new Set(defs.map((terrain) => terrain.id));
  const used = new Map<string, number>();
  for (let gy = 0; gy < grid.rows; gy += 1) {
    for (let gx = 0; gx < grid.cols; gx += 1) {
      const kind = kindAt(grid, gx, gy);
      if (kind === EMPTY) continue;
      const id = terrainIds[kind - 1] ?? '';
      used.set(id, (used.get(id) ?? 0) + 1);
    }
  }

  for (const [id, count] of used) {
    if (!id) {
      problems.push({ text: `${count} cells use a terrain the map's legend does not name.` });
    } else if (!known.has(id)) {
      problems.push({
        text: `${count} cells are "${id}", which is not a terrain any more — rename it back, or repaint them.`,
      });
    }
  }

  for (const text of validateTerrains(defs)) problems.push({ text });
  return problems;
}
