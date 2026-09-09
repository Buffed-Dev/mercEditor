/**
 * The kinds of money.
 *
 * A currency is a name and a number the player carries, and nothing else knows
 * how many there are: a price is a list of `{ currency, amount }`, a purse is
 * keyed by id, and a loot roll names one. Adding a second kind is a row in the
 * item list rather than a branch anywhere.
 *
 * There is no separate list of currencies any more. A currency **is** an item,
 * in a category that behaves as currency — see ./categories.js — which is why
 * this file has no data of its own: it is the money-shaped view of the item
 * list, and everything below it (the purse, a price, a loot roll) is unchanged
 * because it only ever wanted `{ id, label, start }`.
 *
 * The difference between a currency and a **material** is exactly whether the
 * thing takes up room: money is spent, never carried, so it has no bag cell, no
 * stat lines and nothing to pick up but a number.
 */

import { ITEMS, currenciesOf, type Currency } from './items.ts';

/** A currency as a rules file writes it. */
export type CurrencyInput = Partial<Currency>;

/** Every currency in the shipped rules. Anything editing rules derives its own
 *  with currenciesOf(items), the way createLevel does. */
export const CURRENCIES = currenciesOf(ITEMS);

export function defaultCurrency(id = 'newCurrency'): Currency {
  return { id, label: 'New currency', start: 0 };
}

export function normalizeCurrency(def: CurrencyInput = {}): Currency {
  const start = Number.isFinite(def.start) ? Math.round(def.start as number) : 0;
  return {
    ...defaultCurrency(def.id ?? 'newCurrency'),
    ...def,
    start: Math.min(999999, Math.max(0, start)),
  };
}

/** Look currencies up by id. Callers hold the array; this is the index. */
export function currencyMap(
  defs: readonly CurrencyInput[] = CURRENCIES,
): Map<string, Currency> {
  return new Map(defs.map((def) => [def.id ?? 'newCurrency', normalizeCurrency(def)]));
}
