import { cornerMesh, type EdgeProfile, type ShapeSlot } from '../profiles.ts';
import { sideAt } from './mask.ts';
import { shapeOf } from './templates.ts';

/**
 * Which whole-tile profile piece a tile is drawn with, if any.
 *
 * Nothing here decides *whether* an edge is exposed — that is still
 * `topologyOf` and `subSides` in mask.ts, untouched. This takes that exposure,
 * asks each exposed side which profile it wears (the cell's override for that
 * side, else its terrain's default), and picks one piece for the whole tile.
 *
 * Every piece is a complete 1×1 block modelled in one canonical orientation;
 * the tile's exposed sides say which piece and how far it is turned:
 *
 *   one side            edge          (east exposed)
 *   two adjacent sides  outerCorner   (east + north)
 *   two opposite sides  corridor      (east + west)
 *   three sides         cap           (all but south)
 *   four sides          single
 *   none, a diagonal    innerCorner   (the north-east diagonal drops)
 *
 * A corner's two sides may wear different profiles: `cornerMesh` resolves it
 * (priority, then transitions). A corridor, cap or single uses the
 * highest-priority profile among its sides.
 *
 * A tile falls back to the generated block — exactly as before profiles
 * existed — when any exposed side has no profile or the piece it needs is not
 * assigned. So a tile is always wholly a profile piece or wholly generated.
 */

/** One model for a whole tile, turned `rot` quarter turns. */
export type Piece = { mesh: string; rot: number };

export type EdgePlan = {
  /** False: draw the generated block from `topology`. */
  profiled: boolean;
  topology: number;
  pieces: Piece[];
};

/** Which profile one edge of one cell wears, or null for the generated rim. */
export type ProfileOfEdge = (gx: number, gy: number, side: number) => EdgeProfile | null;

const bit = (bits: number, k: number) => Boolean(bits & (1 << (((k % 4) + 4) % 4)));

const generated = (topology: number): EdgePlan => ({ profiled: false, topology, pieces: [] });

/** The highest-priority profile of several; the first on a tie. */
const highest = (profiles: readonly EdgeProfile[]) =>
  profiles.reduce((best, one) => (one.priority > best.priority ? one : best));

/** The piece for a set of exposed sides that all wear a profile, or null. */
function pieceFor(sides: number, profiles: readonly (EdgeProfile | null)[]): Piece | null {
  const { shape, rot } = shapeOf(sides);
  const exposed = [0, 1, 2, 3].filter((k) => bit(sides, k)).map((k) => profiles[k]!);
  if (shape === 'side') return exposed[0]!.edge ? { mesh: exposed[0]!.edge, rot } : null;
  if (shape === 'corner') {
    // A corner turned `rot` has sides `rot` and `rot + 1` exposed.
    const mesh = cornerMesh(profiles[rot]!, profiles[(rot + 1) % 4]!, 'outerCorner');
    return mesh ? { mesh, rot } : null;
  }
  const slot: ShapeSlot = shape === 'corridor' ? 'corridor' : shape === 'cap' ? 'cap' : 'single';
  const mesh = highest(exposed)[slot];
  return mesh ? { mesh, rot } : null;
}

/** Exposed sides all wearing a profile: its piece, else the generated block. */
function planSides(gx: number, gy: number, sides: number, topology: number, profileOf: ProfileOfEdge): EdgePlan {
  const profiles = [0, 1, 2, 3].map((k) => (bit(sides, k) ? profileOf(gx, gy, k) : null));
  if ([0, 1, 2, 3].some((k) => bit(sides, k) && !profiles[k])) return generated(topology);
  const piece = pieceFor(sides, profiles);
  return piece ? { profiled: true, topology, pieces: [piece] } : generated(topology);
}

/**
 * The top block of a tile.
 *
 * @param topology the tile's eight-bit topology from `topologyOf`
 */
export function planTop(gx: number, gy: number, topology: number, profileOf: ProfileOfEdge): EdgePlan {
  const sides = topology & 0b1111;
  if (sides) return planSides(gx, gy, sides, topology, profileOf);

  // No side exposed: only a dropping diagonal makes this anything but flat.
  // An inner corner when exactly one corner drops and the two neighbours whose
  // edges run into it wear profiles that resolve to one.
  const dropping = [0, 1, 2, 3].filter((k) => bit(topology >> 4, k));
  if (dropping.length !== 1) return generated(topology);
  const k = dropping[0]!;
  const [ax, ay] = sideAt(k);
  const [bx, by] = sideAt(k + 1);
  const alongA = profileOf(gx + ax, gy + ay, (k + 1) % 4);
  const alongB = profileOf(gx + bx, gy + by, k);
  const mesh = cornerMesh(alongA, alongB, 'innerCorner');
  return mesh ? { profiled: true, topology, pieces: [{ mesh, rot: k }] } : generated(topology);
}

/**
 * A stack block below the top: the same piece for the sides exposed at that
 * level, or the generated wall.
 *
 * @param mask the four side bits from `subSides`
 */
export function planSub(gx: number, gy: number, mask: number, profileOf: ProfileOfEdge): EdgePlan {
  return mask ? planSides(gx, gy, mask, mask, profileOf) : generated(mask);
}
