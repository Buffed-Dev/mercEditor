import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeTerrain,
  decodeTerrain,
  terrainKeys,
  EMPTY_KEY,
} from '../Engine/src/data/terrain/codec.ts';
import {
  createGrid,
  resizeGrid,
  cloneGrid,
  levelAt,
  kindAt,
  isEmptyGrid,
  idx,
  EMPTY,
} from '../Engine/src/data/terrain/grid.ts';
import { normalizeRim, DEFAULT_RIM } from '../Engine/src/data/terrain/profile.ts';
import { gridOf } from './helpers/terrainFixtures.ts';

const IDS = ['grass', 'sand', 'stone'];
const charOf = (id: string) => ({ grass: 'gr', sand: 'sa', stone: 'st' })[id] ?? '';

// --- grid ------------------------------------------------------------------

test('a fresh grid is entirely empty, not entirely level 0', () => {
  const grid = createGrid(64, 64);
  assert.equal(grid.level.length, 4096);
  assert.ok(grid.kind instanceof Uint8Array);
  assert.equal(kindAt(grid, 10, 10), EMPTY);
  // The invariant most likely to be broken by a careless `?? 0` downstream:
  // an empty cell has no height at all, which is not the same as height zero.
  assert.equal(levelAt(grid, 10, 10), null);
  assert.equal(levelAt(grid, -1, 0), null, 'out of bounds is empty too');
  assert.equal(isEmptyGrid(grid), true);
});

test('resize keeps cells where they were and does not conjure floor', () => {
  // Every cell distinct, so an off-by-one in the row stride is visible.
  const grid = createGrid(4, 3);
  for (let gy = 0; gy < 3; gy += 1) {
    for (let gx = 0; gx < 4; gx += 1) {
      const i = idx(grid, gx, gy);
      grid.kind[i] = 1;
      grid.level[i] = gy * 4 + gx;
    }
  }

  const bigger = resizeGrid(grid, 6, 5);
  for (let gy = 0; gy < 3; gy += 1) {
    for (let gx = 0; gx < 4; gx += 1) {
      assert.equal(levelAt(bigger, gx, gy), gy * 4 + gx, `cell ${gx},${gy} moved`);
    }
  }
  assert.equal(levelAt(bigger, 5, 4), null, 'new cells are empty, not level-0 ground');

  const smaller = resizeGrid(grid, 2, 2);
  assert.equal(levelAt(smaller, 1, 1), 5, 'surviving cells keep their coordinates');
  assert.equal(smaller.level.length, 4);
});

test('cloneGrid is a real copy', () => {
  const grid = gridOf(['11']);
  const copy = cloneGrid(grid);
  copy.level[0] = 7;
  assert.equal(grid.level[0], 1, 'writing the copy must not reach the original');
});

// --- codec -----------------------------------------------------------------

test('encode then decode returns the same grid, cell for cell', () => {
  const grid = createGrid(5, 4);
  // Everything the format has to survive: empty, level 0, level 9, each terrain.
  const cells: [number, number, number, number][] = [
    [0, 0, 1, 0],
    [1, 0, 2, 9],
    [2, 0, 3, 4],
    [3, 0, 1, 4],
    [4, 0, 2, 4],
    [0, 1, 3, 4],
    [1, 1, 1, 5],
    [2, 1, 2, 5],
    [3, 1, 3, 5],
    [4, 1, 1, 5],
    [2, 3, 2, 7],
  ];
  for (const [gx, gy, kind, level] of cells) {
    const i = idx(grid, gx, gy);
    grid.kind[i] = kind;
    grid.level[i] = level;
  }

  const rows = encodeTerrain(grid, IDS, charOf);
  const { grid: back, terrainIds, problems } = decodeTerrain(rows);

  assert.deepEqual(problems, [], 'a grid this code wrote must read back clean');
  assert.deepEqual(terrainIds, IDS);
  assert.deepEqual([...back.kind], [...grid.kind]);
  assert.deepEqual([...back.level], [...grid.level]);
});

test('rows are uniform width: one char per cell of height, two of terrain', () => {
  const grid = gridOf(['111', '1-1']);
  const rows = encodeTerrain(grid, IDS, charOf);
  for (const row of rows.height) assert.equal(row.length, 3);
  for (const row of rows.terrain) assert.equal(row.length, 6);
  assert.ok(rows.terrain[1]!.includes(EMPTY_KEY), 'the hole is written as empty');
});

