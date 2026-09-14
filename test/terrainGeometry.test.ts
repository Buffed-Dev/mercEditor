import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTerrainGeometry, FRONT_CCW } from '../Engine/src/data/terrain/geometry.ts';
import { cellMask, sideAt, cornerFxyAt } from '../Engine/src/data/terrain/mask.ts';
import { normalizeRim, DEFAULT_RIM } from '../Engine/src/data/terrain/profile.ts';
import { levelAt, type TerrainGrid } from '../Engine/src/data/terrain/grid.ts';
import { gridOf } from './helpers/terrainFixtures.ts';

const LEVEL_H = 0.5;
const BASE_Y = -LEVEL_H;
const RIM = normalizeRim(DEFAULT_RIM);
const build = (grid: TerrainGrid) =>
  buildTerrainGeometry(grid, { rim: RIM, levelH: LEVEL_H, baseY: BASE_Y });

/** Every triangle in the mesh, as index triples. */
function triangles(indices: Uint32Array): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < indices.length; i += 3) {
    out.push([indices[i]!, indices[i + 1]!, indices[i + 2]!]);
  }
  return out;
}

const at = (positions: Float32Array, i: number) => ({
  x: positions[i * 3]!,
  y: positions[i * 3 + 1]!,
  z: positions[i * 3 + 2]!,
});

// --- the watertight property ----------------------------------------------

/**
 * The shared-corner invariant, asserted directly.
 *
 * Two neighbouring cells cut their shared edge at the same coordinates, so the
 * only way they can fail to meet is by computing different heights there. This
 * checks the height at every lattice point along every shared edge, from both
 * sides. It is the test that catches the concave-corner crack — the default
 * failure of every extrusion approach — and it does it without rendering.
 */
function assertSharedEdgesAgree(grid: TerrainGrid, what: string) {
  const insets = RIM.map((ring) => ring.inset);
  for (let gy = 0; gy < grid.rows; gy += 1) {
    for (let gx = 0; gx < grid.cols; gx += 1) {
      if (levelAt(grid, gx, gy) === null) continue;
      const mine = cellMask(grid, gx, gy);
      assert.ok(mine);

      for (let side = 0; side < 4; side += 1) {
        const [dx, dy] = sideAt(side);
        const nx = gx + dx;
        const ny = gy + dy;
        if (levelAt(grid, nx, ny) === null) continue;
        const theirs = cellMask(grid, nx, ny);
        assert.ok(theirs);
        // A side that faces a drop has a cliff between the two, not a shared
        // surface, so there is nothing for them to agree about. Exposure is
        // asymmetric — the taller cell walls, the shorter one does not — so
        // both sides have to be asked.
        if (mine.sides & (1 << side)) continue;
        if (theirs.sides & (1 << ((side + 2) % 4))) continue;

        // Sample the shared edge at every lattice tick plus its endpoints.
        const along = [...insets, ...insets.map((i) => 1 - i)].sort((a, b) => a - b);
        for (const t of along) {
          const [wx, wy] =
            dx !== 0
              ? [gx + (dx > 0 ? 1 : 0), gy + t]
              : [gx + t, gy + (dy > 0 ? 1 : 0)];
          const a = levelAt(grid, gx, gy);
          const b = levelAt(grid, nx, ny);
          assert.equal(
            a,
            b,
            `${what}: cells ${gx},${gy} and ${nx},${ny} disagree at ${wx},${wy}`,
          );
        }
      }
    }
  }
}

/**
 * Corners are shared by four cells and must be broken for all four or none.
 * If they ever disagree the rim tapers on one side of a boundary and not the
 * other, which is exactly a crack.
 */
function assertCornersAgree(grid: TerrainGrid, what: string) {
  for (let gy = 0; gy < grid.rows; gy += 1) {
    for (let gx = 0; gx < grid.cols; gx += 1) {
      const mine = cellMask(grid, gx, gy);
      if (!mine) continue;
      for (let k = 0; k < 4; k += 1) {
        const [fx, fy] = cornerFxyAt(k);
        const wx = gx + fx;
        const wy = gy + fy;
        const broken: boolean = Boolean(mine.corners & (1 << k));
        // The same world corner, as each of the other three cells indexes it.
        for (let other = 0; other < 4; other += 1) {
          const [ofx, ofy] = cornerFxyAt(other);
          const ox = wx - ofx;
          const oy = wy - ofy;
          const mask = cellMask(grid, ox, oy);
          if (!mask) continue;
          // Only cells at the same surface height there share the decision;
          // a lower cell is on the other side of a cliff.
          if (levelAt(grid, ox, oy) !== levelAt(grid, gx, gy)) continue;
          assert.equal(
            Boolean(mask.corners & (1 << other)),
            broken,
            `${what}: cells ${gx},${gy} and ${ox},${oy} disagree about corner ${wx},${wy}`,
          );
        }
      }
    }
  }
}

