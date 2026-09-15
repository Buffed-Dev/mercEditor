/**
 * The rim profile: how a platform's top edge rolls over into its cliff.
 *
 * A list of rings, running inward to outward. Ring 0 is where the flat top
 * ends; the last ring is the cell boundary, where the cliff starts. `inset` is
 * measured in tiles from the boundary, `drop` in world units below the top
 * plane.
 *
 * This is the whole of the platform's edge shape. It is data because it is the
 * one thing that decides whether the map reads as chunky or as soft, and that
 * is a judgement made by eye against the art, not a constant anyone can pick
 * correctly up front.
 */

export type RimRing = { inset: number; drop: number };

export type FootProfile = { width: number; depth: number };

/** The visible roll where a cliff meets lower occupied terrain. */
export const DEFAULT_FOOT: Readonly<FootProfile> = { width: 0.11, depth: 0.12 };

export function normalizeFoot(foot: Partial<FootProfile> | null | undefined): FootProfile {
  return {
    width: clamp(Number(foot?.width) || DEFAULT_FOOT.width, 0.01, 0.3),
    depth: clamp(Number(foot?.depth) || DEFAULT_FOOT.depth, 0.01, 0.3),
  };
}

/**
 * How many rings a rim built from a width and a depth gets.
 *
 * Five rather than three, and the difference is the whole reason `rimOf`
 * exists: three points on a curve read as two straight bevels meeting at a
 * crease, and no amount of adjusting the two sliders makes that look round.
 *
 * The cost of more is nothing where it used to be something. Rings are lattice
 * lines, so a shaped cell is `(2n-1)^2` quads — and shaped cells are now *baked
 * templates*, thirty-two of them for the whole map, rather than one per tile.
 */
export const RIM_RINGS = 8;

/**
 * A width and a depth as a quarter-round roll-over.
 *
 * The curve is a quarter circle, sampled at `rings` points: it leaves the flat
 * top horizontally and arrives at the cliff vertically, which is what makes the
 * edge read as rolled rather than as chamfered. Anything less than tangent at
 * both ends shows as a crease, because a crease is exactly what it is.
 *
 * @param width how far in from the cell boundary the roll starts, in tiles
 * @param depth how far below the top plane it has fallen by the boundary
 */
export function rimOf(width: number, depth: number, rings = RIM_RINGS): RimRing[] {
  const n = Math.max(2, Math.round(rings));
  return Array.from({ length: n }, (_, i) => {
    const turn = (i / (n - 1)) * (Math.PI / 2);
    return {
      // Horizontal travel is the sine, so the first step in is small and the
      // last is large: the samples bunch where the curve bends hardest.
      inset: width * (1 - Math.sin(turn)),
      drop: depth * (1 - Math.cos(turn)),
    };
  });
}

/** A soft roll-over. Wide enough to read at the game's camera angle. */
export const DEFAULT_RIM: readonly RimRing[] = rimOf(0.12, 0.14);

/**
 * How far below its own top plane a rim has fallen by the cell boundary.
 *
 * The number every wall has to be lengthened by. A tile's neighbour dips by
 * exactly this much where the two of them meet, so a wall that stopped at its
 * own level would leave a gap of exactly this height along the foot of every
 * cliff on the map — which is the bug this is here to name.
 */
export const rimDrop = (rim: readonly RimRing[]): number => rim[rim.length - 1]?.drop ?? 0;

/**
 * The largest inset a ring may have.
 *
 * At 0.5 the two sides of a cell's rim meet in the middle and the flat top has
 * no area at all; past it they cross and the surface turns inside out. Clamped
 * rather than rejected, because this arrives from a slider.
 */
const MAX_INSET = 0.45;

/**
 * A rim list with everything a generator relies on made true.
 *
 * The invariants are not stylistic. `inset` strictly decreasing is what makes
 * ring index usable as a distance; `drop` non-decreasing is what keeps the
 * surface single-valued; the first ring having no drop is what joins the rim to
 * the flat top; the last having no inset is what puts the cliff on the cell
 * boundary, where the neighbour expects it.
 */
export function normalizeRim(rim: readonly RimRing[] | null | undefined): RimRing[] {
  const source = Array.isArray(rim) && rim.length >= 2 ? rim : DEFAULT_RIM;

  const rings = source
    .map((ring) => ({
      inset: clamp(Number(ring?.inset) || 0, 0, MAX_INSET),
      drop: Math.max(0, Number(ring?.drop) || 0),
    }))
    .sort((a, b) => b.inset - a.inset);

  // Ties would make two rings the same distance from the edge, which leaves a
  // zero-width strip of geometry: real triangles with no area.
  for (let i = 1; i < rings.length; i += 1) {
    const ring = rings[i]!;
    const inner = rings[i - 1]!;
    if (ring.inset >= inner.inset) ring.inset = inner.inset / 2;
    if (ring.drop < inner.drop) ring.drop = inner.drop;
  }

  // `source` is a rim of at least two rings or the default, so both ends are
  // there; asking is what lets the types say so, and the fallback is the same
  // one an under-length rim took before the mapping.
  const first = rings[0];
  const last = rings[rings.length - 1];
  if (!first || !last) return normalizeRim(DEFAULT_RIM);

  first.drop = 0;
  last.inset = 0;
  return rings;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