test('the legend is written into the map, not taken from the rules', () => {
  const keys = terrainKeys(IDS, charOf);
  assert.deepEqual(keys, { gr: 'grass', sa: 'sand', st: 'stone' });
  // A one-char name doubles rather than pads, so it still reads as a name.
  assert.deepEqual(terrainKeys(['grass'], () => 'g'), { gg: 'grass' });
  // A clash falls back to something ugly and unique rather than losing a cell.
  const clashing = terrainKeys(['grass', 'gravel'], () => 'gr');
  assert.equal(Object.keys(clashing).length, 2, 'two terrains keep two keys');
});

test('a height under an empty cell is reported, not silently occupied', () => {
  const { grid, problems } = decodeTerrain({
    height: ['3'],
    terrain: [EMPTY_KEY],
    terrainKeys: { gr: 'grass' },
  });
  assert.equal(levelAt(grid, 0, 0), null, 'the terrain row decides whether a cell exists');
  assert.match(problems.join('\n'), /empty but stands at level 3/);
});

test('an unknown key is reported rather than falling back to terrain zero', () => {
  const { grid, problems } = decodeTerrain({
    height: ['1'],
    terrain: ['zz'],
    terrainKeys: { gr: 'grass' },
  });
  assert.equal(levelAt(grid, 0, 0), null);
  assert.match(problems.join('\n'), /legend does not define/);
});

test('a short row is reported and decodes deterministically as empty', () => {
  const { grid, problems } = decodeTerrain({
    height: ['11'],
    terrain: ['gr'],
    terrainKeys: { gr: 'grass' },
  });
  assert.equal(levelAt(grid, 0, 0), 1);
  assert.equal(levelAt(grid, 1, 0), null, 'past the end of a short row is empty');
  assert.match(problems.join('\n'), /terrain row 0 is 2 chars, expected 4/);
});

test('a map written before ramps were removed loads, and drops them', () => {
  const { grid, problems } = decodeTerrain({
    height: ['11'],
    terrain: ['grgr'],
    terrainKeys: { gr: 'grass' },
    tops: [{ gx: 1, gy: 0, kind: 'ramp' }],
  });

  // The cells survive as ordinary flat ground; only the slope on them is gone.
  assert.equal(levelAt(grid, 1, 0), 1);
  assert.match(problems.join('\n'), /ramps were dropped/);

  // And nothing writes one back out.
  assert.equal(encodeTerrain(grid, IDS, charOf).tops, undefined);
});

test('an empty map decodes without throwing', () => {
  const { grid, problems } = decodeTerrain({ height: [], terrain: [], terrainKeys: {} });
  assert.equal(grid.cols, 0);
  assert.deepEqual(problems, []);
  assert.equal(decodeTerrain(null).grid.rows, 0);
});

// --- profile ---------------------------------------------------------------

test('a rim profile is forced into the shape the generator relies on', () => {
  const rim = normalizeRim([
    { inset: 0.9, drop: 0.3 },
    { inset: 0.2, drop: 0.1 },
    { inset: 0.4, drop: 0.2 },
  ]);
  assert.equal(rim[0]!.drop, 0, 'the first ring joins the flat top');
  assert.equal(rim[rim.length - 1]!.inset, 0, 'the last ring is on the cell boundary');
  for (let i = 1; i < rim.length; i += 1) {
    assert.ok(rim[i]!.inset < rim[i - 1]!.inset, 'insets strictly decrease');
    assert.ok(rim[i]!.drop >= rim[i - 1]!.drop, 'drops never climb back up');
  }
  // Past half a tile the two sides of a cell's rim cross and the surface turns
  // inside out, so the widest ring is clamped well short of it.
  assert.ok(normalizeRim([{ inset: 5, drop: 0 }, { inset: 0, drop: 1 }])[0]!.inset <= 0.45);
});

test('garbage or a too-short rim falls back to the default', () => {
  assert.deepEqual(normalizeRim([]), normalizeRim(DEFAULT_RIM));
  assert.deepEqual(normalizeRim(null), normalizeRim(DEFAULT_RIM));
  assert.deepEqual(normalizeRim([{ inset: 0.1, drop: 0 }]), normalizeRim(DEFAULT_RIM));
});
