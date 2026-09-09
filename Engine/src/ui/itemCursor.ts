/**
 * What pressing a button over an inventory cell means.
 *
 * Dragging and clicking are the same gesture until the pointer moves, so this
 * does not try to tell them apart up front. A press on a filled cell lifts the
 * item onto the cursor either way; what the *release* does is decide which one
 * it was:
 *
 *   released on the cell it came from  → a click. Carry on holding, and the
 *                                        next press decides where it goes.
 *   released anywhere else             → a drag. Put it down there.
 *
 * That is one rule covering both, rather than a distance threshold and a timer
 * that disagree about the same press.
 *
 * Where a press lands matters as much as which button it was. A press on the
 * world puts the item on the floor; a press on some *other* piece of interface
 * — the sheet's background, the ability bar — puts it back where it was picked
 * up. Throwing loot on the ground because a click missed a cell by two pixels
 * is not an interpretation anyone wants.
 *
 * The right button is the shortcut for the common case — wear this, take that
 * off — and does nothing while the cursor is full, since there is no way for it
 * to ask where the carried item should go.
 *
 * Everything it acts on comes through `hands`, which is the level's own item
 * operations. Nothing here touches an inventory or an attribute directly, so
 * the whole state machine can be tested against a bag with no game around it.
 */

/** Mouse buttons, by what they mean here rather than by number. */
import type { ItemInstance } from '../game/items.ts';

/**
 * A place an item can be: a bag cell by index, or a worn slot by name.
 *
 * A union rather than one shape with a loose id, so that asking `kind` is also
 * what settles which sort of id it carries.
 */
export type Cell = { kind: 'bag'; id: number } | { kind: 'slot'; id: string };

/** What moving an item reports back. */
type Move = { ok: boolean; reason: string; item?: { label?: string } | null };

/**
 * The part of the level's inventory this cursor drives.
 *
 * Structural rather than imported from render/level, which owns it: what the
 * cursor needs is the seven moves below and something to ask what is in hand.
 */
export type Hands = {
  readonly hand: ItemInstance | null;
  takeFromBag: (index: number) => ItemInstance | null;
  takeFromSlot: (slotId: string) => ItemInstance | null;
  placeInBag: (index: number) => Move;
  placeInSlot: (slotId: string) => Move;
  dropHand: () => unknown;
  returnHand: (origin: Cell | null) => Move;
  equipFromBag: (index: number) => Move;
  unequipToBag: (slotId: string) => Move;
};

const CARRY = 0;
const SHORTCUT = 2;

const sameCell = (a: Cell | null, b: Cell | null) =>
  Boolean(a) && Boolean(b) && a?.kind === b?.kind && a?.id === b?.id;

/**
 * @param {object} hands the level's item operations
 * @param {object} [options]
 * @param {(text: string) => void} [options.say] where a refusal is reported
 * @param {() => void} [options.onChange] called whenever what is carried changes
 */
