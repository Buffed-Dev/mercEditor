import { literal } from './literal.ts';

/**
 * Write the rules back out as the modules in a game's rules/ folder.
 *
 * Those files hold data and nothing else, which is the whole reason they were
 * split out of the schema files next door: a serializer that had to regenerate
 * the field definitions and their comments as well would either lose them or
 * have to understand them. Here it only has to print an array.
 *
 * The nine here are what a game is *played* by. What it is *drawn* with —
 * materials, objects, terrains, effects — used to be five more, and is now a
 * folder each under assets/ holding one json file. Those are written by
 * `libraryWrites` below, because a record that lives beside its own pictures
 * cannot be one row of a file shared with forty others.
 */

/** One rules file: the constant it declares, and what to say above it. */
type RuleFile = { constant: string; title: string; note: string };
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
  recipes: {
    constant: 'RECIPES',
    title: 'Crafting recipes',
    note: 'Each spends currency and rolls one item definition; the shape is in ../recipes.js.',
  },
} satisfies Record<string, RuleFile>;

/** Which rules files there are. */
export type RuleKind = keyof typeof RULE_FILES;

export const RULE_KINDS = Object.keys(RULE_FILES) as RuleKind[];

/** kind -> the constant its module exports, for anything reading one back. */
export const RULE_CONSTANTS: Record<string, string> = Object.fromEntries(
  RULE_KINDS.map((kind) => [kind, RULE_FILES[kind].constant]),
);

export function serializeRules(kind: string, list: unknown): string {
  const spec = (RULE_FILES as Record<string, RuleFile | undefined>)[kind];
  if (!spec) throw new Error(`Unknown rule file "${kind}"`);

  return `// ${spec.title} — rewritten wholesale by the EDITOR on the
// main menu. Values survive a round trip; comments and formatting inside the
// array below do not, so keep notes in the schema file instead.
// ${spec.note}

export const ${spec.constant} = ${literal(list)};
`;
}

/**
 * Where a record of each library kind is written, inside its own folder.
 *
 * Fixed names rather than one named after the record: it is what lets a single
 * glob find every material there is, and what makes "is this folder a
 * material?" a question the filesystem answers.
 */
export const LIBRARY_FILES: Record<string, string> = {
  materials: 'material.json',
  props: 'object.json',
  terrains: 'terrain.json',
  vfx: 'effect.json',
  prefabs: 'prefab.json',
};

/** The top folder a kind's records are made in. */
export const LIBRARY_FOLDERS: Record<string, string> = {
  materials: 'Materials',
  props: 'Objects',
  terrains: 'Terrain',
  vfx: 'Effects',
  prefabs: 'Prefabs',
};

export const LIBRARY_KINDS_SAVED = Object.keys(LIBRARY_FILES);

/**
 * Every library record as a file to write, and the kinds to prune afterwards.
 *
 * `path` is stripped on the way out. It says where the record was found, so a
 * copy of it inside the file would be a second answer to a question the folder
 * already answers — and one that a rename could leave wrong.
 *
 * A record with no path is skipped rather than written to the assets root: the
 * root is where files nothing has claimed sit, and a record dropped there
 * would be neither in a folder nor findable by the glob that wants one.
 */
export function libraryWrites(
  data: Partial<Record<string, unknown>>,
): { path: string; record: unknown }[] {
  const out: { path: string; record: unknown }[] = [];
  for (const [kind, file] of Object.entries(LIBRARY_FILES)) {
    for (const entry of (data[kind] as Record<string, unknown>[] | undefined) ?? []) {
      const { path, ...record } = entry;
      if (typeof path !== 'string' || !path) continue;
      // An empty list is not written. A prefab has nine of them and usually
      // carries two, so the file would be mostly `[]` -- and the normalizer
      // puts every one of them back on the way in, so nothing is lost by
      // leaving them out.
      for (const [key, value] of Object.entries(record)) {
        if (Array.isArray(value) && !value.length) delete record[key];
      }
      out.push({ path: `${path}/${file}`, record });
    }
  }
  return out;
}

/** Every rules file for a document, ready to POST. */
export function serializeAllRules(
  data: Partial<Record<RuleKind, unknown>>,
): { kind: RuleKind; file: string; source: string }[] {
  return RULE_KINDS.map((kind) => ({
    kind,
    file: `${kind}.js`,
    source: serializeRules(kind, data[kind] ?? []),
  }));
}
