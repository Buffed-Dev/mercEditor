import { spawnPoint, wallStacks } from '../data/mapFormat.ts';
import { LEVEL_H } from '../data/dimensions.ts';
import { blockedTiles, standHeights } from '../data/props.ts';
import { decodeTerrain } from '../data/terrain/codec.ts';
import { levelAt as gridLevelAt } from '../data/terrain/grid.ts';

/**
 * The map, the surface heights and the collision rules — everything about the
 * world that does not care how it is drawn. Positions are continuous grid
 * coordinates (gx, gy) and heights are in levels, exactly as in the 2D version;
 * the renderer decides how many world units a level is worth.
 *
 * One World wraps one map definition from data/maps/. Changing maps means
 * building a new World, not mutating this one.
 */

export const PLAYER_RADIUS = 0.2; // half-extent of the player's footprint, in tiles
/**
 * How much of a rise you may walk up, in levels, when a map does not say.
 *
 * One block: a step you can take. Anything a map wants taller or shorter it
 * says for itself, because how climbable the world is is a decision about that
 * map rather than about the engine.
 */
export const DEFAULT_STEP = 1;
const EPS = 1e-4;


export class World {
  /**
   * @param {object} map a map definition from data/maps/
   * @param {string} spawnName which of the map's arrival points to spawn at
   * @param {object[]} [propDefs] the objects to read. The game leaves this out
   *   and gets its own; the editor names the ones being edited, so a change to
   *   what an object *is* shows without saving first.
   */
  constructor(map, spawnName = 'default', propDefs = null) {
    // The map's terrain rows, decoded once. The grid is the single source of
    // what is where: the renderer builds its triangles from the same object, so
    // what you walk on and what you see cannot drift apart.
    const decoded = decodeTerrain(map);
    this.map = map;
    this.terrain = decoded.grid;
    this.terrainIds = decoded.terrainIds;
    this.terrainProblems = decoded.problems;
    this.cols = decoded.grid.cols;
    this.rows = decoded.grid.rows;
    /** How tall the column on a tile is, or null where there is no cell. */
    this.levelAt = (tx, ty) => gridLevelAt(decoded.grid, tx, ty);
    // How much of a rise counts as a step rather than a cliff.
    this.stepHeight = map.stepHeight ?? DEFAULT_STEP;
    this.spawn = spawnPoint(map, { spawn: { gx: this.cols / 2, gy: this.rows / 2 } }, spawnName);
    this.portals = map.portals ?? [];
    // Walls are objects standing on the ground now, so what blocks movement is
    // a lookup in a list rather than a character in the grid.
    this.walls = wallStacks(map.walls);
    // Objects that block the way. Kept apart from the walls rather than added
    // to them: a wall stack is also what gets *drawn* as a wall, and a boulder
    // you cannot walk through is not a wall with a boulder next to it.
    const propOf = propDefs
      ? (id) => propDefs.find((def) => def.id === id) ?? null
      : undefined;
    this.blockers = blockedTiles(map.props, ...(propOf ? [propOf] : []));
    // And the ones you stand on top of rather than walk around. Kept apart from
    // the terrain for the same reason: what you can see and what the ground is
    // are the same surface, and an object standing on it is neither.
    this.platforms = standHeights(map.props, ...(propOf ? [propOf] : []));

    // Where the map says the player comes up, if it is not the ground. It goes
    // in with the objects rather than beside them because it is the same
    // question — how high is the floor on that tile — and because nothing holds
    // an actor off the floor: a start height that were not the floor would last
    // exactly one frame. Walking off it is therefore stepping off a ledge,
    // which is what standing somewhere high means.
    if (map.startZ) {
      const key = `${Math.floor(this.spawn.gx)},${Math.floor(this.spawn.gy)}`;
      this.platforms.set(key, Math.max(this.platforms.get(key) ?? 0, map.startZ));
    }
  }

  /**
   * Where an actor's feet go: the terrain, plus the top of anything on that
   * tile that is meant to be stood on. In levels, like `heightAt`, so the two
   * are interchangeable at a call site.
   *
   * Not folded into `heightAt`, because that is the surface the map is *drawn*
   * from — an object asking how high the ground under it is would otherwise be
   * told its own roof and stand on itself.
   */
  standAt(gx, gy) {
    const top = this.platforms.get(`${Math.floor(gx)},${Math.floor(gy)}`) ?? 0;
    return this.heightAt(gx, gy) + top / LEVEL_H;
  }

  /**
   * The portal the given position is standing on, if any. Portals occupy a
   * single tile, so this is just a tile-index comparison.
   */
  portalAt(gx, gy) {
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    return this.portals.find((p) => p.gx === tx && p.gy === ty) ?? null;
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.cols && ty < this.rows;
  }

  /** How many wall blocks stand on a tile. Zero for open ground. */
  wallStack(tx, ty) {
    return this.walls.get(`${tx},${ty}`) ?? 0;
  }

  /**
   * For collision: out of bounds is solid, so the map border needs no case.
   *
   * One block or six, a wall is impassable — stacking changes how tall it looks
   * and nothing about whether you can walk through it.
   */
  isWall(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    // A cell with no terrain is a hole, and a hole is not somewhere you may
    // walk. Out of bounds was always solid for this reason; now that a map can
    // have holes in the middle of it, the middle needs the same answer.
    if (this.levelAt(tx, ty) === null) return true;
    return this.wallStack(tx, ty) > 0 || this.blockers.has(`${tx},${ty}`);
  }

  /** For geometry and lighting: out of bounds is empty space, not wall. */
  isWallTile(tx, ty) {
    return this.inBounds(tx, ty) && this.wallStack(tx, ty) > 0;
  }

