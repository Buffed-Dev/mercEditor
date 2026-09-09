/**
 * What the turn handle writes, from the angle it was let go at.
 *
 * A torch has four faces to land on; a light has the whole compass. Both read
 * the heading the same way — `atan2(dx, dz)`, as everything else in the game
 * does — and differ only in where they are allowed to land.
 *
 * Snapping is on by default because every heading anyone has written by hand is
 * a whole number, and a free handle writes `azimuth: 309.437284` into a file
 * otherwise full of round ones. Off is for when the exact angle is the point,
 * and even then it is held to two decimals: past that is noise from the
 * arithmetic rather than anything anyone aimed at.
 */

/**
 * How far apart the turn handle's landing places are, in degrees.
 *
 * Declared here rather than with the tool state so this module depends on
 * nothing: it is arithmetic, and arithmetic should be testable without a store.
 */
export const TURN_STEP = 15;

export const FACES_BY_QUARTER = ['+y', '+x', '-y', '-x'];

/** One of four wall faces, for the things that mount on a wall. */
export function headingToFace(heading: number): string {
  return FACES_BY_QUARTER[((Math.round(heading / (Math.PI / 2)) % 4) + 4) % 4];
}

/** A compass bearing in degrees, 0..359. */
export function headingToDegrees(heading: number, snap: boolean): number {
  const degrees = ((((heading * 180) / Math.PI) % 360) + 360) % 360;
  if (!snap) return Number(degrees.toFixed(2));
  // Modulo after rounding: a hair under 360 rounds up to it, and 360 is 0.
  return (Math.round(degrees / TURN_STEP) * TURN_STEP) % 360;
}
