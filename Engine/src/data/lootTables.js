/**
 * What breaking something pays out.
 *
 * A table rather than a number on the thing that dies, because the same purse
 * should be droppable by two different monsters and, shortly, by a vase — and a
 * payout written once is a payout that can be re-balanced once. Whatever can be
 * broken names a table; the table says what falls out of it.
 *
 * A roll is a ref and a range: `{ kind, id, min, max, chance }` — how much of
 * what, and how often. The ref is the same one a price uses (see ./costs.js),
 * so a table can hand over coin for the purse or a material for the bag with no
 * second kind of row and no second path to the floor.
 *
 * Nothing stops a table naming a sword, and nothing needs to: what a table may
 * drop is a decision made in the table, and "monsters do not drop equipment" is
 * then a thing you can see by looking at them rather than a rule buried in code.
 *
 * The range is inclusive and whole, since drops are counted rather than
 * measured — the step ladder an item's stat line needs has nothing to snap to.
 */

import { COST_KINDS } from './costs.js';
import { LOOT_TABLES } from '#game/rules/lootTables.js';

/** The set itself lives in rules/, which the editor rewrites. */
export { LOOT_TABLES };

export const LOOT_TABLE_FIELDS = {
  label: { kind: 'text', label: 'Name', default: 'New loot table' },
};

/**
 * `chance` is a fraction rather than a percentage because it is multiplied by
 * an rng roll and never by a hundred; a table that read 15 and meant 0.15 would
 * be one typo away from always dropping.
 */
export const LOOT_ROLL_FIELDS = {
  min: { kind: 'number', label: 'Least', min: 0, max: 999999, step: 1, default: 1 },
  max: { kind: 'number', label: 'Most', min: 0, max: 999999, step: 1, default: 1 },
  chance: { kind: 'range', label: 'Chance', min: 0, max: 1, step: 0.05, default: 1 },
};

export { COST_KINDS as LOOT_KINDS };

const KIND_IDS = new Set(COST_KINDS.map(([id]) => id));

export function defaultLootRoll(kind = 'currency', id = '') {
  return { kind, id, min: 1, max: 1, chance: 1 };
}

export function defaultLootTable(id = 'newLootTable') {
  return { id, label: LOOT_TABLE_FIELDS.label.default, rolls: [] };
}

/**
 * Fill in anything a hand-written roll left out.
 *
 * Deliberately does *not* order the two ends, for the same reason an item's
 * stat line does not: someone typing a new range into a row that already has
 * one would watch the two boxes swap under them. Whoever rolls it orders them.
 */
export function normalizeLootRoll(roll = {}) {
  const base = defaultLootRoll(
    KIND_IDS.has(roll.kind) ? roll.kind : 'currency',
    typeof roll.id === 'string' ? roll.id : '',
  );
  const whole = (value, fallback) =>
    Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
  const chance = Number.isFinite(roll.chance) ? roll.chance : base.chance;
  return {
    kind: base.kind,
    id: base.id,
    min: whole(roll.min, base.min),
    max: whole(roll.max, base.max),
    chance: Math.min(1, Math.max(0, chance)),
  };
}

export function normalizeLootTable(def = {}) {
  return {
    ...defaultLootTable(def.id ?? 'newLootTable'),
    ...def,
    rolls: (def.rolls ?? []).map(normalizeLootRoll),
  };
}

/** Look tables up by id. Callers hold the array; this is the index. */
export function lootTableMap(defs = LOOT_TABLES) {
  return new Map(defs.map((def) => [def.id, normalizeLootTable(def)]));
}
