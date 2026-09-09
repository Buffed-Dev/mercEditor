import type { Curve, FieldSpec } from './types';

/**
 * What a number field's ends actually mean, and how a drag travels between
 * them.
 *
 * Two separate questions, which the old control conflated:
 *
 * - **Does it clamp?** A stat line is bounded at ±9999 to stop a typo. Those
 *   are ends, but they are not a scale — drawing a bar a thousandth full
 *   because the value is 4 would be reading a quantity off a number that has
 *   no quantity to read.
 * - **Is it a scale?** Only a `range` is. That is what earns the fill behind
 *   the value, and what makes one sweep cross the whole field.
 *
 * And then the problem that made this file worth having: a scale whose useful
 * values sit near the bottom of it. A light's intensity runs to 200 but is
 * usually about 12, and a material's scale runs to 32 but is usually near 1.
 * Spread linearly across a few hundred pixels, every value anyone actually
 * wants is inside the first few pixels of travel, and the control cannot reach
 * them. `curve: 'exp'` bends the travel so the bottom of the range gets most of
 * it — the same reason a volume slider is not linear in amplitude.
 */

/** How many pixels of travel it takes to cross a bounded field end to end. */
export const SWEEP_PX = 260;

/** Far enough that a click with a shaking hand is still a click. */
export const SLOP_PX = 3;

export type Range = {
  min: number;
  max: number;
  step: number;
  curve: Curve;
  /** Has ends to clamp to. */
  clamps: boolean;
  /** Has ends that mean a quantity, and so is drawn filled. */
  scaled: boolean;
};

/**
 * A step for a field that never declared one.
 *
 * `step` absent means the data file had no opinion, which is not the same as
 * "whole numbers only" — an attacks-per-second of 1.2 dragged in steps of 1 is
 * a control that cannot reach most of its useful values. Size the grain to the
 * number instead.
 */
const grainFor = (value: number) => (Math.abs(value) < 10 ? 0.1 : 1);

export function resolveRange(field: FieldSpec, value: number): Range {
  const min = Number(field.min);
  const max = Number(field.max);
  const clamps = Number.isFinite(min) && Number.isFinite(max);
  const declared = Number(field.step);

  return {
    min,
    max,
    step: Number.isFinite(declared) && declared > 0 ? declared : grainFor(value),
    curve: field.curve ?? 'linear',
    clamps,
    // Only a range is a scale. A number's ends are a clamp.
    scaled: field.kind === 'range' && clamps && max > min,
  };
}

/**
 * Where a value sits between its ends, 0..1 — the position of the fill, and
 * the position a drag moves along.
 *
 * An exponential field is measured in how many doublings it is above its floor
 * rather than in how much of its span it has covered. A floor of zero has no
 * doublings to count from, so it is nudged up by one step first.
 */
export function toPosition(range: Range, value: number): number {
  const { min, max, curve } = range;
  if (!(max > min)) return 0;
  if (curve === 'exp') {
    const floor = min > 0 ? min : range.step;
    const at = Math.max(floor, value);
    return clamp01(Math.log(at / floor) / Math.log(max / floor));
  }
  return clamp01((value - min) / (max - min));
}

/** The value at a position between the ends. The inverse of `toPosition`. */
export function fromPosition(range: Range, position: number): number {
  const { min, max, curve } = range;
  const at = clamp01(position);
  if (curve === 'exp') {
    const floor = min > 0 ? min : range.step;
    return floor * Math.pow(max / floor, at);
  }
  return min + at * (max - min);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Snap to the grain and hold inside the ends.
 *
 * The rounding is to four decimals beyond the grain rather than to the grain
 * itself, because a grain of 0.05 multiplied out lands on 0.15000000000000002
 * — which is the number that would then be written into the map file.
 */
export function quantise(range: Range, value: number, grain = range.step): number {
  const snapped = Math.round(value / grain) * grain;
  const held = range.clamps ? Math.min(range.max, Math.max(range.min, snapped)) : snapped;
  const decimals = (String(grain).split('.')[1] ?? '').length;
  return Number(held.toFixed(Math.max(decimals, 4)));
}

/**
 * The number as it should be read.
 *
 * A value that came off disk has whatever precision the arithmetic that made it
 * left behind — a rim depth of 0.14 arrives as 0.1399999999999999, and printing
 * that in a 60px box is both unreadable and untrue. Shown to the grain the
 * field is edited in, which is the precision the number actually has.
 */
export function display(range: Range, value: number): number {
  if (!Number.isFinite(value)) return 0;
  const decimals = (String(range.step).split('.')[1] ?? '').length;
  return Number(value.toFixed(decimals));
}

/**
 * How much a held modifier is worth while dragging.
 *
 * Shift is fine and ctrl/alt is coarse, which is the convention every tool of
 * this kind uses — the same box has to serve a cooldown measured in twentieths
 * and a fog distance measured in hundreds.
 */
export function grainFrom(range: Range, event: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }) {
  if (event.shiftKey) return { grain: range.step / 10, scale: 0.1 };
  if (event.ctrlKey || event.altKey) return { grain: range.step * 10, scale: 10 };
  return { grain: range.step, scale: 1 };
}

/**
 * Units, as the data files already write them.
 *
 * Every bounded field names its unit in its label — "Cooldown (sec)", "Range
 * (tiles)" — so the unit is lifted out of the label rather than added to nine
 * data files as a second way of saying the same thing. The name is what you
 * read once; the unit is what you need every time you look at the number, so it
 * belongs beside the number.
 */
const UNITS: Record<string, string> = {
  sec: 's',
  seconds: 's',
  deg: '°',
  degrees: '°',
  'deg/sec': '°/s',
  tiles: 't',
  'tiles/sec': 't/s',
  'tiles/sec2': 't/s²',
  percent: '%',
  '%': '%',
};

/** A label split into its name and its unit: "Cooldown (sec)" → Cooldown · s */
export function splitUnit(label: string): { name: string; unit: string } {
  const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label);
  if (!match) return { name: label, unit: '' };
  const unit = UNITS[match[2].toLowerCase()];
  // Only parentheses that really hold a unit are taken: "Arc (degrees)" is one,
  // "Level (unlocked at)" is part of the name and must survive intact.
  return unit ? { name: match[1], unit } : { name: label, unit: '' };
}

/**
 * Whether a picker has to offer an explicit "none".
 *
 * A `<select>` whose value matches no option shows its first one instead. For
 * an optional reference that means a record naming nothing reads as naming
 * whatever sorts first, and one touch of the control would make it so.
 */
export const needsEmptyChoice = (
  value: string,
  options: readonly (readonly [string, string])[],
) => !value || !options.some(([id]) => id === value);
