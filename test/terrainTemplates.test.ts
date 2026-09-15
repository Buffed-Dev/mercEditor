import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTemplates,
  templatesHeld,
  shapeOf,
  turnMask,
  CANONICAL,
  type Shape,
} from '../Engine/src/data/terrain/templates.ts';
import { topologyOf, cornerFxyAt } from '../Engine/src/data/terrain/mask.ts';
import { normalizeRim, rimOf, rimDrop, DEFAULT_RIM } from '../Engine/src/data/terrain/profile.ts';
import type { TerrainMeshData } from '../Engine/src/data/terrain/geometry.ts';
import { gridOf } from './helpers/terrainFixtures.ts';

/**
 * The block templates: the fold from sixteen side arrangements onto six shapes,
 * the meshes baked for each, and the two properties that make separate blocks
 * add up to one continuous surface.
 *
 * The fold is worth pinning because everything downstream — which mesh a tile
 * draws, which material a turned tile is painted with — is derived from it, and
 * it is exactly the kind of table that can be wrong in a way nothing notices
 * until a corner points the wrong way on a map.
 */

const LEVEL_H = 0.5;
const RIM = normalizeRim(DEFAULT_RIM);

/**
 * Every topology a real grid can produce.
 *
 * Corners are not free: corner k lies between sides k and k+1, so either of
 * those being exposed forces it broken, and only a corner with both its sides
 * covered can go either way. Forty-seven of the two hundred and fifty-six bit
 * patterns are reachable; the rest describe neighbourhoods that cannot exist.
 */
function reachable(): number[] {
  const out: number[] = [];
  for (let sides = 0; sides < 16; sides += 1) {
    const free = [0, 1, 2, 3].filter(
      (k) => !(sides & (1 << k)) && !(sides & (1 << ((k + 1) % 4))),
    );
    const forced = [0, 1, 2, 3]
      .filter((k) => sides & (1 << k) || sides & (1 << ((k + 1) % 4)))
      .reduce((bits, k) => bits | (1 << (k + 4)), 0);
    for (let pick = 0; pick < 1 << free.length; pick += 1) {
      let corners = forced;
      free.forEach((k, at) => {
        if (pick & (1 << at)) corners |= 1 << (k + 4);
      });
      out.push(sides | corners);
    }
  }
  return out;
}

// --- the fold --------------------------------------------------------------

test('every arrangement of sides is one of the six shapes, turned', () => {
  for (let sides = 0; sides < 16; sides += 1) {
    const { shape, rot } = shapeOf(sides);
    assert.equal(
      turnMask(CANONICAL[shape], rot),
      sides,
      `sides ${sides.toString(2).padStart(4, '0')} say ${shape} turned ${rot}, which is not it`,
    );
  }
});

test('the six shapes cover the sixteen arrangements exactly once each', () => {
  const seen: Record<Shape, number> = {
    middle: 0,
    side: 0,
    corner: 0,
    corridor: 0,
    cap: 0,
    single: 0,
  };
  for (let sides = 0; sides < 16; sides += 1) seen[shapeOf(sides).shape] += 1;

  // A shape's count is how many distinct turns it has: a corridor looks the
  // same after a half turn and a middle after any turn at all.
  assert.deepEqual(seen, { middle: 1, side: 4, corner: 4, corridor: 2, cap: 4, single: 1 });
});

test('forty-seven topologies are reachable, and no corner is free of its sides', () => {
  const all = reachable();
  assert.equal(all.length, 47);
  assert.equal(new Set(all).size, 47, 'and none of them is listed twice');

  for (const topology of all) {
    for (let k = 0; k < 4; k += 1) {
      if (!(topology & (1 << k)) && !(topology & (1 << ((k + 1) % 4)))) continue;
      assert.ok(topology & (1 << (k + 4)), `corner ${k} must break beside an exposed side`);
    }
  }
});

// --- the bake --------------------------------------------------------------

const points = (data: TerrainMeshData): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let v = 0; v < data.positions.length; v += 3) {
    out.push([data.positions[v]!, data.positions[v + 1]!, data.positions[v + 2]!]);
  }
  return out;
};

