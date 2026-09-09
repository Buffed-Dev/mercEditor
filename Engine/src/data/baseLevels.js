/**
 * What each level of the base costs to build.
 *
 * A table rather than a curve. A formula is two numbers and no decisions; a
 * table is a decision per level, which is what you want the moment level 4 is
 * meant to be the wall and level 5 the reward for getting over it. The cost is
 * a price like any other, so a tier can ask for gold and shards at once.
 *
 * Each row names the level it *buys*, so the row marked 3 is what takes a base
 * from 2 to 3. Naming the destination rather than relying on the row's position
 * means a row inserted in the middle cannot silently re-price everything below
 * it, and a level with no row is simply not for sale.
 */

import { BASE_LEVELS } from '#game/rules/baseLevels.js';

/** The set itself lives in rules/, which the editor rewrites. */
export { BASE_LEVELS };

export const BASE_LEVEL_MIN = 1;

export const BASE_LEVEL_FIELDS = {
  level: { kind: 'range', label: 'Reaches level', min: 2, max: 20, step: 1, default: 2 },
};

export function defaultBaseLevel(id = 'newBaseLevel') {
  return { id, level: BASE_LEVEL_FIELDS.level.default, costs: [] };
}

export function normalizeBaseLevel(def = {}) {
  const level = Number.isFinite(def.level) ? Math.round(def.level) : BASE_LEVEL_FIELDS.level.default;
  return {
    ...defaultBaseLevel(def.id ?? 'newBaseLevel'),
    ...def,
    level: Math.min(BASE_LEVEL_FIELDS.level.max, Math.max(2, level)),
    costs: def.costs ?? [],
  };
}

/**
 * The rung above `level`, or null when there is none.
 *
 * "None" is what makes a base fully built: the table's own top is the cap, so
 * there is no maximum written down somewhere else to keep in step with it.
 */
export function nextBaseLevel(level, defs = BASE_LEVELS) {
  const want = Math.round(level) + 1;
  return defs.map(normalizeBaseLevel).find((rung) => rung.level === want) ?? null;
}

/** The highest level the table can reach. */
export function topBaseLevel(defs = BASE_LEVELS) {
  return defs.reduce((top, def) => Math.max(top, normalizeBaseLevel(def).level), BASE_LEVEL_MIN);
}
