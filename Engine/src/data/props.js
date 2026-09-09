import { PROPS as GAME_PROPS } from '#game/rules/props.js';

/**
 * An object a map can stand on a tile: a mesh, optionally wearing a texture.
 *
 * The definition is the thing; a map holds only a tile and an id. That is what
 * makes a barrel a barrel everywhere — resize it here and every map's barrels
 * are that size — and it is why moving one on a map is a two-number edit rather
 * than a copy of a model.
 *
 * Everything a prop knows how to be is here. Whether it blocks the way is not a
 * property of the mesh, so it is not on the asset: a shrub you walk through and
 * a boulder you do not can share a model.
 *
 * An object with a flat top can also be something you stand on. `top` is how
 * high that surface is, and 0 — the default — means you cannot: a barrel is
 * something you walk around, not a step. Blocking and standing on are
 * independent, so an object you are meant to get onto wants `blocks` off.
 *
 * A prop's body is a model or a sprite sheet — a flat frame that plays, turned
 * to face the camera, which is how a torch flame or a fluttering banner is done
 * without modelling one. A prop naming both is a model: the mesh is the more
 * specific answer, and silently preferring one is better than drawing two
 * things in the same place.
 */

export const PROP_FIELDS = {
  label: { kind: 'text', label: 'Name' },
  mesh: { kind: 'asset', assetKind: 'mesh', label: 'Mesh' },
  // A named surface, if it has one. It wins over the texture and tint below:
  // a material *is* a picture and a tint, so an object wearing one and also
  // carrying its own would be two answers to the same question.
  material: { kind: 'material', label: 'Material' },
  texture: { kind: 'asset', assetKind: 'texture', label: 'Texture' },
  sheet: { kind: 'asset', assetKind: 'sheet', label: 'Sprite sheet' },
  billboard: { kind: 'bool', label: 'Faces the camera', default: true },
  tint: { kind: 'color', label: 'Tint', default: 0xffffff },
  // Exponential, like every other size in the editor: a scale is a multiplier,
  // so half and double are the same distance either side of 1 — which a
  // straight scale from 0.05 to 12 does not say at all.
  scale: { kind: 'range', label: 'Scale', min: 0.05, max: 12, step: 0.05, default: 1, curve: 'exp' },
  rotY: { kind: 'range', label: 'Turn (deg)', min: 0, max: 360, step: 15, default: 0 },
  lift: { kind: 'range', label: 'Lift', min: -2, max: 4, step: 0.05, default: 0 },
  blocks: { kind: 'bool', label: 'Blocks the way', default: false },
  top: { kind: 'range', label: 'Stand on top at', min: 0, max: 8, step: 0.05, default: 0 },
  shadow: { kind: 'bool', label: 'Casts a shadow', default: true },
};

/**
 * A tint is a multiply, so white is "leave it alone" — which is why it is the
 * default rather than a colour anyone chose.
 */
export function defaultProp(id = 'prop') {
  return {
    id,
    label: id,
    mesh: '',
    material: '',
    texture: '',
    sheet: '',
    billboard: true,
    tint: 0xffffff,
    scale: 1,
    rotY: 0,
    lift: 0,
    blocks: false,
    top: 0,
    shadow: true,
  };
}

export function normalizeProp(prop = {}) {
  const full = defaultProp(prop.id ?? 'prop');
  for (const key of Object.keys(full)) {
    if (prop[key] !== undefined) full[key] = prop[key];
  }
  full.label = prop.label ?? full.id;
  return full;
}

export const PROPS = (GAME_PROPS ?? []).map(normalizeProp);

const BY_ID = new Map(PROPS.map((prop) => [prop.id, prop]));

export const propById = (id) => BY_ID.get(id) ?? null;

/**
 * The tiles a map's props make impassable.
 *
 * Here rather than in the world because it is the one place that knows a
 * placement is only an id until the definitions are consulted — and the world
 * only needs the answer.
 */
/**
 * How high an actor stands on each tile that has something to stand on, keyed
 * "gx,gy" and measured in world units above the terrain.
 *
 * The object says how high its own top is; the placement says how high the
 * object was put. Two crates on one tile therefore give the top of the upper
 * one, which is what standing on a stack means.
 *
 * @param {object[]} placed the map's objects
 * @param {(id: string) => object|null} [lookup] which definitions to read
 */
export function standHeights(placed = [], lookup = propById) {
  const tops = new Map();
  for (const entry of placed) {
    const top = lookup(entry.id)?.top ?? 0;
    if (!top) continue;
    const key = `${Math.floor(entry.gx)},${Math.floor(entry.gy)}`;
    tops.set(key, Math.max(tops.get(key) ?? 0, (entry.lift ?? 0) + top));
  }
  return tops;
}

export function blockedTiles(placed = [], lookup = propById) {
  const blocked = new Set();
  for (const entry of placed) {
    if (lookup(entry.id)?.blocks) blocked.add(`${Math.floor(entry.gx)},${Math.floor(entry.gy)}`);
  }
  return blocked;
}
