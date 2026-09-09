/**
 * Items: what a definition is, and what rolling one produces.
 *
 * There are two shapes here and keeping them apart is the whole design.
 *
 * A **definition** is what the data editor edits. It says a short sword gives
 * 4–6 attack power and 1.2 attacks a second — a *range*, not a number. It is
 * shared by every short sword that will ever exist and is never carried by
 * anyone.
 *
 * An **instance** is one particular short sword, rolled out of that definition
 * when it drops. Its stats are settled numbers. That is what goes in a bag, a
 * stash, or on the floor, and it is the only shape the rest of the game sees —
 * see rollItem in ../game/items.js.
 *
 * The split is why a range costs nothing later: random affixes are more rolled
 * stats appended to the same instance list, from a different source. Nothing
 * downstream of the roll has to learn about them.
 *
 * Equipment can also **grant an ability**: a sword is what makes you able to
 * swing, a gun what makes you able to shoot. It is one id on the definition
 * rather than a copy of the ability, so what swinging *does* stays in one place
 * and every sword agrees about it.
 *
 * Every item names a **category** — see ./categories.js — and the category
 * says which of three machines it runs on. **Equipment** claims a slot and
 * rolls stat lines, and is the only thing a bench makes. A **material** claims
 * nothing and does nothing: it stacks in the bag and is spent making equipment,
 * so monsters drop those and never drop a sword. A **currency** is never
 * carried at all — it is a number in the purse, with a `start` saying what a
 * new character has of it.
 *
 * What an item is *worth* lives here too, as `costs` — a list of cost lines
 * (see ./costs.ts), each naming a currency or another item. On the definition
 * rather than on the recipe that makes it, because it is a fact about the sword
 * rather than about one way of getting one: price it once and every bench
 * charges the same.
 *
 * A stat is `{ attribute, op, min, max, step }` and rolls into the modifier
 * shape the attribute set already understands — `{ attribute, op, value }` —
 * so equipping an item, when that is built, is applying modifiers and not a
 * new mechanism.
 */

import {
  CATEGORIES,
  behaviourOf,
  isCategoryBehaviour,
  type CategoryBehaviour,
  type CategoryInput,
} from './categories.ts';
import type { CostInput } from './costs.ts';
import type { ModifierOp } from './effects.ts';
import { ITEMS as GAME_ITEMS } from '#game/rules/items.js';

/**
 * The slot kinds an item can claim.
 *
 * These are *kinds*, not the character sheet's slots: the doll has two ring
 * slots and a ring is just a ring. ../game/inventory.js maps its slots onto
 * these, which is what lets one ring go in either hand.
 */
export const ITEM_SLOTS = [
  ['mainHand', 'Main hand'],
  ['offHand', 'Off hand'],
  ['head', 'Head'],
  ['chest', 'Chest'],
  ['hands', 'Hands'],
  ['legs', 'Legs'],
  ['feet', 'Feet'],
  ['amulet', 'Amulet'],
  ['ring', 'Ring'],
] as const;

/** Where a worn item goes. `none` is what everything else gets. */
export type ItemSlot = (typeof ITEM_SLOTS)[number][0];

export const ITEM_SLOT_IDS: ReadonlySet<string> = new Set(ITEM_SLOTS.map(([id]) => id));

export const isItemSlot = (value: unknown): value is ItemSlot =>
  typeof value === 'string' && ITEM_SLOT_IDS.has(value);

/** One rollable stat line on a piece of equipment. */
export type ItemStat = {
  attribute: string;
  op: ModifierOp;
  min: number;
  max: number;
  step: number;
};

/** A stat line as a rules file writes it. */
export type ItemStatInput = {
  attribute?: string;
  op?: string;
  min?: number;
  max?: number;
  step?: number;
};

export type Item = {
  id: string;
  label: string;
  /** Which of the three machines this is, read through `category`. */
  kind: CategoryBehaviour;
  category: string;
  icon: string;
  slot: ItemSlot | 'none';
  grants: string;
  start: number;
  stats: ItemStat[];
  /** Left as written; `recipeCosts` is what normalizes them. */
  costs: CostInput[];
};

/**
 * A fresh item, before a category has told it what kind of thing it is.
 *
 * `kind` is absent rather than guessed because it is derived, never stored --
 * see the note above `stackLimit`.
 */
export type NewItem = Omit<Item, 'kind'>;

/** An item as a rules file writes it. */
export type ItemInput = {
  id?: string;
  label?: string;
  /** Written before categories existed. Read, never written. */
  kind?: string;
  category?: string;
  icon?: string;
  slot?: string;
  grants?: string;
  start?: number;
  stats?: readonly ItemStatInput[];
  costs?: readonly CostInput[];
};

/** Money, as `currenciesOf` distils it out of the item list. */
export type Currency = { id: string; label: string; icon?: string; start: number };

