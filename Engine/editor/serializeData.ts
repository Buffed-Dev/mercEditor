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
