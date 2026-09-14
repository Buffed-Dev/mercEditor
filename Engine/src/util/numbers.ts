/**
 * Reading a number off something a person typed.
 *
 * The rules files under `Games/` are hand-edited JavaScript outside the type
 * checker, so a field declared `cooldown?: number` can arrive as a string, as
 * `null`, or as nothing at all. `Number.isFinite` is the only check that
 * catches all three *and* NaN, and NaN is the one that hurts: it is a number
 * by type, it survives every arithmetic operation, and it turns every
 * comparison it reaches into `false`. An ability whose cooldown is NaN is an
 * ability with no cooldown at all — `remaining > 0` is false forever — and
 * nothing anywhere says so.
 */

/** A finite number, or `fallback` when what arrived is not one. */
export const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A finite number no smaller than `low`. */
export const atLeast = (low: number, value: unknown, fallback = low): number =>
  Math.max(low, finite(value, fallback));

/** A finite number inside `[low, high]`. */
export const within = (low: number, high: number, value: unknown, fallback = low): number =>
  Math.min(high, Math.max(low, finite(value, fallback)));
