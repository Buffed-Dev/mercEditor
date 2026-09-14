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
] as const;

/** Which of the two lists a ref names. */
export type CostKind = (typeof COST_KINDS)[number][0];

/** One line of a price: which thing, and how much of it. */
export type Cost = { kind: CostKind; id: string; amount: number };

/**
 * The minimum a definition has to offer to be named in a price.
 *
 * Structural rather than imported: this file sits beneath both the currency
 * list and the item list, so it knows only that the things in them have an id
 * and, usually, a name for it.
 */
type Labelled = { id?: string; label?: string };

/** Names a cost's thing. See `costLabeller`. */
export type CostLabeller = (kind: CostKind, id: string) => string;

/**
 * A cost as a rules file writes it, before `normalizeCost` has looked at it.
 *
 * Every field is optional and `kind` is a plain string, because this is the
 * seam where hand-edited content enters typed code: the rules files under
 * `Games/` are outside the type checker, and a person editing one can write
 * anything. Saying so here is what lets the normalizers below be the only
 * place that decides what a malformed row becomes. A `Cost` satisfies this
 * type, so already-checked callers pass straight through.
 */
export type CostInput = { kind?: string; id?: string; amount?: number };

export const isCostKind = (value: unknown): value is CostKind =>
  COST_KINDS.some(([id]) => id === value);

export const COST_FIELDS = {
  amount: { kind: 'number', label: 'Amount', min: 0, max: 999999, step: 1, default: 10 },
} as const;

export function defaultCost(kind: CostKind = 'currency', id = ''): Cost {
  return { kind, id, amount: COST_FIELDS.amount.default };
}

export function normalizeCost(cost: CostInput = {}): Cost {
  const kind = isCostKind(cost.kind) ? cost.kind : 'currency';
  const amount = Number.isFinite(cost.amount) ? Math.round(cost.amount as number) : COST_FIELDS.amount.default;
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
export function normalizeCosts(costs: readonly CostInput[] = []): Cost[] {
  const total = new Map<string, Cost>();
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
export function describeCosts(
  costs: readonly CostInput[],
  labelOf: CostLabeller = (_kind, id) => id,
): string {
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
export function costLabeller({
  currencies = [],
  items = [],
}: {
  currencies?: readonly Labelled[] | undefined;
  items?: readonly Labelled[] | undefined;
} = {}): CostLabeller {
  const names: Record<CostKind, Map<string, string>> = {
    currency: new Map(currencies.map((def) => [def.id ?? '', def.label || def.id || ''])),
    item: new Map(items.map((def) => [def.id ?? '', def.label || def.id || ''])),
  };
  return (kind, id) => names[kind].get(id) ?? id;
}
