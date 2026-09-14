/**
 * The block meshes, baked.
 *
 * A tile is drawn as an instance of one of these rather than as its own
 * triangles. Each arrangement of exposed sides and broken corners gets its own
 * baked mesh, in two tiers:
 *
 *   top  the block a tile stands on — walkable lid, the rim rolling over every
 *        exposed edge, and the wall beneath it
 *   sub  a block below that in a stack — wall only, square at the top, with a
 *        chamfer down any corner where two exposed walls meet
 *
 * ## Walls hang past their own level
 *
 * By exactly the rim's depth, and it is not a fudge. A tile's neighbour rolls
 * its own edge over where the two of them meet, so its surface at that boundary
 * is a rim-depth *below* its top plane. A wall that stopped at its own level
 * would therefore stop a rim-depth short of the ground it is supposed to meet,
 * and every cliff on the map would show a slot of background along its foot.
 * The surplus is buried inside the block below and costs nothing but length —
 * the same trick the whole-map generator used when it hung every cliff to a
 * common floor.
 *
 * ## Baked on demand
 *
 * A top block is keyed by the full eight-bit topology — four sides and four
 * corners — because the corners are what make two neighbours agree along the
 * edge they share (see mask.ts). That is forty-seven reachable combinations
 * rather than sixteen, which is why they are baked lazily and kept: a real map
 * asks for a dozen and never builds the rest. A stack block is a wall and has
 * no lid to dimple, so it is keyed by its four sides alone.
 *
 * ## Why six shapes and not sixteen
 *
 * Six shapes and four turns is the same sixteen side arrangements: `shapeOf`
 * says which of middle, side, corner, corridor, cap and single a tile is, and
 * how far round it has been turned. But the *material* can differ per turn — a
 * texture with lines running across it needs a second texture with them running
 * down — so a turned block cannot share a draw call with an unturned one
 * anyway. Given that, applying the turn at draw time buys nothing, and baking
 * it in removes an entire class of bug: there is no rotation matrix, so there is
 * no rotation matrix to get backwards.
 *
 * The turn is still reported, because the material lookup needs it.
 *
 * ## How the top tier is baked
 *
 * By asking the existing generator. A three-by-three grid is filled so that the
 * cell in the middle has exactly the wanted exposure, `buildTerrainGeometry`
 * shapes it, and the middle cell's own vertices are lifted back out through the
 * `cellStart` table it already returns. No second implementation of the rim,
 * and so no second implementation to drift.
 *
 * A side neighbour is filled where that side is unexposed and a diagonal where
 * that corner is unbroken, which is exactly the neighbourhood `cellMask` reads
 * back out — so what is asked for is what is baked.
 */

import { createGrid, idx } from './grid.ts';
import { buildTerrainGeometry, MeshBuilder, type TerrainMeshData, type Vec3 } from './geometry.ts';
import { normalizeRim, rimDrop, DEFAULT_RIM, type RimRing } from './profile.ts';
import { sideAt, cornerAt, type Offset, type PerSide } from './mask.ts';

export type Shape = 'middle' | 'side' | 'corner' | 'corridor' | 'cap' | 'single';

/** The unturned mask of each shape. Bits are sides: E=0, N=1, W=2, S=3. */
export const CANONICAL: Record<Shape, number> = {
  middle: 0b0000,
  side: 0b0001,
  corner: 0b0011,
  corridor: 0b0101,
  cap: 0b0111,
  single: 0b1111,
};

/** One quarter-turn of a four-bit ring of sides, or of corners. */
const turnNibble = (bits: number, r: number): number =>
  ((bits << r) | (bits >> (4 - r))) & 0b1111;

/**
 * One quarter-turn of a topology.
 *
 * Sides and corners turn together and by the same amount: corner k sits between
 * sides k and k+1, so a shape rotated a quarter turn takes its dimples with it.
 */
export const turnMask = (topology: number, turns: number): number => {
  const r = ((turns % 4) + 4) % 4;
  return turnNibble(topology & 0b1111, r) | (turnNibble(topology >> 4, r) << 4);
};

export type Turned = { shape: Shape; rot: 0 | 1 | 2 | 3 };

const SHAPE_OF: Turned[] = buildShapeTable();