/** A category's behaviour, defaults filled in — categoryMap without the map. */
const normalizeCategoryBehaviour = (entry: CategoryInput | undefined): CategoryBehaviour =>
  isCategoryBehaviour(entry?.behaviour) ? entry.behaviour : 'material';

/** The first category running on this machine — what a new item of it lands in. */
const firstCategory = (
  behaviour: CategoryBehaviour,
  categories: readonly CategoryInput[] = CATEGORIES,
): string | undefined =>
  (categories ?? []).find((entry) => normalizeCategoryBehaviour(entry) === behaviour)?.id;

/**
 * What an item is for.
 *
 * An item names a **category** — the author's own word, Weapon or Reagent or
 * Coin — and the category names one of three machines: equipment, material or
 * currency (see ./categories.js). `kind` is that machine, read through the
 * category rather than stored: whether the thing has a slot, rolls stats,
 * stacks, or lands in the purse all follow from it, and none of them can
 * disagree with the label on the tin.
 */

/**
 * How many of one material share a bag cell.
 *
 * One number for every material rather than a field per definition: the bag is
 * meant to be a constraint, and the only thing worth tuning is how hard. This
 * is that knob.
 */
export const STACK_MAX = 20;

/** How many of this definition fit in a cell. Equipment never stacks. */
export function stackLimit(
  def: ItemInput,
  categories: readonly CategoryInput[] = CATEGORIES,
): number {
  return normalizeItem(def, categories).kind === 'material' ? STACK_MAX : 1;
}

export const ITEM_FIELDS = {
  label: { kind: 'text', label: 'Name', default: 'New item' },
  // Resolved to a picker of the document's own categories by the editor: which
  // categories exist is data, not something this file can enumerate.
  category: { kind: 'category', label: 'Category', default: 'material' },
  icon: { kind: 'icon', label: 'Icon', default: '' },
  slot: { kind: 'select', label: 'Slot', options: ITEM_SLOTS, default: 'mainHand' },
  /**
   * What a new character has of this, for the ones that are money.
   *
   * On the currency rather than on the character because it is a fact about the
   * money — "this is the one everybody begins with a handful of" — and because
   * the character is built before anything has told it what money exists.
   */
  start: { kind: 'number', label: 'Start with', min: 0, max: 999999, step: 1, default: 0 },
  // Resolved to a picker of real abilities by the editor, the way a recipe's
  // item is: data/ has no idea which abilities exist in the open document.
  grants: { kind: 'ability', label: 'Grants', default: '' },
} as const;

/**
 * One rollable stat line.
 *
 * `step` is what makes the roll read like a game rather than like arithmetic:
 * 4–6 damage should give 4, 5 or 6, and 1.15–1.25 attack speed should give
 * 1.17 rather than 1.1732891. Snapping is per line because those two live on
 * the same item.
 */
export const ITEM_STAT_FIELDS = {
  min: { kind: 'number', label: 'Least', min: -9999, max: 9999, step: 0.01, default: 1 },
  max: { kind: 'number', label: 'Most', min: -9999, max: 9999, step: 0.01, default: 1 },
  step: { kind: 'number', label: 'Steps of', min: 0.01, max: 100, step: 0.01, default: 1 },
} as const;

/** The set itself lives in rules/, which the editor rewrites. */
/** Left unnormalized: the rules editor reads this straight into what it saves. */
export const ITEMS = GAME_ITEMS as ItemInput[];

/**
 * The values a stat line can roll: the ladder from the low end upwards in
 * `step`s, stopping at or before the high end.
 *
 * This is where the two ends are put the right way round, since it is the only
 * place the order changes an answer. Lives here rather than in the roll because
 * the editor has to describe a line it is not rolling, and two copies of this
 * arithmetic would drift.
 */
export function statRungs(stat: ItemStatInput): {
  count: number;
  min: number;
  max: number;
  step: number;
  top: number;
} {
  const line = normalizeItemStat(stat);
  const min = Math.min(line.min, line.max);
  const max = Math.max(line.min, line.max);
  const { step } = line;
  const count = Math.floor((max - min) / step + 1e-9) + 1;
  return { count, min, max, step, top: min + (count - 1) * step };
}

export function defaultItemStat(attribute = 'attackPower'): ItemStat {
  return { attribute, op: 'add', min: 1, max: 1, step: 1 };
}

export function defaultItem(
  id = 'newItem',
  categories: readonly CategoryInput[] = CATEGORIES,
): NewItem {
  return {
    id,
    label: ITEM_FIELDS.label.default,
    // A new item is a piece of gear until it is told otherwise, which is what
    // an item with nothing said about it has always been.
    category: firstCategory('equipment', categories) ?? ITEM_FIELDS.category.default,
    icon: ITEM_FIELDS.icon.default,
    slot: ITEM_FIELDS.slot.default,
    grants: ITEM_FIELDS.grants.default,
    start: ITEM_FIELDS.start.default,
    stats: [],
    costs: [],
  };
}

