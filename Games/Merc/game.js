/**
 * Merc, as a game the editor can open.
 *
 * A game is a folder: this manifest, a `maps/` folder and a `rules/` folder.
 * Nothing else in here knows what an engine is — the files beside this one are
 * plain data, no imports, no logic — which is what makes a second game a second
 * folder rather than a second codebase.
 *
 * Two things read it. The engine resolves `#game` to the folder it was built
 * for, so a published game carries exactly one of these. The editor loads any
 * of them by path at runtime, which is how it switches between games.
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
import { VFX } from './rules/vfx.js';
import { ASSETS } from './rules/assets.js';
import { MATERIALS } from './rules/materials.js';
import { TERRAINS } from './rules/terrains.js';
import { PROPS } from './rules/props.js';

export const id = 'Merc';
export const label = 'Merc';

/** Where a new game starts, and where dying puts you back. */
export const startMap = 'base';

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
  assets: ASSETS,
  materials: MATERIALS,
  terrains: TERRAINS,
  props: PROPS,
};

/**
 * Where each file in `assets/` can actually be fetched from, by its name.
 *
 * A build renames everything it emits, so a model referenced by a string in a
 * rules file would be a 404 the moment the game was published. Asking the
 * bundler for the URL is the only way to know it; in dev the same call hands
 * back the plain path. Found rather than listed, for the same reason the maps
 * below are.
 */
let assetModules;
try {
  assetModules = import.meta.glob('./assets/*', { eager: true, query: '?url', import: 'default' });
} catch {
  assetModules = {};
}

export const ASSET_URLS = Object.fromEntries(
  Object.entries(assetModules).map(([path, url]) => [path.replace('./assets/', ''), url]),
);

/**
 * Every map in the folder, found rather than listed: the editor makes a map by
 * writing a file, so a list here would be a second place to remember.
 *
 * The try/catch is for everything that is not Vite — `node --test`, say — where
 * `import.meta.glob` does not exist and an empty folder beats a hard crash.
 */
let modules;
try {
  modules = import.meta.glob('./maps/*.js', { eager: true });
} catch {
  modules = {};
}

export const maps = Object.entries(modules)
  .map(([path, module]) => {
    // A map is the export carrying an id and a terrain grid. Recognised by
    // shape rather than by name, because the editor writes the constant named
    // after the map and a list here would be a second place to remember.
    const map = Object.values(module).find((value) => value?.id && value?.terrain);
    if (!map) console.warn(`[${id}] ${path} exports no map object (needs { id, terrain })`);
    return map;
  })
  .filter(Boolean);