function buildShapeTable(): Turned[] {
  const table = new Array<Turned | null>(16).fill(null);
  for (const shape of Object.keys(CANONICAL) as Shape[]) {
    for (let rot = 0; rot < 4; rot += 1) {
      const mask = turnMask(CANONICAL[shape], rot);
      // First writer wins, so `corridor` at half a turn stays the corridor it
      // already was and `single` never claims a mask a smaller shape covers.
      if (!table[mask]) table[mask] = { shape, rot: rot as 0 | 1 | 2 | 3 };
    }
  }
  return table.map((entry, mask) => {
    if (!entry) throw new Error(`no template covers side mask ${mask}`);
    return entry;
  });
}

/**
 * Which of the six shapes a topology is, and how far round it has been turned.
 *
 * Reads the side bits only. The corners say where the block dimples, which is a
 * question about the surface rather than about which mesh it is.
 */
export const shapeOf = (topology: number): Turned => SHAPE_OF[topology & 0b1111]!;

export type BlockTemplates = {
  /** The lid and its wall, for a full eight-bit topology. */
  top(topology: number): TerrainMeshData;
  /** A stack block's walls, for the four side bits. */
  sub(sides: number): TerrainMeshData;
};

const cache = new Map<string, BlockTemplates>();

/**
 * The block meshes for one edge profile, baked on demand and kept.
 *
 * Keyed by the profile because that is the only thing they depend on: dragging
 * the rim sliders is the one action that invalidates them, and it wants a fresh
 * set every frame of the drag.
 */