/**
 * Fill in anything a hand-written definition left out.
 *
 * Deliberately does *not* order the two ends. An author who types 6 into
 * "least" and 4 into "most" means 4–6 and statRungs reads it that way, but the
 * stored line stays exactly as typed: a pane that rendered the ordered version
 * would swap the two boxes out from under someone halfway through typing a new
 * range into a row that already has one.
 */
export function normalizeItemStat(stat: ItemStatInput = {}): ItemStat {
  const base = defaultItemStat(stat.attribute ?? 'attackPower');
  const min = Number.isFinite(stat.min) ? (stat.min as number) : base.min;
  const max = Number.isFinite(stat.max) ? (stat.max as number) : base.max;
  const step =
    Number.isFinite(stat.step) && (stat.step as number) > 0 ? (stat.step as number) : base.step;
  return {
    attribute: base.attribute,
    op: stat.op === 'multiply' || stat.op === 'override' ? stat.op : 'add',
    min,
    max,
    step,
  };
}

/**
 * `categories` is passed in so the editor can normalize against the document it
 * is editing rather than against the file on disk — the same reason createLevel
 * takes a rules bundle. Everything in the running game reads the shipped set,
 * which is the default.
 */
export function normalizeItem(
  def: ItemInput = {},
  categories: readonly CategoryInput[] = CATEGORIES,
): Item {
  // A definition written before categories existed says `kind: 'equipment'`
  // outright. It is read as the behaviour it names, so a hand-written file — or
  // a test fixture — does not have to invent a category to say what it already
  // said. A real category always wins over it.
  const named = (categories ?? []).some((category) => category.id === def.category);
  const kind: CategoryBehaviour = named
    ? behaviourOf(def.category, categories)
    : isCategoryBehaviour(def.kind)
      ? def.kind // written before categories existed: `kind: 'equipment'`
      : def.category
        ? behaviourOf(def.category, categories) // a category that has since gone
        : 'equipment'; // nothing said at all, which is what an item used to be
  // The result has to normalize to itself: something that came in as a bare
  // `kind` goes out in a category that means the same thing, or normalizing the
  // normalized item a second time — which rollItem does — would read the
  // default category back and turn a sword into a stack of ore.
  // The '' on the named branch is not dead: a category row whose own id is
  // missing matches an item that names no category at all, and the else branch
  // already falls back the same way.
  const category: string = named
    ? (def.category ?? '')
    : (firstCategory(kind, categories) ?? def.category ?? '');
  const wearable = kind === 'equipment';
  // Anything that is not equipment has no slot at all, rather than a slot
  // nobody wears. An empty one would pass the "does this fit here" test in
  // ../game/inventory.js, which reads a missing slot as "goes anywhere" — so
  // ore would be wearable.
  const slot: ItemSlot | 'none' = wearable
    ? isItemSlot(def.slot)
      ? def.slot
      : ITEM_FIELDS.slot.default
    : 'none';
  const start = Number.isFinite(def.start) ? Math.round(def.start as number) : 0;
  return {
    ...defaultItem(def.id ?? 'newItem'),
    ...def,
    kind,
    category,
    slot,
    icon: typeof def.icon === 'string' ? def.icon : '',
    // Nothing wears a material or a coin, so neither a stat line nor an ability
    // on one could ever apply.
    grants: wearable && typeof def.grants === 'string' ? def.grants : '',
    stats: wearable ? (def.stats ?? []).map(normalizeItemStat) : [],
    // Only money is carried as a number, so only money starts with any.
    start: kind === 'currency' ? Math.min(999999, Math.max(0, start)) : 0,
    // Prices are left exactly as stored. They are tidied where they are spent —
    // the editor has to be able to show a row you are halfway through typing.
    costs: [...(def.costs ?? [])],
  };
}

/** Look items up by id. Callers hold the array; this is the index. */
export function itemMap(
  defs: readonly ItemInput[] = ITEMS,
  categories: readonly CategoryInput[] = CATEGORIES,
): Map<string, Item> {
  return new Map(defs.map((def) => [def.id ?? 'newItem', normalizeItem(def, categories)]));
}

/**
 * The money, out of the item list.
 *
 * Currencies used to be a list of their own. They are items in a category that
 * behaves as currency now — one editor tab, one set of ids, one place a price
 * can point at — and this is the view of them the purse, the loot roll and the
 * crafting panel want: id, name, and what you start with.
 */
export function currenciesOf(
  defs: readonly ItemInput[] = ITEMS,
  categories: readonly CategoryInput[] = CATEGORIES,
): Currency[] {
  return defs
    .map((def) => normalizeItem(def, categories))
    .filter((item) => item.kind === 'currency')
    .map(({ id, label, icon, start }) => ({ id, label, icon, start }));
}
