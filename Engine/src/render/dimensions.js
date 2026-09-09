/**
 * How big the world's pieces are, in world units. One tile is one unit on X
 * and Z; these are the vertical numbers.
 *
 * They live alone rather than in the scene builder because the terrain builder
 * needs them and the scene builder needs the terrain builder.
 */

/** The height of one map level: a slab of terrain, and a ramp's whole rise. */
export const LEVEL_H = 0.5;

/** How tall a wall tile stands above the ground. */
export const WALL_H = 1.3;
