/**
 * Merc, as a game the editor can open.
 *
 * A game is a folder: this manifest, a `maps/` folder, a `rules/` folder and an
 * `assets/` folder. Nothing else in here knows what an engine is — the files
 * beside this one are plain data, no imports, no logic — which is what makes a
 * second game a second folder rather than a second codebase.
 *
 * `rules/` is what the game is played by; `assets/` is what a map is drawn
 * with. The second used to be four more files in the first, naming files by an
 * id that pointed at a row in a fifth. It is folders now: a material is
 * `assets/Materials/Grass/`, holding `material.json` beside the two pictures it
 * names.
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

export const id = 'Merc';
export const label = 'Merc';

/** Where a new game starts, and where dying puts you back. */
export const startMap = 'base';

/**
 * The library: the records a map is drawn *with*, found rather than listed.
 *
 * Each one is a folder under `assets/` holding a fixed-name file beside the
 * pictures and models it refers to, so the folder *is* the record — copy the
 * directory and you have copied the material, textures and all. The filename
 * is fixed rather than named after the record so that one glob can find every
 * one of a kind, and so "is this folder a material?" has an answer that does
 * not involve reading anything.
 *
 * Found for the same reason the maps below are: the editor makes one of these
 * by writing a folder, so a list here would be a second place to remember. It
 * used to be exactly that — four arrays in `rules/` — and the two had already
 * drifted apart by nineteen files.
 *
 * Five spelled-out lines rather than a loop over five names, because a glob
 * pattern has to be a literal for the bundler to see through it. The try/catch
 * is for everything that is not Vite, where `import.meta.glob` does not exist
 * and an empty library beats a hard crash.
 */
let found;
try {
  found = {
    materials: import.meta.glob('./assets/Materials/**/material.json', { eager: true, import: 'default' }),
    props: import.meta.glob('./assets/Objects/**/object.json', { eager: true, import: 'default' }),
    terrains: import.meta.glob('./assets/Terrain/**/terrain.json', { eager: true, import: 'default' }),
    vfx: import.meta.glob('./assets/Effects/**/effect.json', { eager: true, import: 'default' }),
    prefabs: import.meta.glob('./assets/Prefabs/**/prefab.json', { eager: true, import: 'default' }),
  };
} catch {
  found = {};
}

/**
 * One kind's records, in a stable order, each told where it lives.
 *
 * `path` is the folder the record was found in, and everything the record
 * names is relative to it. Derived here rather than written into the file: the
 * other way round, renaming a folder would mean rewriting every record inside
 * it to stay true, and the rename would become a thing that could half-fail.
 *
 * Sorted, because a glob hands them back in the filesystem's order and a list
 * that reshuffled between two machines would make every save a diff.
 */
const library = (modules = {}, file) =>
  Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, record]) => ({
      ...record,
      // './assets/Materials/Grass/material.json' -> 'Materials/Grass'
      path: key.slice('./assets/'.length, -(file.length + 1)),
    }));

export const MATERIALS = library(found.materials, 'material.json');
export const PROPS = library(found.props, 'object.json');
export const TERRAINS = library(found.terrains, 'terrain.json');
export const VFX = library(found.vfx, 'effect.json');
export const PREFABS = library(found.prefabs, 'prefab.json');

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
};

/**
 * Where each file in `assets/` can actually be fetched from, by its path.
 *
 * A build renames everything it emits, so a model referenced by a string in a
 * record would be a 404 the moment the game was published. Asking the bundler
 * for the URL is the only way to know it; in dev the same call hands back the
 * plain path. Found rather than listed, for the same reason the maps below are.
 *
 * Keyed by path from `assets/` rather than by bare filename, now that the
 * files live in the folder of whatever names them: two materials may each own
 * a `base_color.png` and they are not the same picture.
 *
 * The extensions are spelled out so that the record files sitting beside these
 * are not emitted as assets of their own — they are modules the library glob
 * above already read, and a second copy of each in the build would be a
 * megabyte of nothing.
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
