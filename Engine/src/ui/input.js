import { createButtons } from './buttons.js';

/**
 * Every DOM listener the game has, in one place.
 *
 * Before this, the keyboard, the mouse buttons, the pointer position and the
 * "was that press meant for the interface" question were seven listeners spread
 * through the bootstrap, and nothing could be torn down. Gameplay systems ask
 * this what is held; they do not each grow their own listener.
 *
 * Babylon's own input handling is deliberately not used here. It reports what
 * happened over the canvas, and half of what this has to answer is about
 * presses that landed on the *interface* — the character sheet, an item name
 * plate, the editor's panels — which Babylon has no view of.
 */

/**
 * Where a press landed: on a control, on the world, or on some other part of
 * the interface.
 *
 * The third case is the one worth naming. A press that misses an inventory cell
 * but hits the sheet around it is a miss — not an instruction to throw the
 * carried item on the floor. Only the world means the floor.
 */
function pressedOn(target, worldSelector) {
  if (target?.closest?.('.ui-click')) return 'control';
  return target?.closest?.(worldSelector) ? 'world' : 'interface';
}

/**
 * @param {object} options
 * @param {string} options.world a CSS selector for the element the 3D view
 *   fills. A press inside it is a press on the world.
 * @param {(event: KeyboardEvent) => void} [options.onKeyDown] discrete presses:
 *   menus, toggles. Held keys are read from `keys` instead.
 * @param {(press: {button: number, where: string, x: number, y: number}) => void}
 *   [options.onPress]
 * @param {(press: {button: number, where: string}) => void} [options.onRelease]
 * @param {(at: {x: number, y: number}) => void} [options.onMove]
 */
export function createInput({ world, onKeyDown, onPress, onRelease, onMove } = {}) {
  /** Which key codes are held. Read every frame by whatever cares. */
  const keys = new Set();

  // Which mouse buttons are held. Abilities re-attempt every frame while held
  // rather than firing once on press, so holding a button attacks continuously
  // at whatever rate the cooldown allows.
  const buttons = createButtons();

  /** Where the pointer last was, in client pixels. */
  const pointer = { x: 0, y: 0, seen: false };

  const listeners = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  listen(window, 'keydown', (event) => {
    // Typing in an editor panel must not also drive the game.
    const tag = event.target instanceof HTMLElement ? event.target.tagName : '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    keys.add(event.code);
    onKeyDown?.(event);
  });
  listen(window, 'keyup', (event) => keys.delete(event.code));

  // Losing focus mid-hold delivers no further events at all, so the last state
  // seen would stand forever. Alt-tabbing away must not leave you attacking.
  listen(window, 'blur', () => {
    keys.clear();
    buttons.clear();
  });

  // Every pointer event carries the same button bitmask, and the second button
  // of a two-button gesture only ever arrives on one of them.
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'pointermove']) {
    listen(window, type, (event) => buttons.track(event));
  }

  listen(window, 'pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.seen = true;
    onMove?.(pointer);
  });

  // Capture phase, so this runs before anything can consume the event — and on
  // window rather than on each control, so a new piece of interface only has to
  // wear the `ui-click` class to be counted.
  listen(
    window,
    'pointerdown',
    (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.seen = true;

      const where = pressedOn(event.target, world);
      // Anything that is not the world is the interface answering the press, so
      // it must not also drive an ability. Stopping the event would not be
      // enough: abilities re-attempt every frame while a button is held, so a
      // click on a name plate would keep swinging until it was released.
      if (where !== 'world') buttons.suppress(event.button);

      onPress?.({ button: event.button, where, x: event.clientX, y: event.clientY });
    },
    true,
  );

  listen(window, 'pointerup', (event) => {
    onRelease?.({ button: event.button, where: pressedOn(event.target, world) });
  });

  return {
    keys,
    buttons,
    pointer,

    /** Is a key held? */
    held: (code) => keys.has(code),

    dispose() {
      for (const off of listeners) off();
      listeners.length = 0;
      keys.clear();
    },
  };
}
