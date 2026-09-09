/**
 * What an actor is carrying: a set of named equipment slots and a flat bag.
 *
 * Two containers rather than one, because they answer different questions. An
 * equipment slot is addressed by name and holds at most one thing, and what
 * may go in it is decided by the item ("this is a helm"), not by the slot
 * hunting for something that fits. The bag is addressed by index, because its
 * order is the player's business and must survive taking something out of the
 * middle — which is why removing leaves a hole rather than compacting.
 *
 * Storage only. Nothing here touches attributes: a worn item's stats are
 * already in modifier shape (see ../game/items.js), so equipping applies them
 * through the same arithmetic as every other modifier in the game — but that
 * is the equipping code's job, not the bag's.
 *
 * **Cells and units are different things.** A cell holds one item, but a
 * material is a *stack* — twenty ore in one cell — so "is there room" cannot be
 * answered by counting holes any more. Every method below that used to move an
 * item now moves some number of units and hands back whatever did not fit,
 * because a bag that quietly swallowed the remainder would lose it.
 *
 * What stacks with what is read off the items themselves (`stack` and `count`,
 * see ./items.js) rather than looked up, so this file still holds items and not
 * definitions.
 */

import {
  countOf,
  stackOf,
  stacks,
  withCount,
  type Countable,
  type ItemInstance,
} from './items.ts';
import type { ItemSlot } from '../data/items.ts';

/**
 * One place on the body something can be worn.
 *
 * `id` is the place and `kind` is what fits there, which are not the same:
 * there are two ring slots and one kind of ring.
 */
export type EquipmentSlot = { id: string; kind: ItemSlot; label: string; column: number };

/**
 * The doll, in the order it is drawn. Three columns wide, so `column` is what
 * the panel arranges on rather than the panel re-deriving a layout from ids.
 *
 * `kind` is what an item names, and it is not always the slot id: there are two
 * ring slots and a ring is just a ring. Matching on the kind is what lets one
 * go on either hand — matching on the id would mean authoring "left ring" and
 * "right ring" as different items.
 */
export const EQUIPMENT_SLOTS = [
  { id: 'head', kind: 'head', label: 'Head', column: 1 },
  { id: 'amulet', kind: 'amulet', label: 'Amulet', column: 2 },
  { id: 'mainHand', kind: 'mainHand', label: 'Main hand', column: 0 },
  { id: 'chest', kind: 'chest', label: 'Chest', column: 1 },
  { id: 'offHand', kind: 'offHand', label: 'Off hand', column: 2 },
  { id: 'hands', kind: 'hands', label: 'Hands', column: 0 },
  { id: 'legs', kind: 'legs', label: 'Legs', column: 1 },
  { id: 'ring1', kind: 'ring', label: 'Ring', column: 2 },
  { id: 'feet', kind: 'feet', label: 'Feet', column: 1 },
  { id: 'ring2', kind: 'ring', label: 'Ring', column: 2 },
];

/** slot id -> what an item must claim to go in it. */
const SLOT_KIND = new Map(EQUIPMENT_SLOTS.map((slot) => [slot.id, slot.kind]));

/** Whether this item may be worn in this slot. */
export function slotAccepts(
  slotId: string,
  // Only the slot is read, so anything carrying one can be asked about.
  item: { slot?: string } | null | undefined,
): boolean {
  if (!item || !SLOT_KIND.has(slotId)) return false;
  return !item.slot || item.slot === SLOT_KIND.get(slotId);
}

export const BAG_COLS = 8;
export const BAG_ROWS = 5;

