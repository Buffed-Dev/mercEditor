import { ATTRIBUTE_FIELDS, ATTRIBUTE_KINDS } from '../../src/data/attributes.js';
import { EFFECT_FIELDS, DURATION_TYPES } from '../../src/data/effects.js';
import { ABILITY_FIELDS } from '../../src/data/abilities.js';
import { ITEM_FIELDS } from '../../src/data/items.js';
import { CATEGORY_FIELDS } from '../../src/data/categories.js';
import { RECIPE_FIELDS } from '../../src/data/recipes.js';
import { LOOT_TABLE_FIELDS } from '../../src/data/lootTables.js';
import { BASE_LEVEL_FIELDS } from '../../src/data/baseLevels.js';
import type { FieldSpec } from '../fields/types';

/**
 * What the rules editor is made of.
 *
 * Three groups, nine lists, and for each list the field table the game's own
 * data files already declare. Nothing here describes a record a second time —
 * `ATTRIBUTE_FIELDS` and the rest are the same tables the simulation reads, so
 * a property added there is editable here without this file changing.
 */

export type ListId =
  | 'attributes'
  | 'effects'
  | 'abilities'
  | 'archetypes'
  | 'lootTables'
  | 'items'
  | 'categories'
  | 'recipes'
  | 'baseLevels';

export type Group = {
  id: string;
  label: string;
  lists: ListId[];
};

/**
 * The groups, and the accent each one rebinds.
 *
 * Blue is the editor's default and stays with the ability system; the other two
 * are far enough from it, and from each other, to be told apart at the size of
 * a card edge. Where you are is something you see before you read anything.
 */
export const GROUPS: readonly Group[] = [
  { id: 'ability', label: 'Ability system', lists: ['attributes', 'effects', 'abilities'] },
  { id: 'actors', label: 'Actors', lists: ['archetypes', 'lootTables'] },
  { id: 'economy', label: 'Economy', lists: ['items', 'categories', 'recipes', 'baseLevels'] },
];

export const LIST_LABELS: Record<ListId, string> = {
  attributes: 'Attributes',
  effects: 'Effects',
  abilities: 'Abilities',
  archetypes: 'Archetypes',
  lootTables: 'Loot tables',
  items: 'Items',
  categories: 'Categories',
  recipes: 'Recipes',
  baseLevels: 'Base levels',
};

/** What one of them is called, for a heading about a single record. */
export const SINGULAR: Record<ListId, string> = {
  attributes: 'attribute',
  effects: 'effect',
  abilities: 'ability',
  archetypes: 'archetype',
  lootTables: 'loot table',
  items: 'item',
  categories: 'category',
  recipes: 'recipe',
  baseLevels: 'base level',
};

export const GROUP_OF: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((group) => group.lists.map((list) => [list, group.id])),
);

/**
 * A field table as the data files write one: keyed by field name, each entry a
 * descriptor without its own key.
 *
 * Loosely typed on purpose. The tables live under `Engine/src/data`, which is
 * shared with the game and must not reach into the editor for a type — the
 * imports only ever run engine-wards. So the editor states what it expects to
 * find and narrows once, here, where the two meet.
 */
type FieldTable = Record<string, { kind: string; label: string } & Record<string, unknown>>;

/**
 * An archetype's own properties.
 *
 * Written here rather than lifted from a data file because there is no
 * `ARCHETYPE_FIELDS` to lift — `data/archetypes.js` describes the shape in
 * prose and the game reads the keys directly. `team` is a plain string with no
 * declared domain (`actor.js` only ever compares two of them for equality), so
 * it is a text field rather than a picker over values someone happened to use.
 */
const ARCHETYPE_FIELDS: FieldTable = {
  label: { kind: 'text', label: 'Name' },
  team: { kind: 'text', label: 'Team' },
  unarmed: { kind: 'ability', label: 'Unarmed attack' },
};

const TABLES: Partial<Record<ListId, FieldTable>> = {
  archetypes: ARCHETYPE_FIELDS,
  attributes: ATTRIBUTE_FIELDS,
  effects: EFFECT_FIELDS,
  abilities: ABILITY_FIELDS,
  items: ITEM_FIELDS,
  categories: CATEGORY_FIELDS,
  recipes: RECIPE_FIELDS,
  lootTables: LOOT_TABLE_FIELDS,
  baseLevels: BASE_LEVEL_FIELDS,
};

