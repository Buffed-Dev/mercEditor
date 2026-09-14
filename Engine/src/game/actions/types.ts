/**
 * What an interaction is made of: an event fires an action, and the action
 * reads the variables written beside it.
 *
 * Events are `onClick`; actions are the functions bound to them; the variables
 * are their arguments. An object on a map carries one action per event, under
 * the event's own name:
 *
 * ```js
 * { gx: 2, gy: 2, interact:  { do: 'openUI',   ui: 'crafting' } }
 * { gx: 9, gy: 2, collision: { do: 'teleport', to: 'cave', spawn: 'mouth' } }
 * ```
 *
 * The split is the one ../executions/index.ts already argues for: data names a
 * verb, code supplies it. Adding an action is a file; wiring one is data typed
 * into the editor, which is the whole point — the list is expected to grow into
 * the hundreds, and nothing outside the action's own file may have to change
 * when it does.
 *
 * ponytail: one action per event. Chaining ("open the gate *and* say a line")
 * is not expressible; add a `then` field holding another action and recurse
 * through `runAction` when something actually needs it.
 */

import type { MapObject } from '../../data/mapFormat.ts';
import type { Actor } from '../actor.ts';
import type { World } from '../world.ts';
import type { createEffectRuntime } from '../effects.ts';

/**
 * One variable an action reads, described so the inspector can draw it.
 *
 * Structurally what `data/lights.ts` LIGHT_FIELDS already writes, and read by
 * the editor the same way — deliberately *not* imported from
 * `editor/fields/types.ts`, because `src/` must not depend on `editor/`. The
 * dependency runs editor -> src, which is the direction that already exists.
 */
export type VarSpec = {
  key: string;
  kind: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly (readonly [string, string])[];
};

/**
 * What must happen somewhere above the level, handed back rather than done.
 *
 * The reason is reentrancy, not tidiness. `goToMap` tears the level down, so a
 * verb that called it directly would destroy the object whose method is on the
 * stack. main.ts already sidesteps this by acting on the portal *after*
 * `level.update` returns; handing an intent back keeps that ordering without
 * anybody having to remember it.
 *
 * This does not grow with the action count. Almost every verb — spawn, give,
 * damage, open a gate — works on level state through the context and returns
 * null. Only what main.ts owns comes back through here.
 */
export type ActionIntent =
  | { go: string; spawn?: string }
  | { ui: string }
  | { say: string };

/**
 * The engine surface a verb may touch.
 *
 * Curated on purpose, rather than handing over the level whole: every action
 * ever written can reach whatever is in here, so what is in here is what can
 * never be changed again. Add to it a field at a time, as a verb needs one.
 */
export type ActionContext = {
  /** The wiring itself, so a verb reads its own variables. `do` names the verb. */
  vars: Record<string, unknown>;
  /** The object the wiring is written on. */
  object: MapObject;
  player: Actor;
  world: World;
  effects: ReturnType<typeof createEffectRuntime>;
  /** Named slices of the level, passed in so a verb never holds the level itself. */
  level: {
    pickUp: (id: string) => { ok: boolean; reason: string };
  };
};

/** One named verb, and the variables it reads. */
export type ActionSpec = {
  label: string;
  /**
   * Which heading the picker files it under. See ACTION_CATEGORIES.
   *
   * Named by the action rather than taken from a folder, because the files are
   * flat — so this is the one place it can be written without drifting from
   * where the action actually lives. One that names nothing lands under Other.
   */
  category?: string;
  /**
   * One line, shown under the picker. Not decoration: a list this is meant to
   * grow to a hundred entries is unreadable without one.
   */
  hint: string;
  vars: readonly VarSpec[];
  /**
   * How close the player must be for the interact plate, when this action is
   * on an `interact` wiring. Left out means the ordinary reach.
   *
   * On the action rather than on the object, because it is a fact about the
   * verb — a bench is a big thing you stand *at* — and not something worth
   * retyping at every placement of one.
   */
  reach?: number;
  run: (context: ActionContext) => ActionIntent | null;
};
