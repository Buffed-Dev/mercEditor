import test from 'node:test';
import assert from 'node:assert/strict';
import { cellMask, topologyOf, sidesOf, subSides } from '../Engine/src/data/terrain/mask.ts';
import { shapeOf } from '../Engine/src/data/terrain/templates.ts';
import { gridOf, bits } from './helpers/terrainFixtures.ts';

/** Sides and corners are bit k = side/corner k, clockwise from +x: E, N, W, S. */
const E = 1 << 0;
const N = 1 << 1;
const W = 1 << 2;
const S = 1 << 3;
/** Corner k sits between side k and k+1: NE, NW, SW, SE. */
const NE = 1 << 0;
const NW = 1 << 1;
const SW = 1 << 2;
const SE = 1 << 3;

const maskAt = (rows: string[], gx: number, gy: number) => {
  const mask = cellMask(gridOf(rows), gx, gy);
  assert.ok(mask, `expected a cell at ${gx},${gy}`);
  return mask;
};

const same = (actual: number, expected: number, what: string) =>
  assert.equal(bits(actual), bits(expected), what);

test('a single cell is exposed on every side and every corner', () => {
  const mask = maskAt(['1'], 0, 0);
  same(mask.sides, E | N | W | S, 'sides');
  same(mask.corners, NE | NW | SW | SE, 'corners');
  assert.equal(mask.flat, false);
});

test('a 1x2 strip: each end keeps three open sides and all four corners', () => {
  const mask = maskAt(['11'], 0, 0);
  same(mask.sides, N | W | S, 'sides');
  same(mask.corners, NE | NW | SW | SE, 'corners');
});

test('the middle of a 1x3 strip is open north and south', () => {
  // The one-cell-wide strip the old two-edge autotiler could not express at
  // all: it has neighbours on the axis the camera cannot see, and nothing on
  // the axis it can.
  const mask = maskAt(['111'], 1, 0);
  same(mask.sides, N | S, 'sides');
  same(mask.corners, NE | NW | SW | SE, 'corners');
});

test('a 2x2 block: the inner corner of each cell stays whole', () => {
  const rows = ['11', '11'];
  const nw = maskAt(rows, 0, 0);
  same(nw.sides, N | W, 'NW cell sides');
  same(nw.corners, NE | NW | SW, 'NW cell corners');
  assert.equal(nw.corners & SE, 0, 'the NW cell\'s inward corner is not broken');

  const ne = maskAt(rows, 1, 0);
  assert.equal(ne.corners & SW, 0, 'the NE cell\'s inward corner is not broken');
});

test('an L shape produces a concave corner: no open side, one broken corner', () => {
  // This is the case naive extrusion cracks on. The centre cell has terrain on
  // all four sides, so nothing about its edges says anything is missing — only
  // the diagonal does.
  const mask = maskAt(['111', '111', '11-'], 1, 1);
  same(mask.sides, 0, 'sides');
  same(mask.corners, SE, 'corners');
  assert.equal(mask.flat, false, 'a broken corner is not flat');
});

test('a U shape produces two concave corners, mirrored', () => {
  // Catches an off-by-one in the k / k+1 corner pairing, which a single
  // concave corner cannot: this one is only correct if both indices agree.
  const rows = ['11111', '11111', '11-11'];
  same(maskAt(rows, 1, 1).corners, SE, 'left inner cell');
  same(maskAt(rows, 3, 1).corners, SW, 'right inner cell');
  same(maskAt(rows, 1, 1).sides, 0, 'left inner cell has no open side');
  same(maskAt(rows, 3, 1).sides, 0, 'right inner cell has no open side');
});

test('a plus shape breaks all four corners of its centre and no side', () => {
  const mask = maskAt(['-1-', '111', '-1-'], 1, 1);
  same(mask.sides, 0, 'sides');
  same(mask.corners, NE | NW | SW | SE, 'corners');
});

test('a donut: the hole has no cell, and its rim faces inward', () => {
  const rows = ['111', '1-1', '111'];
  assert.equal(cellMask(gridOf(rows), 1, 1), null, 'the hole is not a cell');
  same(maskAt(rows, 1, 0).sides, N | S, 'top of the rim faces the hole and the outside');
  same(maskAt(rows, 0, 1).sides, E | W, 'left of the rim');
});

test('a terrain boundary inside one platform creates no exposed geometry', () => {
  // The whole point of the redesign, asserted directly. Same level throughout,
  // two different terrains; every interior cell must still be one flat quad.
  const rows = ['1111', '1111', '1111', '1111'];
  const kinds = ['aabb', 'aabb', 'aabb', 'aabb'];
  const grid = gridOf(rows, kinds);
  for (const [gx, gy] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    const mask = cellMask(grid, gx, gy);
    assert.ok(mask);
    assert.equal(mask.flat, true, `cell ${gx},${gy} straddles a material boundary and must stay flat`);
  }
});

