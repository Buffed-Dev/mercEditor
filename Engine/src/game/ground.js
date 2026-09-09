/**
 * Items lying on the floor.
 *
 * A drop is one rolled item and a tile to sit on. It holds no mesh and no
 * label: this is the list, and render/groundItems.js draws whatever is in it,
 * the same division monsters already use.
 *
 * One drop per tile, deliberately. Two items on the same square would sit
 * inside each other with their names overlapping, and picking one would be a
 * guess — so dropping looks for the nearest free tile instead of stacking. That
 * also means the list can be searched by tile, which is what "is there anything
 * here" costs when a monster dies on top of a drop.
 *
 * Ids rather than array indices, because a drop's position in the list changes
 * the moment anything before it is picked up, and the label on screen holds
 * onto whatever it was told during the frame it was built.
 *
 * A drop records `at`, the time it was dropped on whatever clock the caller
 * keeps. This list still has no clock of its own and compares that to nothing —
 * it is stored, like the tile, and read by the view to arc the thing across and
 * by the sweep to leave it alone until it has landed. One number, so what you
 * can see and what you can pick up cannot disagree about whether it is still in
 * the air.
 */

/**
 * How long a dropped thing is in the air.
 *
 * Here rather than in the view because it is now two things at once: the length
 * of the toss, and how long coin sits before it can be swept up. Those have to
 * be the same number — coin that vanished mid-flight would be a payout you
 * never saw.
 */
export const SETTLE_SECONDS = 0.45;

/** Tiles in rings around a centre, nearest first. */
function* spiral(tx, ty, radius) {
  yield [tx, ty];
  for (let r = 1; r <= radius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        // Only the ring itself: the inside was covered by a smaller r.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        yield [tx + dx, ty + dy];
      }
    }
  }
}

/**
 * The nearest tile to (tx, ty) that `isFree` accepts, or null.
 *
 * Separate from the list so the caller decides what "free" means — the world
 * knows about walls and bounds, and this knows about what is already lying
 * around, and neither needs to import the other.
 */
export function nearestFree(tx, ty, isFree, radius = 6) {
  for (const [x, y] of spiral(tx, ty, radius)) {
    if (isFree(x, y)) return { tx: x, ty: y };
  }
  return null;
}

export function createGround() {
  /** @type {{id: string, item: object, tx: number, ty: number, gx: number, gy: number}[]} */
  const drops = [];
  let serial = 0;

  const indexOf = (id) => drops.findIndex((drop) => drop.id === id);

  return {
    get count() {
      return drops.length;
    },

    /** A copy, so a caller iterating it can pick things up as it goes. */
    list: () => drops.slice(),

    at: (id) => drops.find((drop) => drop.id === id) ?? null,

    /** What is lying on a tile, or null. */
    atTile(tx, ty) {
      return drops.find((drop) => drop.tx === tx && drop.ty === ty) ?? null;
    },

    occupied(tx, ty) {
      return drops.some((drop) => drop.tx === tx && drop.ty === ty);
    },

    /**
     * Put an item on a tile. The world position is the middle of it, so an item
     * dropped while standing anywhere on a square lands in the same place — a
     * name plate that sat wherever the player's feet happened to be would look
     * like a mistake.
     *
     * `from` is where it was thrown from, if anywhere: the hand that dropped it,
     * or later the monster it fell out of. Only the view uses it, to arc the
     * item across rather than have it appear already lying there. It is a plain
     * position rather than a reference to whoever threw it, because that thing
     * has usually moved — or died — by the time the toss lands.
     */
    drop(item, tx, ty, from = null, at = 0) {
      if (!item) return null;
      const entry = {
        id: `drop${++serial}`,
        item,
        tx,
        ty,
        gx: tx + 0.5,
        gy: ty + 0.5,
        from: from ? { gx: from.gx, gy: from.gy } : null,
        at,
      };
      drops.push(entry);
      return entry;
    },

    /**
     * Swap what a drop is holding, keeping its id and its tile.
     *
     * For a stack only partly picked up: taking it and putting the remainder
     * back would give it a new id and start its toss over, so the pile would
     * appear to leap out of the ground again every time you filled up.
     */
    keep(id, item) {
      const entry = drops.find((drop) => drop.id === id);
      if (!entry) return null;
      entry.item = item;
      return entry;
    },

    /** Lift one off the floor. Returns the item, or null if it is already gone. */
    take(id) {
      const index = indexOf(id);
      if (index < 0) return null;
      const [entry] = drops.splice(index, 1);
      return entry.item;
    },

    clear() {
      drops.length = 0;
    },
  };
}
