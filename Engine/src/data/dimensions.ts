/**
 * How big the world's pieces are, in world units. One tile is one unit on X
 * and Z; these are the vertical numbers.
 *
 * They sit in `data/` rather than next to the scene builder because `game/`
 * needs them too — `world.ts` turns a level index into a standing height — and
 * the layer rule is that `game/` never reaches into `render/`. A pair of
 * measurements is not a rendering decision: it is the shared vocabulary the
 * renderer and the simulation both have to agree on, which is exactly what
 * `data/` is for.
 */

/** The height of one map level: a slab of terrain, and a ramp's whole rise. */
export const LEVEL_H = 0.5;

/** How tall a wall tile stands above the ground. */
export const WALL_H = 1.3;
