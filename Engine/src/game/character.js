/**
 * What one player owns, and keeps.
 *
 * A level is built and thrown away every time a map changes. Everything a
 * character has been given — the bag, the coin, the thing on the cursor — must
 * outlive that, so it lives here and is handed *to* the level rather than owned
 * by it. The floor is the exception and stays with the level: a dropped item
 * belongs to the place it was dropped in.
 *
 * One of these per player rather than one for the game, because the game is
 * going to have more than one player in it, and a purse the party shares is a
 * different design decision from a purse that happens to be a global.
 *
 * Storage and arithmetic only. Wearing an item applies its modifiers to an
 * actor's attributes, and the actor belongs to the level — see ../game/equipment.js.
 */

import { SLOT_BINDINGS } from '../data/abilities.ts';
import { CURRENCIES } from '../data/currencies.ts';
import { normalizeCosts } from '../data/costs.ts';
import { createInventory } from './inventory.js';

export function createCharacter({ cols, rows, currencies = CURRENCIES } = {}) {
  const inventory = createInventory({ cols, rows });

  /**
   * The item on the cursor, or null.
   *
   * It belongs to no container while it is here, which is why it cannot live in
   * the piece of interface that draws it — nor in the level, which is torn down
   * on every doorway. Here it simply comes along.
   */
  let hand = null;

  /**
   * The purse: how much of each currency, keyed by id.
   *
   * A map rather than a field per kind, because what kinds there are is data —
   * see ../data/currencies.js — and nothing here should have to be edited to
   * add one. Seeded from each currency's `start`, which is the only moment the
   * definitions are read: a purse is a number, not a lookup.
   */
  const purse = new Map(currencies.map((def) => [def.id, Math.max(0, Math.round(def.start) || 0)]));

  /**
   * Which ability is on which key.
   *
   * On the character because it is a preference: where you like your dash
   * should survive a doorway, a new pair of gloves and the level being rebuilt
   * underneath you. What you *can* do is worked out from the body instead —
   * see ./loadout.js — and these two are reconciled after anything that changes
   * what is worn.
   */
  const slots = SLOT_BINDINGS.map(() => null);

  /**
   * Which key the main hand's attack sits on.
   *
   * A preference like the bindings themselves, and stored beside them for the
   * same reason: what is *on* that key is decided by what you are holding, but
   * where you like it is yours, and it should survive a doorway and a change of
   * weapon.
   */
  let handSlot = 0;

  /**
   * The one thing being made at a bench, or null.
   *
   * On the character rather than at the bench or in the panel, for the same
   * reason as the purse: both of those go away — you walk out of reach and the
   * panel shuts, you walk through a door and the level is rebuilt — and a craft
   * you have already paid for must not go with them. One at a time, because a
   * queue is a different feature and nobody has asked for one.
   */
  let job = null;

  return {
    inventory,

    get hand() {
      return hand;
    },
    setHand(item) {
      hand = item ?? null;
      return hand;
    },

    /** Which ability sits on each key. A copy: the order is ours to keep. */
    get slots() {
      return slots.slice();
    },

    /** Which key the main hand's attack is on. */
    get handSlot() {
      return handSlot;
    },

    setHandSlot(index) {
      if (!Number.isInteger(index) || index < 0 || index >= slots.length) return false;
      handSlot = index;
      return true;
    },

    /** Put one ability on one key, or null to empty it. */
    setSlot(index, ability) {
      if (!Number.isInteger(index) || index < 0 || index >= slots.length) return false;
      slots[index] = ability || null;
      return true;
    },

    /** How much of one currency; 0 for one this character has never seen. */
    amount: (currency) => purse.get(currency) ?? 0,

    /** The whole purse, copied, for anything that has to show it. */
    purse: () => new Map(purse),

    get job() {
      return job;
    },
    setJob(next) {
      job = next ?? null;
      return job;
    },

    /** Coin in. Negative amounts are not a withdrawal; they are a mistake. */
    earn(currency, amount) {
      if (!currency) return 0;
      const held = (purse.get(currency) ?? 0) + Math.max(0, Math.round(amount) || 0);
      purse.set(currency, held);
      return held;
    },

    /**
     * Whether a whole price could be paid right now.
     *
     * A price spans both pockets: coin is a number in the purse, a material is
     * a count in the bag. One question rather than two, because the answer that
     * matters is "can this be bought", and half of it is no answer at all.
     */
    affords(costs) {
      return normalizeCosts(costs).every(({ kind, id, amount }) =>
        kind === 'item' ? inventory.countOf(id) >= amount : (purse.get(id) ?? 0) >= amount,
      );
    },

    /**
     * Pay a price, all of it or none of it.
     *
     * Every line is checked before any is taken. Paying the gold and then
     * finding the ore short would leave the gold gone and nothing bought — the
     * one outcome a price of several parts makes possible, and the one nobody
     * would ever be able to explain. It spans two containers now, which only
     * makes that easier to do by accident.
     */
    spend(costs) {
      const lines = normalizeCosts(costs);
      if (!this.affords(lines)) return false;
      for (const { kind, id, amount } of lines) {
        if (kind === 'item') inventory.remove(id, amount);
        else purse.set(id, (purse.get(id) ?? 0) - amount);
      }
      return true;
    },
  };
}
