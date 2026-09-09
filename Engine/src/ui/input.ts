import { createButtons } from './buttons.ts';

/**
 * Where a press landed.
 *
 * `world` is the map itself, `control` a deliberate on-screen control, and
 * `interface` anything else the HUD is covering the map with. Only a press on
 * the world drives the game.
 */
export type PressWhere = 'world' | 'control' | 'interface';

/** Where the pointer is, and whether it has ever been anywhere. */
export type Pointer = { x: number; y: number; seen: boolean };

/** A press, once it is known what it landed on. */
export type Press = { button: number; where: PressWhere; x: number; y: number };

/** A release, which only needs to know what it let go of. */
export type Release = { button: number; where: PressWhere };

/** What the game wants to hear about. */
export type InputHandlers = {
  /** The selector matching the map's own canvas. */
  world: string;
  onKeyDown?: (event: KeyboardEvent) => void;
  onPress?: (press: Press) => void;
  onRelease?: (release: Release) => void;
  onMove?: (pointer: Pointer) => void;
};

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
function pressedOn(target: EventTarget | null, worldSelector: string): PressWhere {
  // A press can land on the window itself, which is not an element and has
  // nothing to ask about ancestors -- the optional call this replaces read as
  // 'interface' in that case, and so does this.
  const element = target instanceof Element ? target : null;
  if (element?.closest('.ui-click')) return 'control';
  return element?.closest(worldSelector) ? 'world' : 'interface';
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
export function createInput({
  world,
  onKeyDown,
  onPress,
  onRelease,
  onMove,
}: InputHandlers) {
  /** Which key codes are held. Read every frame by whatever cares. */
  const keys = new Set<string>();

  // Which mouse buttons are held. Abilities re-attempt every frame while held
  // rather than firing once on press, so holding a button attacks continuously
  // at whatever rate the cooldown allows.
  const buttons = createButtons();

  /** Where the pointer last was, in client pixels. */
  const pointer: Pointer = { x: 0, y: 0, seen: false };

  const listeners: (() => void)[] = [];

  /**
   * Add a listener and remember how to take it off again.
   *
   * Generic over the event name so each handler below is handed the event it
   * actually gets -- a KeyboardEvent for a key, a PointerEvent for a press --
   * rather than the base Event and a cast at every use.
   */
  const listen = <K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void => {
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
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'pointermove'] as const) {
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
    held: (code: string): boolean => keys.has(code),

    dispose(): void {
      for (const off of listeners) off();
      listeners.length = 0;
      keys.clear();
    },
  };
}

/** Everything the game reads about the keyboard, the mouse and the pointer. */
export type Input = ReturnType<typeof createInput>;
