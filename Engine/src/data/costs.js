/**
 * What something costs, and what a loot table hands over.
 *
 * Both answer the same question — *which thing, and how much of it* — and the
 * thing is either a currency in the purse or an item in the bag. So both are
 * written as a **ref**: `{ kind: 'currency' | 'item', id }`, with an amount or a
 * range bolted on. One shape means one picker in the editor, one affordability
 * check, and no branch that has to be remembered in two places.
 *
 * This module imports nothing. It is the bottom of the data layer: items name
 * their price in terms of it, so it cannot know what an item is without the two
 * files importing each other. Anything that needs to *name* a cost — to write
 * "2 Iron ore" — passes the labels in.
 */

export const COST_KINDS = [
  ['currency', 'Currency'],
  ['item', 'Item'],
];

const KIND_IDS = new Set(COST_KINDS.map(([id]) => id));

export const COST_FIELDS = {
  amount: { kind: 'number', label: 'Amount', min: 0, max: 999999, step: 1, default: 10 },
};

export function defaultCost(kind = 'currency', id = '') {
  return { kind, id, amount: COST_FIELDS.amount.default };
}

export function normalizeCost(cost = {}) {
  const kind = KIND_IDS.has(cost.kind) ? cost.kind : 'currency';
  const amount = Number.isFinite(cost.amount) ? Math.round(cost.amount) : COST_FIELDS.amount.default;
  return {
    kind,
    id: typeof cost.id === 'string' ? cost.id : '',
    amount: Math.min(COST_FIELDS.amount.max, Math.max(0, amount)),
  };
}

/**
 * Tidy a price.
 *
 * Lines naming nothing are dropped — a half-filled row in the editor is not a
 * price — and two lines naming the same thing are added together, so a cost can
 * never be checked against itself and paid twice.
 *
 * The editor deliberately renders the *stored* rows rather than these: adding a
 * second gold line and watching it fold into the first would look broken.
 */
export function normalizeCosts(costs = []) {
  const total = new Map();
  for (const line of costs) {
    const cost = normalizeCost(line);
    if (!cost.id || !cost.amount) continue;
    const key = `${cost.kind}:${cost.id}`;
    const seen = total.get(key);
    if (seen) seen.amount += cost.amount;
    else total.set(key, cost);
  }
  return [...total.values()];
}

/**
 * A price as words: "40 Gold + 2 Iron ore".
 *
 * `labelOf(kind, id)` is passed in rather than looked up, because naming a cost
 * needs both the currency list and the item list and this file is beneath both.
 */
export function describeCosts(costs, labelOf = (kind, id) => id) {
  const lines = normalizeCosts(costs);
  if (!lines.length) return 'Free';
  return lines.map(({ kind, id, amount }) => `${amount} ${labelOf(kind, id)}`).join(' + ');
}

/**
 * The labeller the rest of the game builds from its two lists.
 *
 * Here rather than at each call site so "an id nobody recognises still prints
 * as itself" is decided once — a price that silently showed a blank would hide
 * exactly the reference that has gone stale.
 */
export function costLabeller({ currencies = [], items = [] } = {}) {
  const names = {
    currency: new Map(currencies.map((def) => [def.id, def.label || def.id])),
    item: new Map(items.map((def) => [def.id, def.label || def.id])),
  };
  return (kind, id) => names[kind]?.get(id) ?? id;
}