export function createItemCursor(
  hands: () => Hands | null,
  { say, onChange }: { say?: (message: string) => void; onChange?: () => void } = {},
) {
  /**
   * Where the press that lifted the carried item started, while that press is
   * still down. Null the rest of the time — including while carrying something
   * picked up by an earlier, finished click.
   */
  let grabbedAt: Cell | null = null;

  /**
   * Where the carried item was picked up from, for as long as it is carried.
   *
   * Not the same as `grabbedAt`, which only lives as long as one press: this
   * survives a click, because putting the item back needs to know where it came
   * from however long ago that was.
   */
  let carriedFrom: Cell | null = null;

  const carrying = () => Boolean(hands()?.hand);

  function changed(): void {
    onChange?.();
  }

  function putDown(where: Cell, level: Hands): Move {
    const result =
      where.kind === 'bag' ? level.placeInBag(where.id) : level.placeInSlot(where.id);
    // The only refusal is a slot that will not take it. Quietly dropping it in
    // the bag instead would be a surprise, so it stays on the cursor.
    if (!result.ok && result.reason === 'nofit') say?.('That does not go there.');
    // A swap leaves the displaced item on the cursor, and it came from here —
    // so this is where putting it back should return it to.
    else carriedFrom = carrying() ? where : null;
    changed();
    return result;
  }

  /**
   * Put the carried item back where it was picked up from.
   *
   * The fallbacks are the level's: the original place if it is still free, any
   * free cell if not, and the floor only when there is genuinely nowhere. The
   * item is never lost, and never silently thrown away for want of a slot.
   */
  function returnToOrigin(): boolean {
    const level = hands();
    if (!level?.hand) return false;
    const result = level.returnHand(carriedFrom);
    if (result?.reason === 'full') say?.('No room — it went on the floor.');
    carriedFrom = null;
    grabbedAt = null;
    changed();
    return true;
  }

  function shortcut(where: Cell, level: Hands): Move {
    const result =
      where.kind === 'bag' ? level.equipFromBag(where.id) : level.unequipToBag(where.id);
    if (result.ok) return result;
    if (result.reason === 'nofit') {
      say?.(`Nowhere to put the ${String(result.item?.label ?? 'item').toLowerCase()}.`);
    }
    if (result.reason === 'full') say?.('Your bag is full.');
    return result;
  }

  return {
    get carrying() {
      return carrying();
    },

    /** The pointer went down on a cell. */
    cellDown(where: Cell, button = CARRY): void {
      const level = hands();
      if (!level) return;

      if (button === SHORTCUT) {
        if (carrying()) return;
        shortcut(where, level);
        changed();
        return;
      }

      if (button !== CARRY) return;

      if (carrying()) {
        putDown(where, level);
        grabbedAt = null;
        return;
      }

      const taken =
        where.kind === 'bag' ? level.takeFromBag(where.id) : level.takeFromSlot(where.id);
      grabbedAt = taken ? where : null;
      carriedFrom = taken ? where : null;
      changed();
    },

    /**
     * The pointer came up over a cell.
     *
     * Only ever the end of a drag, which is why it does nothing unless this
     * press is the one that lifted the item. A press that *put something down*
     * is followed by a release over that same cell, and treating that as a drag
     * would put the item down a second time — picking back up whatever the
     * first placement displaced, and leaving the click looking like it did
     * nothing at all.
     */
    cellUp(where: Cell): void {
      if (!grabbedAt) return;

      // Released where it was lifted from: a click, not a drag. Keep carrying,
      // and let the next press decide where it goes.
      const from = grabbedAt;
      grabbedAt = null;
      const level = hands();
      if (!level || sameCell(from, where) || !carrying()) return;

      putDown(where, level);
    },

    /**
     * The pointer went down on the world rather than on the interface.
     *
     * @returns true when the press was spent putting the item down, so the
     *   caller knows to keep it from also being an attack.
     */
    worldDown(button = CARRY): boolean {
      if (button !== CARRY || !carrying()) return false;
      hands()?.dropHand();
      grabbedAt = null;
      carriedFrom = null;
      changed();
      return true;
    },

    /**
     * The pointer went down on interface that is not a cell.
     *
     * The item goes back where it came from. A press that misses a cell but
     * lands on the sheet is a miss, not an instruction to throw the thing on
     * the floor — the floor is what the *world* is for.
     *
     * @returns true when there was something to put back.
     */
    uiDown(button = CARRY): boolean {
      if (button !== CARRY || !carrying()) return false;
      return returnToOrigin();
    },

    /** The same, for a drag that ends over interface rather than over a cell. */
    uiUp(): boolean {
      if (!grabbedAt || !carrying()) {
        grabbedAt = null;
        return false;
      }
      return returnToOrigin();
    },

    /**
     * The pointer came up somewhere that is not a cell. Only meaningful for the
     * press that lifted the item: a release with nothing pending is the end of
     * some other click, and must not throw the carried item on the floor.
     */
    worldUp(): boolean {
      if (!grabbedAt || !carrying()) {
        grabbedAt = null;
        return false;
      }
      grabbedAt = null;
      carriedFrom = null;
      hands()?.dropHand();
      changed();
      return true;
    },

    /** Forget any press in progress — the pointer was lost, or play stopped. */
    cancel(): void {
      grabbedAt = null;
      carriedFrom = null;
    },
  };
}

/** What is being carried between bag cells, worn slots and the floor. */
export type ItemCursor = ReturnType<typeof createItemCursor>;