test('a step exposes the taller cell, not the shorter one', () => {
  const rows = ['12'];
  assert.equal(maskAt(rows, 0, 0).sides & E, 0, 'the low cell does not face a drop to the east');
  assert.equal(maskAt(rows, 1, 0).sides & W, W, 'the high cell does');
});

// --- placement: the rule the renderer uses ---------------------------------

test('a side is exposed by a drop, and covered by anything at least as tall', () => {
  //  1 1 2
  //  1 - 1
  const grid = gridOf(['112', '1-1']);

  // The middle cell of the top row: the hole below it and the edge of the map
  // above it are drops and show. The taller neighbour to its east does not —
  // that cliff's own wall comes down across the edge and covers it, and a rim
  // rolled over there would cut a groove along the foot of the cliff.
  assert.equal(bits(sidesOf(topologyOf(grid, 1, 0)!)), '1010');
  assert.equal(topologyOf(grid, 1, 1), null, 'a hole has no topology at all');

  // A diagonal cannot change which sides show, and so cannot change which of
  // the six shapes a tile gets — only where that shape dimples.
  assert.equal(
    sidesOf(topologyOf(gridOf(['11', '1-']), 0, 0)!),
    sidesOf(topologyOf(gridOf(['11', '11']), 0, 0)!),
  );
});

test('a corner breaks for its diagonal, which is what keeps neighbours agreeing', () => {
  //  1 1 1
  //  1 1 1
  //  1 1 -
  // The middle tile has ground on both sides that touch its south-east corner,
  // but the cell diagonally across it is a hole — so the corner breaks and the
  // tile dimples there. The two tiles beside that hole roll their rim down at
  // the same point, and reading the diagonal is what makes all three agree.
  const corners = (t: number) => bits(t >> 4);
  const dimpled = topologyOf(gridOf(['111', '111', '11-']), 1, 1)!;
  assert.equal(bits(sidesOf(dimpled)), '0000', 'nothing is exposed: it is still a middle');
  assert.equal(corners(dimpled), '1000', 'and the SE corner alone breaks');
  assert.equal(corners(topologyOf(gridOf(['111', '111', '111']), 1, 1)!), '0000', 'nothing to break');

  // Whereas a corner beside an exposed side breaks whatever the diagonal does —
  // which is what stops the two rules ever contradicting each other.
  const open = topologyOf(gridOf(['111', '11-', '111']), 1, 1)!;
  assert.equal(bits(sidesOf(open)), '0001', 'east is open');
  assert.equal(corners(open), '1001', 'and both corners along it break');
});

test('a wall segment stops being drawn once it is buried', () => {
  //  3 1 -
  const grid = gridOf(['31-']);

  // The level-3 column at gx 0. Its east side is buried up to the top of the
  // level-1 neighbour beside it; its other three face open air all the way
  // down, so no segment is ever fully enclosed.
  assert.equal(bits(subSides(grid, 0, 0, 2)), '1111', 'above the neighbour, all four show');
  assert.equal(bits(subSides(grid, 0, 0, 1)), '1110', 'level with it, the east side goes');
  assert.equal(bits(subSides(grid, 0, 0, 0)), '1110');

  // The mask can only lose bits going down, which is what lets the renderer
  // stop at the first zero instead of walking every column to the floor.
  const walled = gridOf(['232', '333']);
  let last = 0b1111;
  for (let at = 1; at >= 0; at -= 1) {
    const mask = subSides(walled, 1, 0, at);
    assert.equal(mask & ~last, 0, `mask gained a bit at level ${at}`);
    last = mask;
  }
});

test('a raised column does not turn the tiles around it into corner pieces', () => {
  //  1 1 1 1 1
  //  1 1 1 1 1
  //  1 1 3 1 1     <- the shelf ends below this row
  //  - - - - -
  const grid = gridOf(['11111', '11111', '11311', '-----']);

  // The column itself stands clear of everything, so it is the single piece.
  assert.equal(shapeOf(topologyOf(grid, 2, 2)!).shape, 'single');

  // The tile beside it has one drop — the end of the shelf — and that is the
  // only edge it has. The column is taller, so its own wall covers the edge
  // they share; counting that as exposed made this a corner piece wrapped
  // around the column's foot, which is the bug.
  const beside = topologyOf(grid, 1, 2)!;
  assert.equal(bits(sidesOf(beside)), '1000', 'the shelf edge alone');
  assert.equal(shapeOf(beside).shape, 'side');

  // And the tile at the column's foot in the middle of the shelf has no edge
  // at all: nothing around it drops, so it is plain ground.
  assert.equal(topologyOf(grid, 2, 1), 0, 'flat, with no corner broken either');
});
