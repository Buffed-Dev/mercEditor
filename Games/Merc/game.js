/**
 * Merc, as a game the editor can open.
 *
 * A game is a folder: this manifest, a `maps/` folder, a `rules/` folder and an
 * `assets/` folder. Nothing else in here knows what an engine is — the files
 * beside this one are plain data, no imports, no logic — which is what makes a
 * second game a second folder rather than a second codebase.
 *
 * `rules/` is what the game is played by; `assets/` is what a map is drawn
 * with. `assets/` is organised however its author likes: an asset is found by
 * its name, never by which folder it is in.
 *
 *   grass.material.json   a material
 *   grass.block.json      a terrain block
 *   camp.prefab.json      a prefab
 *   fire.effect.json      an effect
 *   softSlope.profile.json  an edge profile: the models an exposed edge is built from
 *   rock.glb + rock.glb.meta, top.png + top.png.meta
 *                         a model or a texture, and the sidecar holding its id
 *
 * Only what is published is read here. The editor keeps its unpublished work in
 * `.draft/`, which nothing in this file looks at.
 */

import { ATTRIBUTES } from './rules/attributes.js';
import { EFFECTS } from './rules/effects.js';
import { ABILITIES } from './rules/abilities.js';
import { ARCHETYPES } from './rules/archetypes.js';
import { ITEMS } from './rules/items.js';
import { CATEGORIES } from './rules/categories.js';
import { RECIPES } from './rules/recipes.js';
import { LOOT_TABLES } from './rules/lootTables.js';
import { BASE_LEVELS } from './rules/baseLevels.js';

export const id = 'Merc';
export const label = 'Merc';

/** Where a new game starts, and where dying puts you back. */
export const startMap = 'base';

/**
 * Every json asset, found by its suffix anywhere under `assets/`.
 *
 * Four spelled-out lines rather than a loop, because a glob pattern has to be a
 * literal for the bundler to see through it. The try/catch is for everything
 * that is not Vite, where `import.meta.glob` does not exist.
 */
let found;
try {
  found = {
    materials: import.meta.glob('./assets/**/*.material.json', { eager: true, import: 'default' }),
    terrains: import.meta.glob('./assets/**/*.block.json', { eager: true, import: 'default' }),
    vfx: import.meta.glob('./assets/**/*.effect.json', { eager: true, import: 'default' }),
    prefabs: import.meta.glob('./assets/**/*.prefab.json', { eager: true, import: 'default' }),
    profiles: import.meta.glob('./assets/**/*.profile.json', { eager: true, import: 'default' }),
  };
} catch {
  found = {};
}

/** './assets/Terrain/Grass/grass.block.json' -> 'Terrain/Grass' */
const folderOf = (key) => key.slice('./assets/'.length, key.lastIndexOf('/'));
/** './assets/Terrain/Grass/grass.block.json' -> 'grass' */
const stemOf = (key) => key.slice(key.lastIndexOf('/') + 1).split('.')[0];

/**
 * One type's records, in a stable order, each told its folder and its name.
 * The name is the file's, so a record never carries a second one.
 */
const library = (modules = {}) =>
  Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, record]) => ({ ...record, label: stemOf(key), path: folderOf(key) }));

export const MATERIALS = library(found.materials);
export const TERRAINS = library(found.terrains);
export const VFX = library(found.vfx);
export const PREFABS = library(found.prefabs);
export const PROFILES = library(found.profiles);

/**
 * The sidecars: each texture's and model's id, keyed back to the file.
 */
let metaModules;
try {
  metaModules = import.meta.glob('./assets/**/*.{glb,gltf,png,jpg,jpeg,webp}.meta', {
    eager: true,
    query: '?raw',
    import: 'default',
  });
} catch {
  metaModules = {};
}

/** File id -> path under `assets/`. */
export const FILE_IDS = Object.fromEntries(
  Object.entries(metaModules).flatMap(([key, text]) => {
    try {
      const fileId = JSON.parse(text).id;
      return fileId ? [[fileId, key.slice('./assets/'.length, -'.meta'.length)]] : [];
    } catch {
      return [];
    }
  }),
);

/**
 * A model is an asset on its own, with no json of its own: a prefab places it
 * by its id. The object record the engine draws is made from the file.
 */
export const PROPS = Object.entries(FILE_IDS)
  .filter(([, path]) => /\.(glb|gltf)$/i.test(path))
  .sort(([, a], [, b]) => a.localeCompare(b))
  .map(([fileId, path]) => ({
    id: fileId,
    label: path.slice(path.lastIndexOf('/') + 1).replace(/\.(glb|gltf)$/i, ''),
    path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
    mesh: fileId,
  }));

/** Named exactly as the rules editor's lists are, because it hands them over. */
export const rules = {
  attributes: ATTRIBUTES,
  effects: EFFECTS,
  abilities: ABILITIES,
  archetypes: ARCHETYPES,
  items: ITEMS,
  categories: CATEGORIES,
  recipes: RECIPES,
  lootTables: LOOT_TABLES,
  baseLevels: BASE_LEVELS,
  vfx: VFX,
  materials: MATERIALS,
  terrains: TERRAINS,
  props: PROPS,
  prefabs: PREFABS,
  profiles: PROFILES,
};

/**
 * Where each file in `assets/` can actually be fetched from, by its path.
 * Asking the bundler is the only way to know once a build has renamed them.
 */
let assetModules;
try {
  assetModules = import.meta.glob('./assets/**/*.{glb,gltf,png,jpg,jpeg,webp}', {
    eager: true,
    query: '?url',
    import: 'default',
  });
} catch {
  assetModules = {};
}

export const ASSET_URLS = Object.fromEntries(
  Object.entries(assetModules).map(([path, url]) => [path.replace('./assets/', ''), url]),
);

/**
 * Every map in the folder, found rather than listed.
 */
let modules;
try {
  modules = import.meta.glob('./maps/*.js', { eager: true });
} catch {
  modules = {};
}

export const maps = Object.entries(modules)
  .map(([path, module]) => {
    const map = Object.values(module).find((value) => value?.id && value?.terrain);
    if (!map) console.warn(`[${id}] ${path} exports no map object (needs { id, terrain })`);
    return map;
  })
  .filter(Boolean);