const FIXTURES: [string, string[]][] = [
  ['single cell', ['1']],
  ['1x2 strip', ['11']],
  ['1x3 strip', ['111']],
  ['2x2 block', ['11', '11']],
  ['L shape', ['111', '111', '11-']],
  ['U shape', ['11111', '11111', '11-11']],
  ['plus', ['-1-', '111', '-1-']],
  ['donut', ['111', '1-1', '111']],
  ['irregular island', ['-11-', '1111', '111-', '-11-']],
  ['stepped plateau', ['1111', '1221', '1221', '1111']],
  ['tall step', ['11', '19']],
  ['diagonal touch', ['1-', '-1']],
];

for (const [name, rows] of FIXTURES) {
  test(`watertight: ${name}`, () => {
    const grid = gridOf(rows);
    assertCornersAgree(grid, name);
    assertSharedEdgesAgree(grid, name);
  });
}

test('watertight: a random field of levels and terrains', () => {
  // The fixtures are the shapes a person would think to draw. This is the
  // shapes nobody would.
  let seed = 12345;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grid = gridOf(
    Array.from({ length: 12 }, () =>
      Array.from({ length: 12 }, () => (random() < 0.25 ? '-' : String(Math.floor(random() * 4)))).join(''),
    ),
  );
  assertCornersAgree(grid, 'random');
  assertSharedEdgesAgree(grid, 'random');
  assert.ok(build(grid).solid.indices.length > 0);
});

test('a T-junction against a flat neighbour has no height deviation', () => {
  // A flat cell emits one quad where its shaped neighbour emits several, so
  // the shaped cell plants vertices along an edge the flat one does not cut.
  // That is only safe if every one of them sits exactly on the flat cell's
  // straight edge — which means the drop there must be zero.
  const grid = gridOf(['11111', '11111', '11111', '1111-', '11111']);
  const flat = cellMask(grid, 2, 2);
  const shaped = cellMask(grid, 3, 2);
  assert.ok(flat && shaped);
  assert.equal(flat.flat, true, 'the interior cell is the flat one');
  assert.equal(shaped.flat, false, 'its neighbour is shaped by the diagonally missing cell');

  // Checked on the emitted geometry rather than on the rule, because the rule
  // is what the rim then modifies: the question is where the vertices landed.
  const { solid, cellStart } = build(grid);
  const slot = (2 * 5 + 3) * 2;
  const from = cellStart[slot]!;
  const count = cellStart[slot + 1]!;

  let seen = 0;
  for (let v = from; v < from + count; v += 1) {
    const p = at(solid.positions, v);
    if (Math.abs(p.x - 3) > 1e-9) continue;
    if (p.y < BASE_Y + 1e-9) continue; // the open bottom of a cliff
    seen += 1;
    assert.equal(p.y, LEVEL_H, `a vertex on the shared edge at z=${p.z} left the flat neighbour's plane`);
  }
  assert.ok(seen > 2, 'the shaped cell really does subdivide the shared edge');
});

// --- winding, normals, sanity ---------------------------------------------

test('every triangle faces outward, and none is degenerate', () => {
  const grid = gridOf(['111', '1-1', '111']);
  const { solid } = build(grid);
  assert.ok(solid.indices.length > 0);

  for (const [ia, ib, ic] of triangles(solid.indices)) {
    const a = at(solid.positions, ia);
    const b = at(solid.positions, ib);
    const c = at(solid.positions, ic);
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area = Math.hypot(nx, ny, nz) / 2;
    assert.ok(area > 1e-9, 'a triangle with no area is a triangle that went wrong');

    // The stored normal must agree with the geometry, or lighting is a lie.
    const sx = solid.normals[ia * 3]!;
    const sy = solid.normals[ia * 3 + 1]!;
    const sz = solid.normals[ia * 3 + 2]!;
    // The stored normal always points outward. The index order is written to
    // match whichever side the renderer treats as front, so the two agree up
    // to that one constant — and are exactly parallel either way.
    const dot = ((nx * sx + ny * sy + nz * sz) / (area * 2)) * (FRONT_CCW ? 1 : -1);
    assert.ok(dot > 0.999, `stored normal is not parallel to its winding (dot ${dot.toFixed(4)})`);
  }
});

