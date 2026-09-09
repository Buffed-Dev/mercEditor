/**
 * How a stat is written on screen.
 *
 * Attributes are authored with a step as fine as 0.1 and are then multiplied by
 * modifiers, so a move speed of 3 becomes 3.5999999999999996 the moment a 20%
 * haste lands. Rounding to two places is enough to hide that without hiding a
 * fraction the player was actually given.
 */
export function formatStat(value) {
  if (!Number.isFinite(value)) return '—';
  return String(Math.round(value * 100) / 100);
}
