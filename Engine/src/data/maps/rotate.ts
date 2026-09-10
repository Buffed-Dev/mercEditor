import type { Placed } from '../mapFormat.ts';

/**
 * Turning a piece of a map a quarter of the way round.
 *
 * Shared by the two things that do it: a chunk, cut out of a hand-drawn map and
 * fitted into a generated one, and a prefab, placed at whatever angle you drop
 * it. Both are a box of tiles with things standing on them, and both have the
 * same two facts to apply.
 *
 * The first is where a tile lands. Under one clockwise turn inside a box `h`
 * tall, the tile at (gx, gy) lands at (h - 1 - gy, gx) — and the box comes out
 * `h` wide by however many it was, so the two swap.
 *
 * The second is that anything carrying a direction has to turn with it, or it
 * comes out of a rotated piece pointing at a wall: a torch's mounting face, a
 * sun's compass bearing, an object's own turn. A tile is one unit on X and Z,
 * so a clockwise turn of the grid is a quarter turn of the world the other way
 * — which is why every angle here has ninety taken off it rather than added.
 */

/** Where a face points after one quarter turn clockwise. */
export const TURN_FACE: Record<string, string> = {
  '+x': '+y',
  '+y': '-x',
  '-x': '-y',
  '-y': '+x',
};

/** An angle in degrees, brought back into 0–359. */
const wrap = (deg: number): number => (((deg % 360) + 360) % 360);

/**
 * One placed thing, turned once clockwise inside a box `height` tall.
 *
 * The fields past the position are narrowed rather than cast: a placed thing is
 * a position plus whatever else its file gave it, so the format cannot promise
 * that `face` is a side or `rot` a number — only this can check.
 */
export function turnEntry<T extends Placed>(entry: T, height: number): T {
  const { gx, gy, ...rest } = entry;
  const turned = { ...rest, gx: height - 1 - gy, gy: gx } as unknown as Record<string, unknown>;

  const face = turned.face;
  if (typeof face === 'string') turned.face = TURN_FACE[face] ?? face;

  // A sun's bearing is an angle on the same compass the tiles live on: its
  // offset is (sin a, cos a), and turning that vector clockwise is the same as
  // taking ninety degrees off the angle.
  const azimuth = turned.azimuth;
  if (typeof azimuth === 'number') turned.azimuth = wrap(azimuth - 90);

  // An object's own turn, for the same reason and by the same amount.
  const rot = turned.rot;
  if (typeof rot === 'number') turned.rot = wrap(rot - 90);

  return turned as unknown as T;
}

/**
 * Every list turned together, and the box they end up in.
 *
 * `turns` is taken modulo four and applied one at a time, because the height it
 * turns inside is the height it has *now* — after an odd turn that is the width
 * it started with.
 */
export function turnLists<T extends Placed>(
  lists: Readonly<Record<string, readonly T[]>>,
  w: number,
  h: number,
  turns: number,
): { lists: Record<string, T[]>; w: number; h: number } {
  let out: Record<string, T[]> = {};
  for (const [name, list] of Object.entries(lists)) out[name] = [...list];

  let width = w;
  let height = h;
  for (let n = ((turns % 4) + 4) % 4; n > 0; n -= 1) {
    const next: Record<string, T[]> = {};
    for (const [name, list] of Object.entries(out)) {
      next[name] = list.map((entry) => turnEntry(entry, height));
    }
    out = next;
    [width, height] = [height, width];
  }
  return { lists: out, w: width, h: height };
}
