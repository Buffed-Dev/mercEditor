import { literal } from './literal.js';

/**
 * Write the rules back out as the modules in a game's rules/ folder.
 *
 * Those files hold data and nothing else, which is the whole reason they were
 * split out of the schema files next door: a serializer that had to regenerate
 * the field definitions and their comments as well would either lose them or
 * have to understand them. Here it only has to print an array.
 */

const RULE_FILES = {
  attributes: {
    constant: 'ATTRIBUTES',
    title: 'Attribute definitions',
    note: 'What each number means lives in ../attributes.js.',
  },
  effects: {
    constant: 'EFFECTS',
    title: 'Effect definitions',
    note: 'Duration, interval and the execute/modify rule are in ../effects.js.',
  },
  abilities: {
    constant: 'ABILITIES',
    title: 'Ability definitions',
    note: 'Shapes, cooldown scaling and costs are explained in ../abilities.js.',
  },
  archetypes: {
    constant: 'ARCHETYPES',
    title: 'Archetypes',
    note: 'Base-value overrides per actor; anything absent falls back to the attribute.',
  },
  items: {
    constant: 'ITEMS',
    title: 'Item definitions',
    note: 'Stat lines are ranges, rolled per drop; the shape is in ../items.js.',
  },
  categories: {
    constant: 'CATEGORIES',
    title: 'Item categories',
    note: 'Each names the machine it runs on; the shape is in ../categories.js.',
  },
  lootTables: {
    constant: 'LOOT_TABLES',
    title: 'Loot tables',
    note: 'Whatever can be broken names one; the shape is in ../lootTables.js.',
  },
  baseLevels: {
    constant: 'BASE_LEVELS',
    title: 'Base levels',
    note: 'Each row is what reaching that level costs; the shape is in ../baseLevels.ts.',
  },
  vfx: {
    constant: 'VFX',
    title: 'Visual effects',
    note: 'What each field does is in ../../../Engine/src/data/vfx.ts.',
  },
  terrains: {
    constant: 'TERRAINS',
    title: 'Terrain definitions',
    note: 'What the ground is made of; the shape is in ../../../Engine/src/data/terrains.ts.',
  },
  assets: {
    constant: 'ASSETS',
    title: 'Asset definitions',
    note: 'The files themselves are in ../assets/; the shape is in ../../../Engine/src/data/assets.ts.',
  },
  materials: {
    constant: 'MATERIALS',
    title: 'Material definitions',
    note: 'Named surfaces; the shape is in ../../../Engine/src/data/materials.ts.',
  },
  props: {
    constant: 'PROPS',
    title: 'Object definitions',
    note: 'What each field does is in ../../../Engine/src/data/props.ts.',
  },
  recipes: {
    constant: 'RECIPES',
    title: 'Crafting recipes',
    note: 'Each spends currency and rolls one item definition; the shape is in ../recipes.js.',
  },
};

export const RULE_KINDS = Object.keys(RULE_FILES);

/** kind -> the constant its module exports, for anything reading one back. */
export const RULE_CONSTANTS = Object.fromEntries(
  RULE_KINDS.map((kind) => [kind, RULE_FILES[kind].constant]),
);

export function serializeRules(kind, list) {
  const spec = RULE_FILES[kind];
  if (!spec) throw new Error(`Unknown rule file "${kind}"`);

  return `// ${spec.title} — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// ${spec.note}

export const ${spec.constant} = ${literal(list)};
`;
}

/** Every rules file for a document, ready to POST. */
export function serializeAllRules(data) {
  return RULE_KINDS.map((kind) => ({
    kind,
    file: `${kind}.js`,
    source: serializeRules(kind, data[kind] ?? []),
  }));
}