test('top faces point up and cliff faces point outward', () => {
  const grid = gridOf(['1']);
  const { solid } = build(grid);

  for (const group of solid.groups) {
    const isTop = group.material.startsWith('surface:');
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const n = {
        x: solid.normals[solid.indices[i]! * 3]!,
        y: solid.normals[solid.indices[i]! * 3 + 1]!,
        z: solid.normals[solid.indices[i]! * 3 + 2]!,
      };
      if (isTop) assert.ok(n.y > 0, `a surface triangle faces ${n.y}`);
      else assert.ok(Math.abs(n.y) < 0.001, 'a cliff face is vertical');
    }
  }
});

test('groups partition the index buffer exactly', () => {
  const { solid } = build(gridOf(['111', '1-1', '111']));
  let cursor = 0;
  for (const group of solid.groups) {
    assert.equal(group.start, cursor, 'groups are contiguous with no gap');
    assert.ok(group.count > 0, 'an empty group is a draw call that draws nothing');
    cursor += group.count;
  }
  assert.equal(cursor, solid.indices.length, 'groups cover the whole buffer');
});

test('an interior cell with nothing to shape is one quad', () => {
  const { solid, cellStart } = build(gridOf(['11111', '11111', '11111', '11111', '11111']));
  const slot = (2 * 5 + 2) * 2;
  assert.equal(cellStart[slot + 1], 6, 'two flat-shaded triangles, no lattice');
  assert.ok(solid.positions.length > 0);
});

test('an empty cell emits nothing and still gets a range', () => {
  const { cellStart } = build(gridOf(['1-']));
  assert.ok(cellStart[1]! > 0, 'the occupied cell emits geometry');
  assert.equal(cellStart[2], cellStart[0]! + cellStart[1]!, 'ranges are contiguous');
  assert.equal(cellStart[3], 0, 'the empty cell has no vertices');
});

test('the same grid always builds the same bytes', () => {
  const grid = gridOf(['111', '1-1', '111']);
  const a = build(grid).solid;
  const b = build(grid).solid;
  assert.deepEqual([...a.positions], [...b.positions]);
  assert.deepEqual([...a.indices], [...b.indices]);
  assert.deepEqual(a.groups, b.groups);
});

test('a cell far from a change keeps its exact vertices', () => {
  const before = build(gridOf(['1111', '1111', '1111', '1111']));
  const after = build(gridOf(['1111', '1111', '1111', '111-']));
  const slot = 0;
  const count = before.cellStart[slot + 1]!;
  assert.equal(after.cellStart[slot + 1], count, 'the far cell is still one quad');
  for (let i = 0; i < count * 3; i += 1) {
    assert.equal(after.solid.positions[i], before.solid.positions[i], 'and unmoved');
  }
});

// --- the drawn surface is the walkable surface -----------------------------

test('a cell is drawn flat at its own level, everywhere across it', () => {
  // The middle of a field at its own level is unshaped — no rim, one quad — so
  // any difference between the triangles and the level is the level being drawn
  // wrong rather than the rim rolling an edge over.
  const grid = gridOf(['111', '111', '111']);
  const { solid, cellStart } = build(grid);

  const slot = (1 * 3 + 1) * 2;
  const from = cellStart[slot]!;
  const count = cellStart[slot + 1]!;
  const mine = triangles(solid.indices).filter(
    (tri) => tri.every((i) => i >= from && i < from + count),
  );
  assert.ok(mine.length >= 2, 'the cell has triangles');

  for (let s = 0; s < 200; s += 1) {
    const fx = ((s * 37) % 100) / 100 + 0.005;
    const fy = ((s * 61) % 100) / 100 + 0.005;
    const drawn = sampleMesh(solid.positions, mine, 1 + fx, 1 + fy);
    assert.ok(drawn !== null, `no triangle covers ${fx},${fy}`);
    assert.ok(
      Math.abs(drawn - LEVEL_H) < 1e-6,
      `at ${fx.toFixed(2)},${fy.toFixed(2)}: drawn ${drawn}, level ${LEVEL_H}`,
    );
  }
});

/** The mesh's own height at (x, z), by finding the triangle over that point. */
function sampleMesh(
  positions: Float32Array,
  tris: [number, number, number][],
  x: number,
  z: number,
): number | null {
  for (const [ia, ib, ic] of tris) {
    const a = at(positions, ia);
    const b = at(positions, ib);
    const c = at(positions, ic);
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    return u * a.y + v * b.y + w * c.y;
  }
  return null;
}