  /**
   * Walkable surface height, in levels, at a continuous grid position.
   *
   * A tile is flat and steps to its neighbours, so this only ever looks at the
   * tile the point is on. That locality is the whole rule: a height that
   * depended on the tiles around it could not produce a vertical face, which is
   * exactly what the surface this replaced could not do.
   *
   * There used to be an exception for ramps. There is no longer: every rise is
   * a step, and `canStand` decides which of them can be climbed.
   */
  heightAt(gx, gy) {
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    if (!this.inBounds(tx, ty)) return 0;
    return this.levelAt(tx, ty) ?? 0;
  }

  hitsWall(gx, gy, r = PLAYER_RADIUS) {
    const x0 = Math.floor(gx - r);
    const x1 = Math.floor(gx + r);
    const y0 = Math.floor(gy - r);
    const y1 = Math.floor(gy + r);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.isWall(tx, ty)) return true;
      }
    }
    return false;
  }

  /**
   * Is any tile under this footprint too tall to step onto from `fromH`?
   *
   * The footprint, where `canStand` asks about the point. That difference is
   * deliberate for *drops* — you are meant to be able to stand on the lip of a
   * ledge and to walk onto one — but for a rise it is what let a body walk half
   * of itself into a cliff before anything objected.
   */
  blockedRise(gx, gy, fromH, r = PLAYER_RADIUS) {
    const x0 = Math.floor(gx - r);
    const x1 = Math.floor(gx + r);
    const y0 = Math.floor(gy - r);
    const y1 = Math.floor(gy + r);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        // Off the map reads as the ground, exactly as `heightAt` does, so the
        // edge of the world is a drop rather than a wall.
        if (!this.inBounds(tx, ty)) continue;
        if ((this.levelAt(tx, ty) ?? 0) - fromH > this.stepHeight) return true;
      }
    }
    return false;
  }

  /**
   * May an actor at height `fromH` move to this point?
   *
   * There is no footprint check any more, and its absence is the point. It
   * existed to stop an actor standing half over a drop on a surface that had no
   * drops in it — back when every height change was a ramp, so a footprint spanning two
   * heights meant something had gone wrong. On stepped ground it is the
   * ordinary case: you stand on the tile you are on, and standing near a ledge
   * is standing near a ledge. Keeping the check would have meant never being
   * able to walk within a body's width of one, which includes never being able
   * to climb onto one.
   */
  canStand(gx, gy, fromH) {
    if (this.hitsWall(gx, gy)) return false;
    // Up is limited, down is not. Only climbing is the thing a step height is
    // about — and the alternative was found the hard way: a symmetric rule
    // strands anything that starts on a raised tile, because every way off it
    // is a drop taller than a step. Standing somewhere you cannot leave is
    // worse than any amount of falling.
    return this.heightAt(gx, gy) - fromH <= this.stepHeight;
  }

  /**
   * Move one axis at a time, snapping flush to whatever blocks us. Resolving
   * the axes separately is what lets the player slide along a wall instead of
   * sticking to it.
   *
   * @param {{gx:number, gy:number}} pos mutated in place
   */
  move(pos, dgx, dgy) {
    const r = PLAYER_RADIUS;
    let { gx, gy } = pos;

    if (dgx !== 0) {
      const fromH = this.heightAt(gx, gy);
      const free = this.stander(gx, gy, fromH, 'x');
      const nx = gx + dgx;
      if (free(nx)) {
        gx = nx;
      } else {
        // Flush against whatever stopped us — but never behind where we already
        // stand. Snapping backwards is how a body ended up buzzing at the foot
        // of a cliff: it would be shoved back, walk up again, and be shoved
        // back again, every frame. If the flush spot is behind us we are
        // already as close as we get, and the answer is to stop.
        const snapped = dgx > 0 ? Math.floor(nx + r) - r - EPS : Math.floor(nx - r) + 1 + r + EPS;
        if ((dgx > 0 ? snapped > gx : snapped < gx) && free(snapped)) gx = snapped;
      }
    }

    if (dgy !== 0) {
      const fromH = this.heightAt(gx, gy);
      const free = this.stander(gx, gy, fromH, 'y');
      const ny = gy + dgy;
      if (free(ny)) {
        gy = ny;
      } else {
        const snapped = dgy > 0 ? Math.floor(ny + r) - r - EPS : Math.floor(ny - r) + 1 + r + EPS;
        if ((dgy > 0 ? snapped > gy : snapped < gy) && free(snapped)) gy = snapped;
      }
    }

    pos.gx = gx;
    pos.gy = gy;
    return pos;
  }

  /**
   * "May I be at this coordinate on this axis?", for one step of one move.
   *
   * Walls and drops go through `canStand` as they always did. A rise too tall
   * to climb is refused on the *footprint* instead, so a body stops with its
   * edge against the cliff rather than walking its centre into it.
   *
   * The escape matters as much as the rule: if the footprint is *already*
   * inside such a tile — spawned there, or the ground was raised under it —
   * the footprint test is dropped for this move. A body that cannot leave
   * where it is standing is worse than any amount of clipping, and refusing
   * both axes would be exactly that.
   */
  stander(gx, gy, fromH, axis) {
    const stuck = this.blockedRise(gx, gy, fromH);
    return (at) => {
      const x = axis === 'x' ? at : gx;
      const y = axis === 'x' ? gy : at;
      if (!this.canStand(x, y, fromH)) return false;
      return stuck || !this.blockedRise(x, y, fromH);
    };
  }
}
