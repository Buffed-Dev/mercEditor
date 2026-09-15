import test from 'node:test';
import assert from 'node:assert/strict';
import { cornerMesh, normalizeProfile, type EdgeProfile } from '../Engine/src/data/profiles.ts';
import { planSub, planTop, type ProfileOfEdge } from '../Engine/src/data/terrain/edges.ts';
import { createGrid, edgeOverride, edgeValueOf, idx, resizeGrid, cloneGrid } from '../Engine/src/data/terrain/grid.ts';
import { decodeTerrain, encodeTerrain } from '../Engine/src/data/terrain/codec.ts';
import { topologyOf } from '../Engine/src/data/terrain/mask.ts';
import { beginStroke } from '../Engine/editor/terrain/stroke.ts';

/**
 * Edge profiles: which pieces a tile's exposed edges and corners get, and how a
 * per-edge override is stored, saved and undone.
 */

const soft = normalizeProfile({ id: 'soft', edge: 'soft-edge', outerCorner: 'soft-outer', innerCorner: 'soft-inner', priority: 1 });
const cliff = normalizeProfile({
  id: 'cliff',
  edge: 'cliff-edge',
  outerCorner: 'cliff-outer',
  innerCorner: 'cliff-inner',
  priority: 5,
  transitions: [{ profile: 'soft', outerCorner: 'cliff-soft-outer' }],
});
const PROFILES = new Map<string, EdgeProfile>([
  ['soft', soft],
  ['cliff', cliff],
]);

/** A grid where every cell is terrain 1, filled from rows of '#' and '.'. */
function island(rows: string[]) {
  const grid = createGrid(rows[0]!.length, rows.length);
  rows.forEach((row, gy) => [...row].forEach((char, gx) => {
    if (char === '#') grid.kind[idx(grid, gx, gy)] = 1;
  }));
  return grid;
}

/** Overrides first, then the terrain's default — the renderer's rule. */
const lookup = (grid: ReturnType<typeof createGrid>, fallback: string): ProfileOfEdge => (gx, gy, side) => {
  if (gx < 0 || gy < 0 || gx >= grid.cols || gy >= grid.rows || !grid.kind[idx(grid, gx, gy)]) return null;
  return PROFILES.get(edgeOverride(grid, gx, gy, side) || fallback) ?? null;
};

test('corners: the same profile uses its own, the higher priority owns a mixed one, a transition wins', () => {
  assert.equal(cornerMesh(soft, soft, 'outerCorner'), 'soft-outer');
  assert.equal(cornerMesh(soft, cliff, 'innerCorner'), 'cliff-inner');
  assert.equal(cornerMesh(soft, cliff, 'outerCorner'), 'cliff-soft-outer');
  assert.equal(cornerMesh(cliff, soft, 'outerCorner'), 'cliff-soft-outer');
  assert.equal(cornerMesh(null, cliff, 'outerCorner'), '');
});

test('with no profile anywhere, the tile is the generated block', () => {
  const grid = island(['###', '###', '###']);
  const topology = topologyOf(grid, 0, 0)!;
  assert.deepEqual(planTop(0, 0, topology, () => null), { profiled: false, topology, pieces: [] });
});

test('a side tile is one whole edge piece, turned to face its exposed side', () => {
  const grid = island(['###', '###', '###']);
  // (2, 1): east exposed (side 0); (1, 0): north exposed (side 1).
  assert.deepEqual(planTop(2, 1, topologyOf(grid, 2, 1)!, lookup(grid, 'soft')).pieces, [{ mesh: 'soft-edge', rot: 0 }]);
  assert.deepEqual(planTop(1, 0, topologyOf(grid, 1, 0)!, lookup(grid, 'soft')).pieces, [{ mesh: 'soft-edge', rot: 1 }]);
});

test('a corner tile is one outer corner piece, turned to its two sides', () => {
  const grid = island(['###', '###', '###']);
  // (2, 0) north-east: turn 0. (0, 0) north-west: north + west, turn 1.
  assert.deepEqual(planTop(2, 0, topologyOf(grid, 2, 0)!, lookup(grid, 'soft')).pieces, [{ mesh: 'soft-outer', rot: 0 }]);
  assert.deepEqual(planTop(0, 0, topologyOf(grid, 0, 0)!, lookup(grid, 'soft')).pieces, [{ mesh: 'soft-outer', rot: 1 }]);
});