export function buildTemplates(
  rim: readonly RimRing[] = DEFAULT_RIM,
  levelH = 0.5,
): BlockTemplates {
  const rings = normalizeRim(rim);
  const key = `${levelH}|${rings.map((r) => `${r.inset},${r.drop}`).join(';')}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const tops = new Map<number, TerrainMeshData>();
  const subs = new Map<number, TerrainMeshData>();
  const built: BlockTemplates = {
    top(topology) {
      const at = topology & 0xff;
      let mesh = tops.get(at);
      if (!mesh) tops.set(at, (mesh = bakeTop(at, rings, levelH)));
      return mesh;
    },
    sub(sides) {
      const at = sides & 0b1111;
      let mesh = subs.get(at);
      if (!mesh) subs.set(at, (mesh = bakeSub(at, rings, levelH)));
      return mesh;
    },
  };
  cache.set(key, built);
  return built;
}

// --- the top tier ----------------------------------------------------------

/**
 * How far below its own top face a block's wall reaches.
 *
 * One level, plus the rim depth it has to bury itself in, plus a hair so that
 * two numbers arrived at by different arithmetic cannot leave a sub-pixel seam
 * between them.
 */
const wallBottom = (rim: readonly RimRing[], levelH: number): number =>
  levelH + rimDrop(rim) + 1e-3;

/**
 * The middle cell of a 3x3 arranged to have exactly this exposure, on its own.
 *
 * Recentred so the cell spans [-0.5, 0.5] on both axes and its walkable top is
 * y = 0, which is what lets an instance be placed with a translation and
 * nothing else.
 */
function bakeTop(topology: number, rim: RimRing[], levelH: number): TerrainMeshData {
  const grid = createGrid(3, 3);
  const fill = (gx: number, gy: number) => {
    grid.kind[idx(grid, gx, gy)] = 1;
    grid.level[idx(grid, gx, gy)] = 0;
  };
  fill(1, 1);

  // A neighbour stands wherever the topology says nothing is exposed, so what
  // `cellMask` reads back out of this grid is the topology that was asked for.
  for (let k = 0; k < 4; k += 1) {
    if (topology & (1 << k)) continue;
    const [dx, dy] = sideAt(k);
    fill(1 + dx, 1 + dy);
  }
  for (let k = 0; k < 4; k += 1) {
    if (topology & (1 << (k + 4))) continue;
    const [dx, dy] = cornerAt(k);
    fill(1 + dx, 1 + dy);
  }

  const { solid, cellStart } = buildTerrainGeometry(grid, {
    rim,
    levelH,
    baseY: -wallBottom(rim, levelH),
    // UV = metres. Instances share geometry, so a per-terrain scale cannot live
    // here; a material's own uScale/vScale is where that decision goes now.
    uvScaleOf: () => 1,
  });

  // The middle cell of a 3x3 grid, which `buildTerrainGeometry` always emits.
  const slot = (1 * 3 + 1) * 2;
  return sliceCell(solid, cellStart[slot]!, cellStart[slot + 1]!, -1.5);
}

/**
 * One cell's vertices, lifted out and recentred.
 *
 * Cells never share vertices, so a cell owns a contiguous run of the buffer and
 * every triangle of its groups points inside that run. Both facts are load
 * bearing; see the note on welding in geometry.ts.
 */
function sliceCell(
  data: TerrainMeshData,
  first: number,
  count: number,
  shift: number,
): TerrainMeshData {
  const positions = new Float32Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    positions[v * 3] = data.positions[(first + v) * 3]! + shift;
    positions[v * 3 + 1] = data.positions[(first + v) * 3 + 1]!;
    positions[v * 3 + 2] = data.positions[(first + v) * 3 + 2]! + shift;
  }

  const indices: number[] = [];
  for (const group of data.groups) {
    for (let i = group.start; i < group.start + group.count; i += 1) {
      const at = data.indices[i]!;
      if (at >= first && at < first + count) indices.push(at - first);
    }
  }

  return {
    positions,
    normals: data.normals.slice(first * 3, (first + count) * 3),
    uvs: data.uvs.slice(first * 2, (first + count) * 2),
    indices: new Uint32Array(indices),
    // One material for the whole block: the lid and the wall under it are the
    // same piece of art, which is the point of splitting top from sub.
    groups: [{ material: 'block', start: 0, count: indices.length }],
  };
}

// --- the sub tier ----------------------------------------------------------

/** Local coordinates of corner k, clockwise from north-east. */
const CORNER_XZ: PerSide<Offset> = [
  [0.5, -0.5], // 0 NE
  [-0.5, -0.5], // 1 NW
  [-0.5, 0.5], // 2 SW
  [0.5, 0.5], // 3 SE
];

/** Corner k's local coordinates, for any k: out of range wraps. */
const cornerXzAt = (k: number): Offset => CORNER_XZ[((k % 4) + 4) % 4]!;

/**
 * A stack block: a square plane on every exposed side, and nothing else.
 *
 * Not baked from the generator, because there is no lid here to shape — a block
 * below the top of a column is wall and only wall.
 *
 * **Its corners are square, and they have to be.** These once carried a
 * vertical chamfer, cut back by the rim's own width so that a stack would read
 * as one rolled object rather than as a bevelled lid sitting on square boxes.
 * It read as a mushroom instead. The block on top cannot have that chamfer —
 * its lid stands on that wall, and cutting the wall back would leave the lid
 * overhanging it — so chamfering only the blocks underneath narrows the column
 * below its own cap, and in an isometric view the corners *are* the silhouette,
 * which makes the difference far larger than the cut. Square all the way down
 * is the only footprint that matches what stands on it.
 *
 * The wall starts a rim-depth below its own top face rather than at it. The
 * block above hangs down by exactly that much (see `wallBottom`), so starting
 * level with it would leave two coplanar quads fighting over the same band of
 * pixels all the way round every column.
 */
function bakeSub(mask: number, rim: RimRing[], levelH: number): TerrainMeshData {
  const build = new MeshBuilder();
  const top = -rimDrop(rim);
  const bottom = -wallBottom(rim, levelH);

  for (let k = 0; k < 4; k += 1) {
    if (!(mask & (1 << k))) continue;
    // Side k runs from corner k to corner k-1, which is the winding that faces
    // its own normal outward.
    const a = cornerXzAt(k);
    const b = cornerXzAt(k + 3);
    // Across the wall in the plane it lies in, then down it. Using the local
    // coordinate rather than distance-from-the-end means two blocks side by
    // side carry the texture across the join.
    const across = (p: Offset) =>
      Math.abs(a[0] - b[0]) > Math.abs(a[1] - b[1]) ? p[0] + 0.5 : p[1] + 0.5;
    const at = (p: Offset, y: number): Vec3 => ({ x: p[0], y, z: p[1] });

    build.quad(
      'block',
      [at(a, top), at(b, top), at(b, bottom), at(a, bottom)],
      [
        [across(a), -top],
        [across(b), -top],
        [across(b), -bottom],
        [across(a), -bottom],
      ],
    );
  }

  return build.finish();
}
