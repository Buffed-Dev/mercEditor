import { serializeAllRules, type RuleKind } from './serializeData.ts';
import { list, post } from './devServer.ts';
import type { Terrain } from '../src/data/terrains.ts';

/**
 * What the editor still writes straight into a game folder.
 *
 * Maps and assets are not here: they go to the draft (see assets/session.ts)
 * and into the game only on Publish. Rules are written directly.
 */

/** A terrain id to the two-character key a map's rows are written in. */
export const terrainCharOf =
  (terrains: readonly Terrain[]) =>
  (id: string): string =>
    terrains.find((terrain) => terrain.id === id)?.char ?? '';

/**
 * Write the rules back as the modules under rules/, all in one batch, since
 * they reference each other.
 *
 * @returns {Promise<number>} how many files were written
 */
export async function writeRules(
  game: string,
  data: Partial<Record<RuleKind, unknown>>,
): Promise<number> {
  const body = await post('/__data', 'write the rules', { game, files: serializeAllRules(data) });
  return list(body, 'files').length;
}
