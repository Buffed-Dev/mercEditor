import { TERRAINS as GAME_TERRAINS } from '#game/rules/terrains.js';

/**
 * A terrain type: what a patch of ground is made of.
 *
 * Deliberately small, and deliberately says nothing about shape. Which of the
 * six block meshes a tile gets, and how far it is turned, is worked out from
 * the tiles around it in terrain/mask.ts and terrain/templates.ts. Nothing here
 * can influence it, which is what keeps adding Snow to a data edit instead of a
 * code change.
 *
 * ## Two materials, and six overrides
 *
 * `top` is the block a tile stands on: its walkable lid, the bevel that rolls
 * over its exposed edges, and the one level of wall beneath it. `sub` is every
 * block below that in a stack — wall and nothing else. They are separate
 * because that is the shape of the art: grass on top and earth down the sides
 * for the first block, earth all the way for the rest.
 *
 * The six `top90` / `sub270` slots exist for *directional* textures. Blocks are
 * instanced, so a side piece facing south is the same mesh as one facing east,
 * turned — and a texture with lines running across it comes out with them
 * running down it. Painting a second texture with the lines the other way and
 * hanging it on the turned slot is the fix. A slot left empty falls back to the
 * unturned one, which is all a seamless texture ever needs.
 *
 * There are no gameplay fields. Walkability comes from height, step height and
 * prop blockers exactly as it did; a terrain is what the ground looks like.
 */

export const TERRAIN_FIELDS = {
  label: { kind: 'text', label: 'Name' },

  // Two characters, and the field is held to it. This is what a map's terrain
  // rows are written in, so a third would go to disk and come back trimmed —
  // which reads as the letter refusing to change.
  char: { kind: 'text', label: 'Grid letter', maxLength: 2 },

  top: { kind: 'material', label: 'Top block' },
  sub: { kind: 'material', label: 'Under block' },

  top90: { kind: 'material', label: 'Top ¼ turn' },
  top180: { kind: 'material', label: 'Top ½ turn' },
  top270: { kind: 'material', label: 'Top ¾ turn' },
  sub90: { kind: 'material', label: 'Under ¼ turn' },
  sub180: { kind: 'material', label: 'Under ½ turn' },
  sub270: { kind: 'material', label: 'Under ¾ turn' },

  tint: { kind: 'color', label: 'Tint', default: 0xffffff },
} as const;

/** The slots a rotation can override, in the order the panel shows them. */
export const TERRAIN_SLOTS = ['top', 'sub'] as const;

export type Terrain = {
  id: string;
  label: string;
  char: string;
  top: string;
  sub: string;
  top90: string;
  top180: string;
  top270: string;
  sub90: string;
  sub180: string;
  sub270: string;
  tint: number;
};

/**
 * The material for one slot at one quarter-turn, falling back to the unturned
 * one. The single place the override rule is written down.
 *
 * @param rot quarter-turns, 0 to 3
 */
export function slotMaterial(terrain: Terrain | null, slot: 'top' | 'sub', rot: number): string {
  if (!terrain) return '';
  const turn = ((Math.round(rot) % 4) + 4) % 4;
  const override = turn ? (terrain as Record<string, unknown>)[`${slot}${turn * 90}`] : '';
  return (typeof override === 'string' && override) || terrain[slot] || '';
}

export function defaultTerrain(id = 'terrain'): Terrain {
  return {
    id,
    label: id,
    // Two terrains sharing a key would make rows that cannot be read back, so a
    // fresh one takes the first two letters of its id and the editor moves it
    // out of the way if that is taken.
    char: id.slice(0, 2) || 'te',
    top: '',
    sub: '',
    top90: '',
    top180: '',
    top270: '',
    sub90: '',
    sub180: '',
    sub270: '',
    tint: TERRAIN_FIELDS.tint.default,
  };
}

export function normalizeTerrain(terrain: Partial<Terrain> = {}): Terrain {
  const full = defaultTerrain(terrain.id ?? 'terrain');
  for (const key of Object.keys(full) as (keyof Terrain)[]) {
    if (terrain[key] !== undefined) (full as Record<string, unknown>)[key] = terrain[key];
  }
  full.label = terrain.label ?? full.id;

  // Records written before blocks: `surface` was the lid and `cliff` the wall
  // below it. Read them so a rules file from then opens looking right; the
  // editor writes the new names back the next time the rules are saved.
  const old = terrain as Record<string, unknown>;
  if (!full.top && typeof old.surface === 'string') full.top = old.surface;
  if (!full.sub) full.sub = (typeof old.cliff === 'string' && old.cliff) || full.top;

  // Never a space: the empty key is two dots and padding is how a row says a
  // cell has no terrain, so a key containing whitespace could not be told apart
  // from a hole.
  full.char = String(full.char ?? '').replace(/\s/g, '').slice(0, 2) || 'te';
  return full;
}

export const TERRAINS: Terrain[] = ((GAME_TERRAINS as Partial<Terrain>[]) ?? []).map(normalizeTerrain);

const BY_ID = new Map(TERRAINS.map((terrain) => [terrain.id, terrain]));

export const terrainById = (id: string): Terrain | null => BY_ID.get(id) ?? null;

/**
 * A lookup from terrain id to record, over whichever definitions are handed in.
 *
 * Built per call rather than once, because the editor asks with the terrains as
 * they are being edited and the game asks with the ones it shipped.
 */
export function terrainsById(defs: readonly Terrain[] = TERRAINS): Map<string, Terrain> {
  return new Map(defs.map((terrain) => [terrain.id, terrain]));
}

/**
 * Problems a person can act on, as sentences naming what and where.
 *
 * Two terrains sharing a key is the one that loses data — the map it writes
 * cannot be read back — so it is reported even though nothing has broken yet.
 */
export function validateTerrains(defs: readonly Terrain[] = TERRAINS): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const terrain of defs) {
    const clash = seen.get(terrain.char);
    if (clash) {
      problems.push(
        `terrains "${clash}" and "${terrain.id}" both use the grid letter "${terrain.char}"`,
      );
    }
    seen.set(terrain.char, terrain.id);
    if (!terrain.top) problems.push(`terrain "${terrain.id}" has no top material`);
  }
  return problems;
}