/** A quarter turn, east toward north — the same sense `turnMask` shifts bits. */
const turnPoint = ([x, y, z]: [number, number, number]): [number, number, number] => [z, y, -x];

/**
 * The distinct points of a template, sorted.
 *
 * Distinct rather than every vertex: a zero-area triangle is dropped by the
 * emitter, and which of the several that meet at a rim corner comes out
 * degenerate depends on the order the floats happen to fall in — so two turns
 * of the same shape can carry a different number of copies of the same corner
 * while describing exactly the same solid.
 */
const cloud = (list: [number, number, number][]): string =>
  [...new Set(list.map(([x, y, z]) => `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`))]
    .sort()
    .join(' ');

test('a turned template is the unturned one, turned', () => {
  const templates = buildTemplates(RIM, LEVEL_H);

  for (const topology of reachable()) {
    const { rot } = shapeOf(topology);
    // Turning it back the other way gives the arrangement it is a turn of.
    const flat = turnMask(topology, 4 - rot);

    let lid = points(templates.top(flat));
    for (let i = 0; i < rot; i += 1) lid = lid.map(turnPoint);
    assert.equal(
      cloud(lid),
      cloud(points(templates.top(topology))),
      `top ${topology.toString(2).padStart(8, '0')}: baking it, and turning its ` +
        `unturned form ${rot} quarters, disagree`,
    );

    let walls = points(templates.sub(flat & 0b1111));
    for (let i = 0; i < rot; i += 1) walls = walls.map(turnPoint);
    assert.equal(
      cloud(walls),
      cloud(points(templates.sub(topology & 0b1111))),
      `sub ${topology}`,
    );
  }
});

test('a template is one cell wide, with its top at zero and its wall hanging past it', () => {
  const templates = buildTemplates(RIM, LEVEL_H);
  // One level, plus the depth a neighbour's rim dips by where the two of them meet.
  const reach = LEVEL_H + rimDrop(RIM);

  for (const topology of reachable()) {
    for (const data of [templates.top(topology), templates.sub(topology & 0b1111)]) {
      for (const [x, y, z] of points(data)) {
        assert.ok(Math.abs(x) <= 0.5 + 1e-6, `${topology}: x ${x} leaves the cell`);
        assert.ok(Math.abs(z) <= 0.5 + 1e-6, `${topology}: z ${z} leaves the cell`);
        // Instances are placed by translation alone, so a block that reached
        // above its own face would stand through the one above it in a stack.
        assert.ok(y <= 1e-6, `${topology}: y ${y} is above the walkable face`);
        assert.ok(y >= -reach - 0.01, `${topology}: y ${y} hangs further than it should`);
      }
    }
  }
});

test('a block with nothing exposed has a lid and no walls', () => {
  const templates = buildTemplates(RIM, LEVEL_H);

  // The middle of a plateau: one flat quad on top, nothing down the sides,
  // because every one of them is against a neighbour standing at its level.
  assert.equal(templates.top(0).indices.length, 6, 'two triangles, and no wall');
  for (const [, y] of points(templates.top(0))) assert.equal(y, 0, 'all of it is the lid');

  // And a stack block there is nothing at all — which is what lets the renderer
  // stop descending a column the moment it meets one.
  assert.equal(templates.sub(0).indices.length, 0);
});

test('a stack block is one square plane per exposed side, and no more', () => {
  const templates = buildTemplates(RIM, LEVEL_H);
  const quads = (data: TerrainMeshData) => data.indices.length / 6;

  for (let sides = 0; sides < 16; sides += 1) {
    const walls = [0, 1, 2, 3].filter((k) => sides & (1 << k)).length;
    assert.equal(
      quads(templates.sub(sides)),
      walls,
      `sides ${sides.toString(2).padStart(4, '0')}: ${walls} walls`,
    );
  }
});