test('an overridden edge changes the corner piece through priority and transitions', () => {
  const grid = island(['###', '###', '###']);
  const stroke = beginStroke(grid);
  stroke.setEdge(idx(grid, 2, 0), 1, edgeValueOf(grid, 'cliff'));
  assert.deepEqual(planTop(2, 0, topologyOf(grid, 2, 0)!, lookup(grid, 'soft')).pieces, [{ mesh: 'cliff-soft-outer', rot: 0 }]);
  assert.equal(edgeOverride(grid, 1, 0, 1), '');
});

test('a concave corner is an inner corner piece, resolved from the neighbours', () => {
  // The north-east cell is missing, so the middle tile's corner 0 drops.
  const grid = island(['##.', '###', '###']);
  assert.deepEqual(planTop(1, 1, topologyOf(grid, 1, 1)!, lookup(grid, 'soft')).pieces, [{ mesh: 'soft-inner', rot: 0 }]);
});

test('corridors, caps and singles use their own pieces, and fall back to generated without one', () => {
  const grid = island(['.#.', '###', '.#.']);
  const withCorridor = normalizeProfile({ id: 'c', edge: 'e', corridor: 'c-corridor', single: 'c-single' });
  // (1, 0): east, north and west exposed -> a cap, which this profile lacks.
  const cap = planTop(1, 0, topologyOf(grid, 1, 0)!, () => withCorridor);
  assert.equal(cap.profiled, false);
  const line = island(['###']);
  // The middle of a one-row line has north and south exposed: a corridor, turned once.
  assert.deepEqual(planTop(1, 0, topologyOf(line, 1, 0)!, () => withCorridor).pieces, [{ mesh: 'c-corridor', rot: 1 }]);
  const alone = island(['#']);
  assert.deepEqual(planTop(0, 0, topologyOf(alone, 0, 0)!, () => withCorridor).pieces, [{ mesh: 'c-single', rot: 0 }]);
});

test('a tile with any exposed side lacking a profile stays generated', () => {
  const grid = island(['###', '###', '###']);
  const topology = topologyOf(grid, 2, 0)!;
  // East wears soft, north wears nothing.
  const half: ProfileOfEdge = (_gx, _gy, side) => (side === 0 ? soft : null);
  assert.deepEqual(planTop(2, 0, topology, half), { profiled: false, topology, pieces: [] });
  const bare = normalizeProfile({ id: 'bare' });
  assert.equal(planTop(2, 0, topology, () => bare).profiled, false);
});

test('a stack block below the top uses the same piece for its sides', () => {
  assert.deepEqual(planSub(0, 0, 0b0011, () => soft).pieces, [{ mesh: 'soft-outer', rot: 0 }]);
  assert.deepEqual(planSub(0, 0, 0b0100, () => soft).pieces, [{ mesh: 'soft-edge', rot: 2 }]);
});

test('overrides save sparsely, read back, and a map without them is all auto', () => {
  const grid = island(['##', '##']);
  grid.edges![idx(grid, 1, 0) * 4 + 0] = edgeValueOf(grid, 'cliff');
  const rows = encodeTerrain(grid, ['grass'], () => 'gr');
  assert.deepEqual(rows.edgeOverrides, [{ gx: 1, gy: 0, side: 'east', profile: 'cliff' }]);

  const back = decodeTerrain(rows).grid;
  assert.equal(edgeOverride(back, 1, 0, 0), 'cliff');
  assert.equal(edgeOverride(back, 0, 0, 0), '');

  const { edgeOverrides: _dropped, ...old } = rows;
  const legacy = decodeTerrain(old).grid;
  assert.equal(edgeOverride(legacy, 1, 0, 0), '');
  assert.equal(encodeTerrain(legacy, ['grass'], () => 'gr').edgeOverrides, undefined);
});

test('overrides survive a resize and a clone, and a stroke undoes them', () => {
  const grid = island(['##', '##']);
  const stroke = beginStroke(grid);
  stroke.setEdge(idx(grid, 1, 1), 3, edgeValueOf(grid, 'soft'));
  assert.equal(edgeOverride(resizeGrid(grid, 4, 4), 1, 1, 3), 'soft');
  assert.equal(edgeOverride(cloneGrid(grid), 1, 1, 3), 'soft');

  const entry = stroke.commit();
  assert.ok(entry);
  entry.undo();
  assert.equal(edgeOverride(grid, 1, 1, 3), '');
  entry.redo();
  assert.equal(edgeOverride(grid, 1, 1, 3), 'soft');
});
