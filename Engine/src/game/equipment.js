/**
 * Putting an item on, and taking it off again.
 *
 * A worn item's stats are already in modifier shape — `{attribute, op, value}`,
 * settled when it rolled — so wearing one is layering modifiers and nothing
 * else. That is the whole reason items were built this way: equipment goes
 * through the same arithmetic as a buff, a debuff and a run upgrade, and none
 * of them know the others exist.
 *
 * The item itself is the modifier source, so taking it off is one call and
 * cannot half-remove: there is no list of what was applied to keep in step, and
 * two identical swords are still two different sources.
 *
 * Base values are never touched, which is what makes this reversible without
 * drift. Take the sword off and its +6 simply drops out of the sum.
 *
 * Swapping is deliberately not a special case. Equipping into an occupied slot
 * strips the old item first and hands it back for the caller to put somewhere —
 * a swap that tried to be clever about where the old one goes is how an item
 * ends up in two places, or in none.
 *
 * The second half of this file is the same idea one step further: an item held
 * on the cursor is out of every container at once, so each move is a *take*
 * that hands the item over, or a *place* that hands back whatever it displaced.
 * Every one of them conserves items — what goes in comes out — which is the
 * property that makes dragging safe, and the one the tests are really about.
 */

/** Layer everything an item gives. */
export function wear(attrs, item) {
  if (!attrs || !item) return 0;
  let applied = 0;
  for (const stat of item.stats ?? []) {
    // The item object is the source rather than its id: identity cannot
    // collide, and there is nothing to keep unique.
    if (attrs.addModifier({ ...stat, source: item })) applied++;
  }
  return applied;
}

/** Take it all back off. */
export function strip(attrs, item) {
  if (!attrs || !item) return 0;
  return attrs.removeBySource(item);
}

/**
 * Wear something from the bag.
 *
 * The displaced item goes back into the cell the new one came from, which is
 * free by definition — looking for somewhere else to put it could fail, and
 * failing halfway through a swap is how an item disappears.
 *
 * @returns {{ok: boolean, reason: string, slot: string|null, item: object|null,
 *   displaced: object|null}}
 */
export function equipFromBag(attrs, inventory, index) {
  const item = inventory.at(index);
  if (!item) return { ok: false, reason: 'empty', slot: null, item: null, displaced: null };

  const slot = inventory.firstSlotFor(item);
  if (!slot) return { ok: false, reason: 'nofit', slot: null, item, displaced: null };

  inventory.takeAt(index);
  const displaced = inventory.equip(slot, item);
  wear(attrs, item);

  if (displaced) {
    strip(attrs, displaced);
    inventory.put(index, displaced);
  }

  return { ok: true, reason: '', slot, item, displaced: displaced ?? null };
}

// ------------------------------------------------------------ to and from
// the cursor. The caller holds the item between a take and a place; these only
// ever move one item, and never leave it in two places at once.

/** Lift something out of a bag cell. Nothing is worn, so nothing is stripped. */
export function takeFromBag(inventory, index) {
  return inventory.takeAt(index);
}

/** Lift something off the body, which does take its modifiers with it. */
export function takeFromSlot(attrs, inventory, slotId) {
  const item = inventory.unequip(slotId);
  if (item) strip(attrs, item);
  return item;
}

/**
 * Put a held item into a bag cell.
 *
 * Whatever was there comes back to the cursor rather than being shuffled
 * elsewhere: the hand is the one place guaranteed to be free, since it was just
 * emptied. That is also what makes swapping two cells feel right — you are left
 * holding the thing you displaced.
 *
 * @returns the displaced item, now the caller's to hold
 */
export function placeInBag(inventory, index, item) {
  if (!item) return null;
  return inventory.put(index, item) ?? null;
}

/**
 * Put a held item into an equipment slot.
 *
 * Refused outright when the slot will not take it — a helm does not go on a
 * finger, and silently dropping it in the bag instead would be a surprise.
 *
 * @returns {{ok: boolean, reason: string, displaced: object|null}}
 */
export function placeInSlot(attrs, inventory, slotId, item) {
  if (!item) return { ok: false, reason: 'empty', displaced: null };
  if (!inventory.accepts(slotId, item)) return { ok: false, reason: 'nofit', displaced: null };

  const displaced = inventory.equip(slotId, item);
  wear(attrs, item);
  if (displaced) strip(attrs, displaced);
  return { ok: true, reason: '', displaced: displaced ?? null };
}

/**
 * Take something off, into the bag.
 *
 * Checked before it is stripped: a full bag has to leave the item on, not take
 * its modifiers away and then have nowhere to put it.
 *
 * @returns {{ok: boolean, reason: string, item: object|null}}
 */
export function unequipToBag(attrs, inventory, slotId) {
  const item = inventory.wearing(slotId);
  if (!item) return { ok: false, reason: 'empty', item: null };
  if (inventory.firstFree() < 0) return { ok: false, reason: 'full', item: null };

  inventory.unequip(slotId);
  strip(attrs, item);
  // Worn things never stack, and a free cell was checked for above, so nothing
  // can come back here.
  inventory.add(item);
  return { ok: true, reason: '', item };
}