export function createInventory({ cols = BAG_COLS, rows = BAG_ROWS } = {}) {
  const size = cols * rows;
  const bag: (ItemInstance | null)[] = new Array(size).fill(null);
  const worn = new Map<string, ItemInstance | null>(
    EQUIPMENT_SLOTS.map((slot) => [slot.id, null]),
  );

  const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < size;

  return {
    cols,
    rows,
    get size() {
      return size;
    },

    /** How many bag cells are occupied. */
    get count() {
      return bag.reduce((n, item) => n + (item ? 1 : 0), 0);
    },

    /** How many things are in the bag, counting a stack as its whole depth. */
    get units() {
      return bag.reduce((n, item) => n + countOf(item), 0);
    },

    /** How many of one definition are in the bag, across every cell. */
    countOf(defId: string): number {
      return bag.reduce((n, item) => n + (item?.defId === defId ? countOf(item) : 0), 0);
    },

    /**
     * How many more of this could be put in: the room in stacks that already
     * hold it, plus a full stack for every empty cell.
     */
    room(item: Countable | null | undefined): number {
      if (!item) return 0;
      const stack = stackOf(item);
      let space = 0;
      for (const held of bag) {
        if (!held) space += stack;
        else if (stacks(held, item)) space += Math.max(0, stack - countOf(held));
      }
      return space;
    },

    /**
     * Take units of a definition out, wherever they are.
     *
     * Emptied from the smallest stack first, so paying two ore out of a bag
     * holding 1 and 19 leaves one tidy stack rather than two ragged ones.
     * Returns how many it could not find — a caller that checked first should
     * always get 0.
     */
    remove(defId: string, wanted: number): number {
      let left = Math.max(0, Math.round(wanted) || 0);
      const order = bag
        .map((item, index) => ({ item, index }))
        // A guard rather than a plain predicate: the entries that survive are
        // exactly the ones holding something, and the loop below needs to know
        // that to hand them to `withCount`.
        .filter((entry): entry is { item: ItemInstance; index: number } =>
          entry.item?.defId === defId,
        )
        .sort((a, b) => countOf(a.item) - countOf(b.item));

      for (const { item, index } of order) {
        if (left <= 0) break;
        const held = countOf(item);
        const taken = Math.min(held, left);
        left -= taken;
        bag[index] = withCount(item, held - taken);
      }
      return left;
    },

    at: (index: number): ItemInstance | null => (inRange(index) ? bag[index] : null),
    wearing: (slotId: string): ItemInstance | null => worn.get(slotId) ?? null,

    /** The first free bag cell, or -1 when there is none. */
    firstFree(): number {
      return bag.indexOf(null);
    },

    /**
     * Put something in, topping up matching stacks before opening a new cell.
     *
     * Existing stacks first, because a bag that opened a fresh cell while a
     * half-full one sat two squares away would fill up for no reason a player
     * could see.
     *
     * Returns whatever would not fit — a smaller stack, or null when all of it
     * went in. The caller decides what a full bag means, since putting the
     * remainder on the floor is a level's job and not a bag's.
     */
    add(item: ItemInstance | null | undefined): ItemInstance | null {
      if (!item) return null;
      let left = countOf(item);
      const stack = stackOf(item);

      if (stack > 1) {
        for (let i = 0; i < size && left > 0; i++) {
          // `stacks` already refuses an empty cell; the extra check is what
          // tells the compiler the same thing.
          const inCell = bag[i];
          if (!inCell || !stacks(inCell, item)) continue;
          const held = countOf(inCell);
          const moved = Math.min(stack - held, left);
          if (moved <= 0) continue;
          bag[i] = withCount(inCell, held + moved);
          left -= moved;
        }
      }

      for (let i = 0; i < size && left > 0; i++) {
        if (bag[i]) continue;
        const moved = Math.min(stack, left);
        bag[i] = withCount(item, moved);
        left -= moved;
      }

      return withCount(item, left);
    },

    /**
     * Put something in a specific cell, returning whatever comes back to the
     * hand: the item that was displaced, or the part of a stack that would not
     * fit on top of one already there.
     */
    put(
      index: number,
      item: ItemInstance | null | undefined,
    ): ItemInstance | null {
      if (!inRange(index)) return item ?? null;
      const held = bag[index];

      // Onto a stack of the same thing: top it up and keep the overflow, which
      // is what makes dropping 15 ore onto 12 leave 7 on the cursor rather than
      // swapping the two piles round.
      if (item && held && stacks(held, item)) {
        const stack = stackOf(item);
        const moved = Math.min(stack - countOf(held), countOf(item));
        bag[index] = withCount(held, countOf(held) + moved);
        return withCount(item, countOf(item) - moved);
      }

      // A stack bigger than a cell splits here too: whatever is over the limit
      // comes back rather than sitting in a cell that claims to hold more than
      // a cell can.
      if (item && countOf(item) > stackOf(item)) {
        const stack = stackOf(item);
        bag[index] = withCount(item, stack);
        // Only when the cell was empty; otherwise the displaced item would have
        // nowhere to go and the overflow would take its place.
        if (!held) return withCount(item, countOf(item) - stack);
      }

      bag[index] = item ?? null;
      return held;
    },

    takeAt(index: number): ItemInstance | null {
      if (!inRange(index)) return null;
      const item = bag[index];
      bag[index] = null;
      return item;
    },

    /** Whether this item may be worn here, without wearing it. */
    accepts: (slotId: string, item: ItemInstance | null | undefined): boolean =>
      worn.has(slotId) && slotAccepts(slotId, item),

    /**
     * Where this item should go, or null if nothing takes it.
     *
     * An empty slot wins over an occupied one, which is the difference between
     * putting on a second ring and replacing the first. Beyond that it is the
     * doll's own order, so the choice is something the slot list decides rather
     * than a rule hidden in here.
     */
    firstSlotFor(item: ItemInstance | null | undefined): string | null {
      if (!item) return null;
      const fits = EQUIPMENT_SLOTS.filter((slot) => slotAccepts(slot.id, item));
      const free = fits.find((slot) => !worn.get(slot.id));
      return (free ?? fits[0])?.id ?? null;
    },

    /**
     * Wear something. The item names the kind of slot it belongs in, so a helm
     * cannot be forced onto a finger. Returns whatever came off, which the
     * caller is responsible for — it goes back in the bag or it is gone.
     */
    equip(slotId: string, item: ItemInstance | null | undefined): ItemInstance | null {
      if (!worn.has(slotId) || !item) return null;
      if (!slotAccepts(slotId, item)) return null;
      const previous = worn.get(slotId);
      worn.set(slotId, item);
      return previous ?? null;
    },

    unequip(slotId: string): ItemInstance | null {
      const item = worn.get(slotId) ?? null;
      if (item) worn.set(slotId, null);
      return item;
    },

    /** Flat read-out for the character panel, which must not hold the arrays. */
    snapshot() {
      return {
        cols,
        rows,
        bag: bag.slice(),
        equipment: EQUIPMENT_SLOTS.map((slot) => ({
          ...slot,
          item: worn.get(slot.id) ?? null,
        })),
      };
    },
  };
}

/** A bag and a set of worn slots, and everything that can be done to them. */
export type Inventory = ReturnType<typeof createInventory>;
