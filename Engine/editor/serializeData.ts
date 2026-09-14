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

/**
 * What a name is allowed to be, once it is an id.
 *
 * Here rather than beside the document that enforces it, because the same
 * answer names the file a record is written to — and two rules for one question
 * is how a record ends up in a file it cannot be found by.
 */
export const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/;

/** `Stone Wall` → `stoneWall`: the id a name asks for. Empty if it asks for none. */
export function idFromLabel(label: unknown): string {
  const words = String(label ?? '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return '';
  const id = words
    .map((word, i) =>
      i === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
  // An id has to start with a letter, so a name that starts with a digit gets
  // one rather than being refused.
  return ID_PATTERN.test(id) ? id : `a${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

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
 * What a record of each library kind is called, inside its own folder.
 *
 * `<id>.<kind>.json` — `grass.material.json`. The kind is in the name so a
 * single glob still finds every material there is and "is this a material?"
 * stays a question about the filename; the id is in it so a folder open in a
 * file manager says which material it holds rather than five folders all
 * saying `material.json`.
 */
export const LIBRARY_SUFFIX: Record<string, string> = {
  materials: 'material',
  props: 'object',
  terrains: 'terrain',
  vfx: 'effect',
  prefabs: 'prefab',
};

/**
 * What a record's file is called: `grass.material.json`.
 *
 * Named from the label rather than the id, because the name is the thing you
 * read in a file manager and the id is a key. They agree for anything made in
 * the editor — `add` derives one from the other — and where they have drifted
 * it is the name you would go looking for. Renaming a material renames its
 * file: the save writes the new one and prunes the old, which is the same
 * mechanism that already handles a record being deleted.
 */
export const recordFile = (kind: string, record: { id?: unknown; label?: unknown }) =>
  `${idFromLabel(record.label) || String(record.id ?? 'record')}.${
    LIBRARY_SUFFIX[kind] ?? kind
  }.json`;

/**
 * Which kind a record file belongs to, by its name, or null for any other file.
 *
 * The suffix rather than the whole name, which is what the id in front costs:
 * one split instead of one lookup.
 */
export function kindOfRecord(name: string): string | null {
  const parts = name.split('.');
  if (parts.length < 3 || parts.pop() !== 'json') return null;
  const suffix = parts.pop();
  return Object.keys(LIBRARY_SUFFIX).find((kind) => LIBRARY_SUFFIX[kind] === suffix) ?? null;
}

/**
 * Kinds whose records are a file and nothing else.
 *
 * Everything else in the library is a record standing beside its own bytes — a
 * material and its four maps, an effect and its sheet — so each gets a folder
 * of its own and the folder *is* the record. A prefab names other records and
 * carries no files, so a folder for it would be a folder with one file in it,
 * for ever. Prefabs sit straight in `Prefabs/`, and a folder in there is one
 * you made to group them.
 */
export const LIBRARY_FILE_ONLY = new Set(['prefabs']);

/** The top folder a kind's records are made in. */
export const LIBRARY_FOLDERS: Record<string, string> = {
  materials: 'Materials',
  props: 'Objects',
  terrains: 'Terrain',
  vfx: 'Effects',
  prefabs: 'Prefabs',
};

export const LIBRARY_KINDS_SAVED = Object.keys(LIBRARY_SUFFIX);

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
  for (const kind of Object.keys(LIBRARY_SUFFIX)) {
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
      out.push({ path: `${path}/${recordFile(kind, record)}`, record });
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
