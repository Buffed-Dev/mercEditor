import { countOf } from '../game/items.js';

/**
 * The item riding on the cursor.
 *
 * One element that follows the pointer and says what is being carried. It never
 * takes the pointer itself — an element under the cursor that swallowed clicks
 * would make it impossible to put the thing down.
 *
 * It draws nothing about *where* the item came from or where it may go: the
 * hand holds one item and it is out of every container while it is here, which
 * is the whole state there is.
 */

export function createHeldItemView(root) {
  const plate = document.createElement('div');
  plate.className = 'held-item';
  plate.hidden = true;
  root.append(plate);

  let showing = null;

  return {
    get item() {
      return showing;
    },

    /** Carry this item, or nothing. */
    show(item) {
      showing = item ?? null;
      plate.hidden = !showing;
      const depth = countOf(showing);
      const text = showing ? `${showing.label}${depth > 1 ? ` ×${depth}` : ''}` : '';
      if (plate.textContent !== text) plate.textContent = text;
    },

    /**
     * Follow the pointer. Offset down and right of the cursor, the way a
     * dragged thing sits under the hand rather than beneath it — centred on the
     * pointer, the plate would hide the cell being aimed at.
     */
    moveTo(x, y) {
      plate.style.transform = `translate(${Math.round(x) + 12}px, ${Math.round(y) + 10}px)`;
    },
  };
}