/**
 * Which fields a record shows, given what it is.
 *
 * Two lists vary by a `kind` the record carries — an attribute is a stat or a
 * resource, an effect is instant or lasting — and each of those declares which
 * of its table's fields apply. The same trick `data/lights.js` uses, and the
 * reason adding a duration type is a line in a data file rather than a branch
 * of interface code.
 */
export function fieldsForRecord(list: ListId, record: Record<string, unknown>): FieldSpec[] {
  const table = TABLES[list];
  if (!table) return [];

  const keys = perKindKeys(list, record) ?? Object.keys(table);
  return keys.filter((key) => table[key]).map((key) => ({ key, ...table[key] }) as FieldSpec);
}

function perKindKeys(list: ListId, record: Record<string, unknown>): string[] | null {
  if (list === 'attributes') {
    const kinds = ATTRIBUTE_KINDS as Record<string, { fields: string[] }>;
    return kinds[String(record.kind ?? 'stat')]?.fields ?? null;
  }
  if (list === 'effects') {
    const kinds = DURATION_TYPES as Record<string, { fields: string[] }>;
    return kinds[String(record.duration ?? 'instant')]?.fields ?? null;
  }
  return null;
}

/**
 * The field kinds that name another record rather than holding a value.
 *
 * These are what make the rules a graph rather than nine separate tables, and
 * what the detail pane turns into links you can follow. Only the kinds that
 * point at a list the navigator can reach are here — a `vfx` picker names a
 * real record too, but its editor is a different screen, so it gets its
 * choices (below) without getting a link.
 */
export const REFERENCE_LISTS: Record<string, ListId> = {
  attribute: 'attributes',
  effect: 'effects',
  ability: 'abilities',
  category: 'categories',
  item: 'items',
  currency: 'items',
  loot: 'lootTables',
};

/** Everything a picker's choices can come from, by the kind that asks for it. */
export type OptionSource = {
  attributeOptions: () => [string, string][];
  effectOptions: () => [string, string][];
  abilityOptions: () => [string, string][];
  categoryOptions: () => [string, string][];
  currencyOptions: () => [string, string][];
  itemOptions: () => [string, string][];
  lootTableOptions: () => [string, string][];
  vfxOptions: () => [string, string][];
  propOptions: () => [string, string][];
  materialOptions: () => [string, string][];
  surfaceOptions: () => [string, string][];
  /** Narrowed by asset kind: a colour map offers pictures, not models. */
  assetOptions: (kind?: string) => [string, string][];
};

const SOURCES: Record<string, keyof OptionSource> = {
  attribute: 'attributeOptions',
  effect: 'effectOptions',
  ability: 'abilityOptions',
  category: 'categoryOptions',
  currency: 'currencyOptions',
  item: 'itemOptions',
  loot: 'lootTableOptions',
  vfx: 'vfxOptions',
  prop: 'propOptions',
  /**
   * A field of kind `material` names a *surface* — what a block or a prop is
   * drawn with. Not `materialOptions`, which is a different thing under a
   * confusingly similar name: the crafting materials, for the pickers that
   * spend or drop one. A terrain offering "Iron ore" as its top block is what
   * getting this wrong looks like.
   */
  material: 'surfaceOptions',
  surface: 'surfaceOptions',
};

/**
 * A picker's choices, asked of the document.
 *
 * Which categories or abilities exist is data, not something a data file can
 * enumerate about itself — so the document answers, and the field components
 * stay ignorant of what a category is.
 *
 * Takes the whole descriptor rather than just its kind, because one of them
 * narrows further: an `asset` field declares which kind of file belongs in it,
 * so a colour map offers pictures and never a model.
 */
export function optionsForField(
  field: { kind: string; assetKind?: string },
  doc: OptionSource,
): readonly (readonly [string, string])[] | null {
  if (field.kind === 'asset') return doc.assetOptions(field.assetKind);
  const source = SOURCES[field.kind];
  return source ? doc[source]() : null;
}

/** Kinds a picker can answer for. Anything else is an ordinary control. */
export const isReferenceKind = (kind: string) => kind === 'asset' || kind in SOURCES;