test('a stack block is square to the corner, so a column does not neck in', () => {
  // The mushroom. A vertical chamfer on the blocks under the cap narrowed the
  // column below the lid standing on it — and in an isometric view a box's
  // corners are its silhouette, so a corner cut read as the whole column
  // shrinking. The cap cannot be chamfered to match, so nothing is.
  const templates = buildTemplates(RIM, LEVEL_H);

  for (const sides of [0b1111, 0b0011, 0b0001]) {
    for (const [x, , z] of points(templates.sub(sides))) {
      const onEdge = Math.abs(Math.abs(x) - 0.5) < 1e-6 || Math.abs(Math.abs(z) - 0.5) < 1e-6;
      assert.ok(onEdge, `sides ${sides}: a wall corner at ${x},${z} is cut back`);
    }
  }

  // And it reaches the full width of the cell in both directions.
  const wide = points(templates.sub(0b1111));
  assert.equal(Math.max(...wide.map(([x]) => x)), 0.5);
  assert.equal(Math.min(...wide.map(([x]) => x)), -0.5);
  assert.equal(Math.max(...wide.map(([, , z]) => z)), 0.5);
  assert.equal(Math.min(...wide.map(([, , z]) => z)), -0.5);
});

test('a stack block starts where the block above it stops', () => {
  // Not at its own top face: the block above hangs a rim-depth past its level,
  // so starting level with it would leave two coplanar walls fighting over the
  // same band of pixels round every column.
  const templates = buildTemplates(RIM, LEVEL_H);
  const highest = Math.max(...points(templates.sub(0b1111)).map(([, y]) => y));
  assert.ok(
    Math.abs(highest + rimDrop(RIM)) < 1e-6,
    `a stack block's wall starts at ${highest}, not at ${-rimDrop(RIM)}`,
  );
});

test('only a cliff foot requested against lower terrain gets the bottom bevel', () => {
  const templates = buildTemplates(RIM, LEVEL_H);
  const plain = templates.sub(0b0001);
  const softened = templates.sub(0b0001, 0b0001);

  assert.ok(softened.indices.length > plain.indices.length, 'the foot adds its rounded strips');
  assert.ok(
    Math.max(...points(softened).map(([x]) => x)) > 0.5,
    'the east foot rolls visibly out over the lower neighbour',
  );
  assert.equal(
    templates.sub(0b0001, 0),
    plain,
    'a wall with no lower terrain at its foot keeps the original square ending',
  );
});

test('two bottom bevels meeting at a corner grow a rounded corner patch', () => {
  const templates = buildTemplates(RIM, LEVEL_H);
  const joined = points(templates.sub(0b0011, 0b0011));
  assert.ok(
    joined.some(([x, , z]) => x > 0.5 && z < -0.5),
    'the north-east gap is filled between the east and north rolls',
  );
});

test('the same profile is baked once and kept', () => {
  assert.equal(buildTemplates(RIM, LEVEL_H), buildTemplates(RIM, LEVEL_H));
  // A different profile is a different set, or the rim sliders would do nothing.
  assert.notEqual(buildTemplates(normalizeRim(rimOf(0.3, 0.02)), LEVEL_H), buildTemplates(RIM, LEVEL_H));
});

// --- the two properties that make separate blocks one surface ---------------

test('a wall reaches the foot of the cliff it stands in, and leaves no gap', () => {
  // A wall that stopped at its own level left a slot of background along the
  // foot of every cliff, because the ground it was supposed to meet had already
  // rolled its own edge down out of reach.
  for (const [width, depth] of [[0.12, 0.14], [0.02, 0], [0.45, 0.4]] as const) {
    const rim = normalizeRim(rimOf(width, depth));
    const templates = buildTemplates(rim, LEVEL_H);
    const want = -(LEVEL_H + rimDrop(rim));
    const lowest = (data: TerrainMeshData) => Math.min(...points(data).map(([, y]) => y));

    // A block with all four sides open, so every wall it has is in the answer.
    assert.ok(
      lowest(templates.top(0xff)) <= want,
      `rim ${width}/${depth}: the lid's wall stops at ${lowest(templates.top(0xff))}, short of ${want}`,
    );
    assert.ok(
      lowest(templates.sub(0b1111)) <= want,
      `rim ${width}/${depth}: a stack block's wall stops short too`,
    );
  }
});

