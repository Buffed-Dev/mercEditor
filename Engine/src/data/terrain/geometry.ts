/**
 * The terrain surface, as triangles.
 *
 * Nothing here imports Babylon. It takes a grid and returns plain typed arrays
 * plus a table saying which material draws which run of them, which is what
 * lets the whole of the hard part — topology, watertightness, the agreement
 * between drawn ground and walkable ground — be asserted by `node --test` with
 * no scene, no canvas and no GPU.
 *
 * ## The lattice
 *
 * A cell is not one quad and not a 3x3 patch. Every cell is cut on the same
 * lattice: for each axis, the rim's insets measured in from the low edge, then
 * mirrored in from the high edge. With the default three-ring rim that is six
 * lines per axis and twenty-five quads for a cell that needs shaping.
 *
 * The lattice is the reason this is watertight. Two neighbours cut their shared
 * edge at the same coordinates, because those coordinates are a function of the
 * shared axis and the rim and nothing else — not of which cell is asking. And
 * the height at each of those points is a function of the cells touching it,
 * which both neighbours agree on. So they meet exactly, as floats, with no
 * tolerance and no welding step.
 *
 * A cell with nothing to shape skips the lattice and emits one quad. That is
 * almost every cell on a real map, and it leaves a T-junction against a shaped
 * neighbour — harmless, because the shaped cell's extra boundary points lie
 * exactly on the flat cell's straight edge at exactly its height. A flat cell
 * can only neighbour a shaped one along an edge where the shaping has no drop.
 *
 * ## Cells never share vertices
 *
 * Deliberate, and worth defending because it looks like waste. Sharing would
 * break per-terrain submesh grouping, the flat
 * normals the faceted look depends on, and the per-cell vertex ranges that make
 * a future incremental rebuild a slice rewrite. Do not weld them.
 */

import { cellMask, SIDES, type CellMask } from './mask.ts';
import { normalizeRim, DEFAULT_RIM, type RimRing } from './profile.ts';
import { levelAt, kindAt, EMPTY, type TerrainGrid } from './grid.ts';

/** Side indices, named. Clockwise from +x: east, north, west, south. */
const EAST = 0;
const NORTH = 1;
const WEST = 2;
const SOUTH = 3;

/** Corner k sits between side k and side k+1, so this is the pair to corner. */
const CORNER_OF: Record<number, Record<number, number>> = {
  [EAST]: { [NORTH]: 0, [SOUTH]: 3 },
  [WEST]: { [NORTH]: 1, [SOUTH]: 2 },
};

export type MeshGroup = { material: string; start: number; count: number };

export type TerrainMeshData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Contiguous runs of `indices`, one per material, partitioning the whole. */
  groups: MeshGroup[];
};

export type TerrainGeometry = {
  solid: TerrainMeshData;
  /** [firstVertex, vertexCount] per cell, for rebuilding one cell's slice. */
  cellStart: Int32Array;
};

export type GeometryOptions = {
  rim?: readonly RimRing[];
  levelH?: number;
  /** How far below level 0 an unsupported cliff hangs. */
  baseY?: number;
  /** World units of terrain per texture repeat, per terrain kind. */
  uvScaleOf?: (kind: number) => number;
};

/**
 * Which way round an index triple has to be written for the GPU to treat that
 * side as the front.
 *
 * Babylon flips its culling convention under `useRightHandedSystem`
 * (render/engine.js), and the interaction with material side orientation is the
 * classic thing to get backwards — the first build of this rendered inside out,
 * showing the inner faces of the far cliffs and no tops at all. Every triangle
 * in this file goes through one emitter, so this constant was the whole fix.
 *
 * The stored normal always points outward regardless; only the index order
 * changes. Exported so the tests can assert the two agree rather than assuming
 * a value.
 */
export const FRONT_CCW = false;

export type Vec3 = { x: number; y: number; z: number };

