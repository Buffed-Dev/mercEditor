/**
 * Rolling a definition into an item you can actually carry.
 *
 * A definition holds ranges — 4–6 attack power — and is shared by every short
 * sword there will ever be. Rolling produces one sword with settled numbers,
 * and that instance is what a bag, a stash or the floor holds. See
 * ../data/items.js for why the two shapes are kept apart.
 *
 * A rolled stat is `{ attribute, op, value }`, which is exactly the modifier
 * shape createAttributeSet already takes. That is deliberate: equipping an item
 * is adding its stats as modifiers, so it goes through the same arithmetic as
 * every buff and debuff in the game rather than a parallel one for equipment.
 *
 * Nothing here reads a global. The rng is an argument so a drop can be replayed
 * — a seeded run has to produce the same sword twice — and the definition is
 * passed in rather than looked up so the rules editor can roll from unsaved
 * values while play-testing.
 */

import {
  normalizeItem,
  normalizeItemStat,
  stackLimit,
  statRungs,
  type ItemInput,
  type ItemSlot,
  type ItemStatInput,
} from '../data/items.ts';
import type { ModifierOp } from '../data/effects.ts';

/** One stat line after it has been rolled: a settled number, not a range. */
export type RolledStat = { attribute: string; op: ModifierOp; value: number };

/**
 * One item that exists, as opposed to the definition it was rolled from.
 *
 * `data/items.ts` describes what a Sword *is*; this is a particular sword,
 * with its own identity and its own rolled numbers. Two of them can share a
 * `defId` and still differ, which is the whole point of rolling stats.
 */
export type ItemInstance = {
  uid: string;
  defId: string;
  label: string;
  slot: ItemSlot | 'none';
  /** Ability id this grants while worn, or empty. */
  grants: string;
  /** How many of this fit in one bag cell. */
  stack: number;
  count: number;
  stats: RolledStat[];
};

/** An amount of one currency. */
export type Coin = { currency: string; amount: number };

/** A heap of money lying on the floor, with what to call it. */
export type CoinPile = Coin & { label: string };

/**
 * Anything that can be dropped and picked up.
 *
 * Money is not an item -- it goes into the purse rather than the bag, and has
 * no definition, no stats and no slot -- but it lies on the floor in exactly
 * the same way, so the ground holds either.
 */
export type Loot = ItemInstance | CoinPile;

/** True for the money half of `Loot`. Only a coin pile names a currency. */
export const isCoinPile = (loot: Loot): loot is CoinPile => 'currency' in loot;

/** How many of something is being carried. Anything countable answers this. */
export type Countable = { count?: number; stack?: number; defId?: string };

/** A unique enough handle to tell two identical swords apart in a container. */
let serial = 0;

/**
 * How many decimals a step implies, so 0.1 + 0.2 does not surface as 4.3000001
 * on a character sheet. Derived from the step rather than fixed, because the
 * same item carries a whole-number damage roll and a two-decimal speed.
 */
function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(6, text.length - dot - 1);
}

/**
 * One value off the ladder that starts at `min` and climbs in `step`s.
 *
 * Every rung is equally likely, which is the point of rolling in steps at all:
 * 4–6 damage gives 4, 5 or 6 a third of the time each. Rounding a continuous
 * roll instead would make 5 twice as common as either end, for no reason a
 * player could ever discover.
 *
 * A rung past `max` is not on the ladder, so a range that is not a whole number
 * of steps simply stops short rather than overshooting what the author wrote.
 */
export function rollStat(stat: ItemStatInput, rng: () => number = Math.random): RolledStat {
  const { attribute, op } = normalizeItemStat(stat);
  const { count, min, step } = statRungs(stat);
  const value = min + Math.floor(rng() * count) * step;
  return {
    attribute,
    op,
    value: Number(value.toFixed(decimalsOf(step))),
  };
}

/**
 * One item, rolled.
 *
 * `label` and `slot` are copied onto the instance rather than left behind a
 * definition id, because everything that holds an item — a bag cell, an
 * equipment slot, a name floating over the floor — needs those two and nothing
 * else. `defId` stays for the things that do care which definition it came
 * from, and survives a rules edit that renames the label.
 *
 * `grants` is copied for the same reason `slot` is: what an actor can do
 * while wearing something is decided by looking at what it is wearing, and what
 * it is wearing is a bag of instances rather than a list of definitions.
 *
 * `stack` is copied for the same reason: a bag deciding whether two things
 * merge would otherwise have to hold the definitions, and it holds items. One
 * is what equipment carries, which is what makes "swords do not stack" the same
 * rule as "twenty ore do" rather than a special case beside it.
 *
 * `count` is how many this instance *is*. Equipment is always one; a material
 * arrives in whatever number fell out of the thing that dropped it — which may
 * be more than fits in one cell, and is deliberately not clamped here. A drop
 * of thirty ore is thirty ore; splitting it across cells is the bag's job, and
 * rounding it down to twenty at the moment it is created would lose ten before
 * anything had a chance to carry them.
 */
export function rollItem(
  def: ItemInput | null | undefined,
  rng: () => number = Math.random,
  count = 1,
): ItemInstance | null {
  if (!def) return null;
  const item = normalizeItem(def);
  const stack = stackLimit(item);
  return {
    uid: `item${++serial}`,
    defId: item.id,
    label: item.label,
    slot: item.slot,
    grants: item.grants,
    stack,
    count: Math.max(1, Math.round(count) || 1),
    stats: item.stats.map((stat) => rollStat(stat, rng)),
  };
}

/** How many this instance is. Anything without a count is one of itself. */
export function countOf(item: Countable | null | undefined): number {
  const count = item?.count;
  // `typeof` as well as isFinite: the first is what narrows the type, the
  // second is what rejects NaN and Infinity. isFinite alone does both at
  // runtime but tells the compiler nothing.
  return typeof count === 'number' && Number.isFinite(count)
    ? Math.max(0, Math.round(count))
    : item
      ? 1
      : 0;
}

/** How many of this one share a cell. Anything without a limit does not stack. */
export function stackOf(item: Countable | null | undefined): number {
  const stack = item?.stack;
  return typeof stack === 'number' && Number.isFinite(stack) && stack > 1
    ? Math.round(stack)
    : 1;
}

/** Whether these two are the same thing, and that thing stacks. */
export function stacks(
  a: Countable | null | undefined,
  b: Countable | null | undefined,
): boolean {
  return Boolean(a && b && a.defId === b.defId && stackOf(a) > 1 && stackOf(b) > 1);
}

/** The same stack with a different count. Below one it is nothing at all. */
export function withCount(item: ItemInstance, count: number): ItemInstance | null {
  const held = Math.max(0, Math.round(count) || 0);
  return held > 0 ? { ...item, count: held } : null;
}

/**
 * The best and worst this definition can roll, per stat line.
 *
 * For anything that has to describe an item it has not rolled yet — a drop
 * table, or the editor showing what a definition is worth.
 */
export function itemRange(
  def: ItemInput,
): { attribute: string; op: ModifierOp; min: number; max: number }[] {
  return normalizeItem(def).stats.map((stat) => {
    const { min, max } = statRungs(stat);
    return { attribute: stat.attribute, op: stat.op, min, max };
  });
}