/** How high the template's own lid is at its corner k. */
function cornerHeight(data: TerrainMeshData, k: number): number {
  const [fx, fy] = cornerFxyAt(k);
  const there = points(data).filter(
    ([x, , z]) => Math.abs(x - (fx - 0.5)) < 1e-6 && Math.abs(z - (fy - 0.5)) < 1e-6,
  );
  assert.ok(there.length, `no vertex at corner ${k}`);
  // The lid there, not the bottom of the wall hanging beneath it.
  return Math.max(...there.map(([, y]) => y));
}

test('tiles meeting at a point all put the ground at the same height', () => {
  // The shared-corner invariant, and the reason the corner bits read diagonals.
  // Without them the two tiles along the edge of an L rolled their rim down at
  // the inside corner while the tile in the crook stayed flat, and the
  // disagreement showed as a notch cut out of the ground exactly where the
  // cliff turned.
  const templates = buildTemplates(RIM, LEVEL_H);
  const shapes = [
    ['111', '111', '11-'], // an L, with its inside corner in the middle
    ['1-1', '111', '1-1'], // a plus
    ['111', '1-1', '111'], // a donut
    ['212', '121', '212'], // a chequerboard of heights
    ['-1-', '111', '-1-'],
  ];

  for (const rows of shapes) {
    const grid = gridOf(rows);
    /** Every height claimed at a shared lattice point, and by whom. */
    const claims = new Map<string, { at: string; y: number }[]>();

    for (let gy = 0; gy < grid.rows; gy += 1) {
      for (let gx = 0; gx < grid.cols; gx += 1) {
        const topology = topologyOf(grid, gx, gy);
        if (topology === null) continue;
        const lid = templates.top(topology);
        const level = grid.level[gy * grid.cols + gx]!;

        for (let k = 0; k < 4; k += 1) {
          const [fx, fy] = cornerFxyAt(k);
          const point = `${gx + fx},${gy + fy}`;
          const y = level * LEVEL_H + cornerHeight(lid, k);
          claims.set(point, [...(claims.get(point) ?? []), { at: `${gx},${gy}`, y }]);
        }
      }
    }

    for (const [point, made] of claims) {
      // Tiles at different levels are meant to disagree — that is a cliff, and
      // it is drawn as one. Only tiles standing at the same height share a
      // surface there at all.
      if (new Set(made.map(({ y }) => Math.round(y / LEVEL_H))).size > 1) continue;

      const heights = new Set(made.map(({ y }) => y.toFixed(6)));
      assert.equal(
        heights.size,
        1,
        `${rows.join('/')} at ${point}: ${made
          .map(({ at, y }) => `${at} says ${y.toFixed(4)}`)
          .join(', ')}`,
      );
    }
  }
});

test('the template cache is bounded, and keeps the profile in use', () => {
  // The rim comes off two sliders, so dragging one walks this key through every
  // step it has. Unbounded, that was a couple of hundred KiB of typed arrays
  // left behind per frame of the drag — 3.4 MiB for three seconds of it.
  const rimAt = (width: number) => rimOf(width, 0.12);

  for (let i = 0; i < 50; i += 1) buildTemplates(rimAt(0.2 + i * 0.001), LEVEL_H);
  assert.ok(templatesHeld() <= 8, `holding ${templatesHeld()} profiles after 50 of them`);

  // And the one being dragged is the one kept: asking again gives back the same
  // templates rather than baking them a second time.
  const rim = rimAt(0.31);
  const first = buildTemplates(rim, LEVEL_H);
  for (let i = 0; i < 7; i += 1) buildTemplates(rimAt(0.4 + i * 0.001), LEVEL_H);
  assert.equal(buildTemplates(rim, LEVEL_H), first, 'the profile still in use was evicted');

  // A ninth profile past it does evict, so the bound is real.
  buildTemplates(rimAt(0.45), LEVEL_H);
  buildTemplates(rimAt(0.44), LEVEL_H);
  assert.ok(templatesHeld() <= 8);
});