export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  /** Triangles per material, concatenated into one buffer at the end. */
  buckets = new Map<string, number[]>();

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(p: Vec3, n: Vec3, u: number, v: number): number {
    const index = this.vertexCount;
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.uvs.push(u, v);
    return index;
  }

  tri(material: string, a: number, b: number, c: number): void {
    let bucket = this.buckets.get(material);
    if (!bucket) this.buckets.set(material, (bucket = []));
    bucket.push(a, b, c);
  }

  /**
   * One quad, as two independently shaded triangles.
   *
   * Each triangle carries its own three vertices and its own normal rather than
   * four shared vertices carrying an average. A quad on the rim is genuinely
   * not planar — its four corners can sit at four different drops — and one
   * averaged normal there is up to forty degrees away from the surface it is
   * meant to describe, which reads as a smear of wrong shading all the way
   * round every platform. Two more vertices per quad is the cheaper mistake.
   *
   */
  quad(
    material: string,
    corners: readonly [Vec3, Vec3, Vec3, Vec3],
    uv: readonly [number, number][],
  ): void {
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]] as const) {
      this.triangle(material, corners[i], corners[j], corners[k], uv[i], uv[j], uv[k]);
    }
  }

  triangle(
    material: string,
    a: Vec3,
    b: Vec3,
    c: Vec3,
    ua: readonly [number, number],
    ub: readonly [number, number],
    uc: readonly [number, number],
  ): void {
    const n = triangleNormal(a, b, c);
    // A triangle collapsed to a line has no normal and nothing to draw. It
    // happens where a rim ring has zero width, which normalizeRim prevents,
    // and where a cliff has zero height, which a flush neighbour produces.
    if (n === null) return;
    const base = this.vertexCount;
    this.vertex(a, n, ua[0], ua[1]);
    this.vertex(b, n, ub[0], ub[1]);
    this.vertex(c, n, uc[0], uc[1]);
    if (FRONT_CCW) this.tri(material, base, base + 1, base + 2);
    else this.tri(material, base, base + 2, base + 1);
  }

  finish(): TerrainMeshData {
    const groups: MeshGroup[] = [];
    const indices: number[] = [];
    // Sorted so the output is a pure function of the input: a Map iterates in
    // insertion order, and insertion order follows whichever cell happened to
    // be shaped first.
    for (const material of [...this.buckets.keys()].sort()) {
      const bucket = this.buckets.get(material)!;
      if (!bucket.length) continue;
      groups.push({ material, start: indices.length, count: bucket.length });
      for (const i of bucket) indices.push(i);
    }
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      indices: new Uint32Array(indices),
      groups,
    };
  }
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const az = b.z - a.z;
  const bx = c.x - a.x;
  const by = c.y - a.y;
  const bz = c.z - a.z;
  const x = ay * bz - az * by;
  const y = az * bx - ax * bz;
  const z = ax * by - ay * bx;
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) return null;
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * The lattice coordinates along one axis of a cell, low edge to high edge.
 *
 * Each carries the side it belongs to and how far out along the rim it is, so
 * the drop at any lattice point is a lookup rather than a measurement.
 */
type Tick = { at: number; side: number; ring: number };

function axisTicks(base: number, rim: readonly RimRing[], lowSide: number, highSide: number): Tick[] {
  const ticks: Tick[] = [];
  for (let r = rim.length - 1; r >= 0; r -= 1) {
    ticks.push({ at: base + rim[r].inset, side: lowSide, ring: r });
  }
  for (let r = 0; r < rim.length; r += 1) {
    ticks.push({ at: base + 1 - rim[r].inset, side: highSide, ring: r });
  }
  return ticks;
}

/**
 * How far a lattice point sits below its cell's surface plane.
 *
 * Three terms, and the maximum wins. The two side terms roll the edge over
 * wherever that edge faces open air. The corner term is the one that matters:
 * it uses the *inner* of the two ring indices, so the drop tapers to nothing as
 * you move away from the corner along either axis — which is what turns a
 * concave corner into a small dimple instead of a cliff, and what makes two
 * neighbours agree along an edge where only one of them is exposed.
 */
