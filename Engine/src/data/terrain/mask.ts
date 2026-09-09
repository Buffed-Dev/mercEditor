/**
 * Topology: which of a cell's edges are exposed, and which of its corners break.
 *
 * `topologyOf` is the whole rule, and `cellMask` is the same answer unpacked.
 * One implementation on purpose: the render layer asks it which template a tile
 * should be given, and the template bake asks it what to shape — so if the two
 * could drift, a tile would be handed a mesh built for a neighbourhood it is
 * not in.
 *
 * An edge belongs to a *drop*. A hole, the map's edge and lower ground all
 * expose a side; a taller neighbour does not, because its own wall comes down
 * across that edge and covers it. The sides alone pick the shape, which is what
 * collapses sixteen arrangements onto six meshes and four turns; diagonals reach
 * only the corner bits, where four cells have to agree or the ground between
 * them tears.
 *
 * `subSides` answers the same question for one wall segment of a stack.
 *
 * **Nothing here reads terrain type.** That is not an oversight — it is the
 * requirement. A grass/sand boundary inside one platform is not a boundary of
 * the platform, so it must produce no cliff and no bevel, and the way to
 * guarantee that is for the code that shapes edges to have no access to the
 * information that would let it get it wrong.
 */

import { levelAt, type TerrainGrid } from './grid.ts';

/** Clockwise from +x, matching the map's quarter-turn convention. */
export const SIDES: readonly (readonly [number, number])[] = [
  [1, 0], // 0 east
  [0, -1], // 1 north
  [-1, 0], // 2 west
  [0, 1], // 3 south
];

/** Corner k sits between side k and side k+1. So 0 NE, 1 NW, 2 SW, 3 SE. */
export const CORNERS: readonly (readonly [number, number])[] = [
  [1, -1],
  [-1, -1],
  [-1, 1],
  [1, 1],
];

/** Where corner k is inside its own cell, as (fx, fy). */
export const CORNER_FXY: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 0],
  [0, 1],
  [1, 1],
];

/** Side k spans corners k and (k + 3) % 4. */
export const sideCorners = (k: number): [number, number] => [k, (k + 3) % 4];

export type CellMask = {
  /** Bit k set when side k faces open air or a drop: it needs a cliff. */
  sides: number;
  /** Bit k set when corner k has a lower or missing cell touching it. */
  corners: number;
  /** No exposed side and no broken corner: the cell is one flat quad. */
  flat: boolean;
};

/** True when `beside` is lower than `mine`, treating "no cell" as lower. */
const lower = (beside: number | null, mine: number): boolean => beside === null || beside < mine;

/**
 * A tile's topology, as the eight bits that pick its block.
 *
 * Low four bits are the sides: side k is set when nothing stands against it —
 * a hole, the edge of the map, or ground that sits lower.
 *
 * **A taller neighbour counts as a neighbour.** Its own wall comes down across
 * that edge and covers it, so rolling a rim over there would cut a groove into
 * the ground at the foot of every cliff, and a tile beside a raised column
 * would read as a corner piece wrapped around it instead of the plain side it
 * is. Only a drop is an edge.
 *
 * High four bits are the corners, and they are why this reads diagonals when
 * nothing else does. A corner is a point four cells share, so the four of them
 * have to agree about it or the surface tears: at the inside corner of an
 * L-shaped plateau the two cells along the edge roll down and the cell in the
 * crook does not, and the disagreement shows as a notch cut out of the ground.
 * Deciding it from all three cells that touch it — both sides and the diagonal —
 * makes all four reach the same answer. Two cells at the same level each see
 * the other as level with them, so both reduce to the same question about the
 * other two, which is why this is an invariant and not a coincidence.
 *
 * **The diagonal decides the corner, never the shape.** Which of the six block
 * shapes a tile gets, and how far it is turned, comes from the sides alone; the
 * corner bits only say where that shape dimples.
 *
 * Null where there is no tile.
 */
export function topologyOf(grid: TerrainGrid, gx: number, gy: number): number | null {
  const mine = levelAt(grid, gx, gy);
  if (mine === null) return null;

  const drops = (dx: number, dy: number) => lower(levelAt(grid, gx + dx, gy + dy), mine);

  let topology = 0;
  for (let k = 0; k < 4; k += 1) {
    if (drops(SIDES[k][0], SIDES[k][1])) topology |= 1 << k;
  }
  for (let k = 0; k < 4; k += 1) {
    const touching = [SIDES[k], SIDES[(k + 1) % 4], CORNERS[k]];
    if (touching.some(([dx, dy]) => drops(dx, dy))) topology |= 1 << (k + 4);
  }
  return topology;
}

/**
 * The same thing, unpacked, for the template bake.
 *
 * Not a second implementation of the rule — the bake has to ask exactly what
 * the placement asks, or a template would be shaped for a neighbourhood that
 * never arrives.
 */
export function cellMask(grid: TerrainGrid, gx: number, gy: number): CellMask | null {
  const topology = topologyOf(grid, gx, gy);
  if (topology === null) return null;
  return { sides: topology & 0b1111, corners: topology >> 4, flat: topology === 0 };
}

/** The four side bits of a topology: which of the six shapes, and its turn. */
export const sidesOf = (topology: number): number => topology & 0b1111;

export function subSides(grid: TerrainGrid, gx: number, gy: number, at: number): number {
  let sides = 0;
  for (let k = 0; k < 4; k += 1) {
    const [dx, dy] = SIDES[k];
    const beside = levelAt(grid, gx + dx, gy + dy);
    if (beside === null || beside < at) sides |= 1 << k;
  }
  return sides;
}
