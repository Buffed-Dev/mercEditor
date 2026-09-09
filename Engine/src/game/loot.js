/**
 * Taking things off the floor.
 *
 * The floor is reached two ways — clicking a name plate, and walking over a
 * pile of coin — so what picking a thing up *means* lives here rather than at
 * either of those two doors. Two copies of this would be two copies of the
 * rule that coin does not go in the bag, and they would drift.
 *
 * A pile of coin is an ordinary drop whose contents are
 * `{ label, currency, amount }` instead of a rolled item. Nothing in
 * game/ground.js or the view that draws it was taught about money: the list
 * holds what it was given and the plate says whatever `label` says, which is
 * why coin needed no second kind of drop — and why a second *currency* needs
 * nothing here beyond a different id in the same field.
 */

import { currencyMap } from '../data/currencies.js';
import { itemMap } from '../data/items.js';
import { lootTableMap, normalizeLootRoll } from '../data/lootTables.js';
import { SETTLE_SECONDS } from './ground.js';
import { countOf, rollItem, withCount } from './items.js';

/** How close you have to be for coin to be swept up off the floor. */
export const COIN_REACH = 0.8;

/**
 * Whether a drop has finished falling, on the caller's clock.
 *
 * Coin is swept by standing on it, and a kill usually happens under your feet,
 * so without this the pile is gone in the frame it appears and the toss you
 * were meant to see never draws. A drop with no `at` — one an authored map
 * simply has lying about — was never thrown and is settled from the start.
 *
 * The epsilon is not fussiness: both sides of this are sums of frame times, and
 * a landing that is short by 4e-16 would hold the coin for one more frame every
 * so often for no reason anyone could ever find.
 */
export function settled(drop, now) {
  if (!drop?.at) return true;
  return now - drop.at >= SETTLE_SECONDS - 1e-9;
}

/**
 * What a drop is worth, or null when it is an item rather than coin.
 *
 * Returns the whole line — which currency as well as how much — because with
 * more than one kind of money "how much" is not an answer on its own.
 */
export function coinOf(drop) {
  const { currency, amount } = drop?.item ?? {};
  if (!currency || !Number.isFinite(amount) || amount <= 0) return null;
  return { currency, amount };
}

/**
 * Take one drop off the floor: coin into the purse, an item into the bag.
 *
 * The bag is checked *before* an item is lifted. Taking it first and then
 * finding nowhere to put it would mean either dropping it again on a tile that
 * may since have been taken, or losing it outright. Coin is never refused for a
 * full bag, because it does not go in the bag.
 *
 * @returns {{ok: boolean, reason: ''|'gone'|'full', item: object|null, gold: number}}
 */
export function collect(id, { ground, character }) {
  const drop = ground.at(id);
  if (!drop) return { ok: false, reason: 'gone', item: null, coin: null };

  const coin = coinOf(drop);
  if (coin) {
    ground.take(id);
    character.earn(coin.currency, coin.amount);
    return { ok: true, reason: '', item: null, coin };
  }

  // A stack may go in part of the way: twelve ore with room for five leaves
  // seven on the floor rather than refusing the lot. Only a pickup that moves
  // nothing at all is a refusal.
  const left = character.inventory.add(drop.item);
  if (countOf(left) >= countOf(drop.item)) {
    return { ok: false, reason: 'full', item: null, coin: null };
  }

  const item = drop.item;
  if (left) ground.keep(id, left);
  else ground.take(id);
  return { ok: true, reason: '', item, coin: null, left };
}

/**
 * Sweep up every pile within reach of a position.
 *
 * Coin is picked up by walking over it and an item is not, because nobody has
 * ever wanted to decline a coin — making one a click is asking a question with
 * a single answer. An item is a choice, since the bag is finite.
 *
 * A pile still in the air is left alone until it lands. `now` defaults to
 * never-waiting so a caller with no clock still sweeps everything.
 *
 * @returns {number} how many piles were picked up.
 *
 * @returns {number} how much was picked up, for whoever wants to say so.
 */
export function sweepCoin(at, { ground, character, now = Infinity }) {
  let taken = 0;
  for (const drop of ground.list()) {
    if (!coinOf(drop)) continue;
    if (!settled(drop, now)) continue;
    if (Math.hypot(drop.gx - at.gx, drop.gy - at.gy) > COIN_REACH) continue;
    if (collect(drop.id, { ground, character }).ok) taken++;
  }
  return taken;
}

/**
 * What falls out of a loot table, as a list of piles to drop.
 *
 * Every roll is asked independently, so a table can hand over a handful of gold
 * every time and a shard once in a while without those two competing. The rng
 * is an argument for the same reason it is one when an item rolls: a seeded run
 * has to pay out the same twice.
 */
export function rollLoot(tableId, { lootTables, currencies, items, categories, rng = Math.random }) {
  const table = lootTableMap(tableId ? lootTables : []).get(tableId);
  if (!table) return [];

  const names = currencyMap(currencies);
  const defs = itemMap(items, categories);
  const dropped = [];

  for (const line of table.rolls) {
    const roll = normalizeLootRoll(line);
    // A roll naming something that has since been deleted pays nothing, rather
    // than a pile called "undefined" that cannot be spent on anything.
    const known = roll.kind === 'currency' ? names.has(roll.id) : defs.has(roll.id);
    if (!roll.id || !known) continue;
    if (rng() >= roll.chance) continue;

    // Ordered here rather than in the data, so a range typed the wrong way
    // round pays out instead of paying nothing — see normalizeLootRoll.
    const min = Math.min(roll.min, roll.max);
    const max = Math.max(roll.min, roll.max);
    const amount = min + Math.floor(rng() * (max - min + 1));
    if (!amount) continue;

    // Coin goes to the purse and an item goes in the bag, so they are made of
    // different stuff — but both are just "what a drop is holding", and the
    // floor has never cared which.
    const thing =
      roll.kind === 'currency'
        ? coinPile(roll.id, amount, names)
        : rollItem(defs.get(roll.id), rng, amount);
    if (thing) dropped.push(thing);
  }
  return dropped;
}

/**
 * What a pile of coin looks like as a drop's contents.
 *
 * The label is written once, here, because it is what the plate over the pile
 * says and there is nowhere else that knows both the number and the name.
 * Rounded and never negative: a monster worth nothing leaves nothing, which is
 * the caller's cue not to drop at all.
 */
export function coinPile(currency, amount, currencies = undefined) {
  const held = Math.max(0, Math.round(amount) || 0);
  if (!currency || !held) return null;
  const names = currencies instanceof Map ? currencies : currencyMap(currencies);
  const label = names.get(currency)?.label ?? currency;
  return { label: `${held} ${label}`, currency, amount: held };
}