function dropAt(mask: CellMask, rim: readonly RimRing[], x: Tick, y: Tick): number {
  let drop = 0;
  if (mask.sides & (1 << x.side)) drop = Math.max(drop, rim[x.ring].drop);
  if (mask.sides & (1 << y.side)) drop = Math.max(drop, rim[y.ring].drop);
  const corner = CORNER_OF[x.side][y.side];
  if (mask.corners & (1 << corner)) {
    drop = Math.max(drop, rim[Math.min(x.ring, y.ring)].drop);
  }
  return drop;
}

/**
 * Terrain triangles for a whole map.
 *
 * Whole-map rather than per-region: the editor already coalesces rebuilds to
 * one a frame, a 64x64 map is 4096 cells, and the parts of a rebuild that
 * actually cost — shader compilation, texture upload — are cached elsewhere and
 * untouched by this.
 *
 * ponytail: whole-map rebuild. `cellStart` records each cell's vertex range, so
 * per-region rebuild is a slice rewrite when a 64x64 build measures over 8ms.
 * If that is ever done, note that painting one cell dirties its 3x3
 * neighbourhood, not its 4-neighbourhood — corners read the diagonals.
 */
export function buildTerrainGeometry(
  grid: TerrainGrid,
  options: GeometryOptions = {},
): TerrainGeometry {
  const rim = normalizeRim(options.rim ?? DEFAULT_RIM);
  const levelH = options.levelH ?? 0.5;
  const baseY = options.baseY ?? -levelH;
  const uvScaleOf = options.uvScaleOf ?? (() => 1);

  const build = new MeshBuilder();
  const cellStart = new Int32Array(grid.cols * grid.rows * 2);

  for (let gy = 0; gy < grid.rows; gy += 1) {
    for (let gx = 0; gx < grid.cols; gx += 1) {
      const slot = (gy * grid.cols + gx) * 2;
      cellStart[slot] = build.vertexCount;

      const kind = kindAt(grid, gx, gy);
      if (kind !== EMPTY) {
        const mask = cellMask(grid, gx, gy);
        if (mask) {
          emitCell(build, grid, gx, gy, kind, mask, rim, levelH, baseY, uvScaleOf(kind));
        }
      }

      cellStart[slot + 1] = build.vertexCount - cellStart[slot];
    }
  }

  return { solid: build.finish(), cellStart };
}

function emitCell(
  build: MeshBuilder,
  grid: TerrainGrid,
  gx: number,
  gy: number,
  kind: number,
  mask: CellMask,
  rim: readonly RimRing[],
  levelH: number,
  baseY: number,
  uvScale: number,
): void {
  const surface = `surface:${kind}`;
  const cliff = `cliff:${kind}`;
  const scale = uvScale > 0 ? uvScale : 1;

  // The only way a height is obtained anywhere in this file. A tile is flat now
  // that ramps are gone, so this is one lookup and the rim is all the shaping.
  const top = (levelAt(grid, gx, gy) ?? 0) * levelH;

  const point = (x: Tick, z: Tick): Vec3 => ({
    x: x.at,
    y: top - dropAt(mask, rim, x, z),
    z: z.at,
  });

  const topUv = (p: Vec3): [number, number] => [p.x / scale, p.z / scale];

  // --- the top shell ------------------------------------------------------
  emitTopShell(build, surface, point, topUv, mask.flat ? null : rim, gx, gy);

  // --- the cliffs ---------------------------------------------------------
  // Only exposed sides get one. A broken corner with no exposed side beside it
  // is a concave corner: the surface dips into it and the neighbours that ARE
  // exposed there bring the wall, so adding one here would double it.
  if (!mask.sides) return;

  const xs = axisTicks(gx, rim, WEST, EAST);
  const zs = axisTicks(gy, rim, NORTH, SOUTH);

  for (let side = 0; side < 4; side += 1) {
    if (!(mask.sides & (1 << side))) continue;
    // Walked so that the quad's own winding faces outward; see the emitter.
    const along = side === EAST || side === WEST ? zs : xs;
    const forward = side === EAST || side === NORTH;
    const edge = side === EAST ? xs[xs.length - 1] : side === WEST ? xs[0] : side === SOUTH ? zs[zs.length - 1] : zs[0];

    for (let i = 0; i < along.length - 1; i += 1) {
      const a = forward ? along[i] : along[along.length - 1 - i];
      const b = forward ? along[i + 1] : along[along.length - 2 - i];
      const pa = side === EAST || side === WEST ? point(edge, a) : point(a, edge);
      const pb = side === EAST || side === WEST ? point(edge, b) : point(b, edge);

      // Every cliff hangs to the same floor rather than stopping at whatever
      // is below it. Stopping short is where corner cracks come from: two
      // perpendicular walls meeting at a convex corner would need the same
      // bottom, and their neighbours are different cells at different heights.
      // The surplus is buried under the terrain beside it and costs no extra
      // triangles, only length.
      const bottom = baseY;
      // Along the wall, then down it. The axis switches at a convex corner,
      // which for rock reads as a corner rather than as a seam.
      const alongA = (side === EAST || side === WEST ? pa.z : pa.x) / scale;
      const alongB = (side === EAST || side === WEST ? pb.z : pb.x) / scale;

      build.quad(
        cliff,
        [
          { x: pa.x, y: pa.y, z: pa.z },
          { x: pb.x, y: pb.y, z: pb.z },
          { x: pb.x, y: bottom, z: pb.z },
          { x: pa.x, y: bottom, z: pa.z },
        ],
        [
          [alongA, -pa.y / scale],
          [alongB, -pb.y / scale],
          [alongB, -bottom / scale],
          [alongA, -bottom / scale],
        ],
      );
    }
  }
}

