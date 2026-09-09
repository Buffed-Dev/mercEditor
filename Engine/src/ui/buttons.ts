/**
 * Which mouse buttons are down.
 *
 * This looks like it should be a Set that `pointerdown` adds to and `pointerup`
 * removes from. It cannot be, and the reason is worth writing down because the
 * broken version is the obvious one.
 *
 * For a mouse, the Pointer Events spec fires `pointerdown` only when the device
 * goes from *no* buttons pressed to *some*, and `pointerup` only when it goes
 * back to *none*. Pressing a second button while the first is held fires no
 * down event at all — it arrives as a move — and releasing the first of two
 * fires no up event either. The single `pointerup` you do get names whichever
 * button happened to complete the release.
 *
 * So holding the left button, clicking the right, and letting go of the left
 * first leaves one `pointerup` with `button: 2`. A set would remove the right
 * button, having never added it, and keep the left one forever: the character
 * carries on attacking with nothing held.
 *
 * `event.buttons` is a bitmask of everything currently down, present on every
 * pointer event, and always right. Mirroring it needs no state machine and has
 * no sequence to get wrong.
 *
 * On top of that there is one exception the game needs: a press that lands on
 * the interface — a name plate over a dropped item, a bag cell — must not also
 * swing the sword. Abilities re-attempt every frame while a button is held, so
 * it is not enough for the click handler to stop propagation; the button has to
 * stay ignored until it is let go. That is what `suppress` records, and the
 * mask is what clears it: a bit that is no longer down is no longer suppressed,
 * with no release handler to miss.
 */

/**
 * `MouseEvent.button` (which one caused this event) indexed to its bit in
 * `MouseEvent.buttons` (which ones are down). They are not the same numbering:
 * the middle button is 1 as a cause and 4 as a bit.
 */
export const BUTTON_BIT = [1, 4, 2];

export function createButtons() {
  let mask = 0;
  /** Bits held down that the game should behave as though it never saw. */
  let ignored = 0;

  return {
    /** The raw bitmask, for anything that wants to test several at once. */
    get mask() {
      return mask;
    },

    /**
     * Take the state from any pointer event. Every one carries it, so this can
     * be wired to down, move, up and cancel alike without any of them meaning
     * something different.
     */
    track(event: { buttons?: number } | null | undefined): void {
      mask = event?.buttons ?? 0;
      // Letting go ends the suppression, whichever event reports it.
      ignored &= mask;
    },

    /** Nothing is held — for losing focus, where no further events arrive. */
    clear(): void {
      mask = 0;
      ignored = 0;
    },

    /**
     * Ignore this button until it is released. For a press that the interface
     * has already answered — clicking an item off the floor is not also an
     * order to attack the floor.
     */
    suppress(button: number): void {
      const bit = BUTTON_BIT[button];
      if (bit !== undefined) ignored |= bit;
    },

    /** Is this `MouseEvent.button` currently down, and meant for the game? */
    isDown(button: number): boolean {
      const bit = BUTTON_BIT[button];
      return bit !== undefined && (mask & bit) !== 0 && (ignored & bit) === 0;
    },

    /** Down, but spoken for by the interface. */
    isSuppressed(button: number): boolean {
      const bit = BUTTON_BIT[button];
      return bit !== undefined && (ignored & bit) !== 0;
    },
  };
}

/** Which mouse buttons are down, and which of those are being ignored. */
export type Buttons = ReturnType<typeof createButtons>;