/**
 * A cell's walkable top, as quads on the shared lattice.
 *
 * `rim` is null for a cell with nothing to shape, which is most of a real map
 * and emits a single quad.
 */
function emitTopShell(
  build: MeshBuilder,
  material: string,
  point: (x: Tick, z: Tick) => Vec3,
  uv: (p: Vec3) => [number, number],
  rim: readonly RimRing[] | null,
  gx: number,
  gy: number,
): void {
  if (!rim) {
    const xs: Tick[] = [
      { at: gx, side: WEST, ring: 0 },
      { at: gx + 1, side: EAST, ring: 0 },
    ];
    const zs: Tick[] = [
      { at: gy, side: NORTH, ring: 0 },
      { at: gy + 1, side: SOUTH, ring: 0 },
    ];
    emitTopQuad(build, material, point, uv, xs[0], xs[1], zs[0], zs[1]);
    return;
  }

  const xs = axisTicks(gx, rim, WEST, EAST);
  const zs = axisTicks(gy, rim, NORTH, SOUTH);
  for (let i = 0; i < xs.length - 1; i += 1) {
    for (let j = 0; j < zs.length - 1; j += 1) {
      emitTopQuad(build, material, point, uv, xs[i], xs[i + 1], zs[j], zs[j + 1]);
    }
  }
}

function emitTopQuad(
  build: MeshBuilder,
  material: string,
  point: (x: Tick, z: Tick) => Vec3,
  uv: (p: Vec3) => [number, number],
  x0: Tick,
  x1: Tick,
  z0: Tick,
  z1: Tick,
): void {
  // Ordered so the face normal comes out +Y in a right-handed scene: increasing
  // z first, then x. Derived once, asserted by test, never guessed at again.
  const p0 = point(x0, z0);
  const p1 = point(x0, z1);
  const p2 = point(x1, z1);
  const p3 = point(x1, z0);
  const corners: [Vec3, Vec3, Vec3, Vec3] = [p0, p1, p2, p3];
  const uvs: [number, number][] = [uv(p0), uv(p1), uv(p2), uv(p3)];
  build.quad(material, corners, uvs);
}

/** Cells with terrain, as a count. Used by validation and by tests. */
export function occupiedCells(grid: TerrainGrid): number {
  let count = 0;
  for (let gy = 0; gy < grid.rows; gy += 1) {
    for (let gx = 0; gx < grid.cols; gx += 1) if (levelAt(grid, gx, gy) !== null) count += 1;
  }
  return count;
}

export { SIDES };
