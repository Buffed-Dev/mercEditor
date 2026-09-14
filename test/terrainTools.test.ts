import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../Engine/editor/history.ts';
import { beginStroke } from '../Engine/editor/terrain/stroke.ts';
import { brushCells, rectCells, cellLine } from '../Engine/editor/terrain/shapes.ts';
import { createGrid, idx } from '../Engine/src/data/terrain/grid.ts';
import { gridOf } from './helpers/terrainFixtures.ts';

// --- strokes and history ---------------------------------------------------

test('a stroke that changes nothing records no undo step', () => {
  const grid = gridOf(['11', '11']);
  const stroke = beginStroke(grid);
  stroke.set(0, 0, 1, 1);
  stroke.set(1, 1, 1, 1);
  assert.equal(stroke.touched, 2, 'the cells were written');
  assert.equal(stroke.commit(), null, 'but nothing about them changed');
});

test('undo and redo are exact, four deep', () => {
  const grid = gridOf(['111', '111', '111']);
  const original = [...grid.kind];

  const stroke = beginStroke(grid, 'paint');
  for (const [gx, gy] of [[0, 0], [1, 0], [1, 1]] as const) stroke.set(gx, gy, 2, 2);
  const entry = stroke.commit();
  assert.ok(entry);
  const painted = [...grid.kind];
  assert.notDeepEqual(painted, original);

  // The swap is self-inverse, so any number of round trips must land exactly
  // where it started rather than drifting.
  for (let i = 0; i < 4; i += 1) {
    entry.undo();
    assert.deepEqual([...grid.kind], original, `undo ${i}`);
    entry.redo();
    assert.deepEqual([...grid.kind], painted, `redo ${i}`);
  }
});

test('a cell crossed twice in one stroke undoes to where it started', () => {
  // The drag case: a slow cursor re-enters a cell it has already painted. If
  // the stroke remembered the intermediate value, undo would leave the cell
  // half-painted — and if `set` accumulated, raise would build a tower.
  const grid = gridOf(['1']);
  const stroke = beginStroke(grid);
  stroke.set(0, 0, 5, 1);
  stroke.set(0, 0, 9, 1);
  const entry = stroke.commit();
  assert.ok(entry);
  assert.equal(grid.level[0], 9);
  entry.undo();
  assert.equal(grid.level[0], 1, 'back to the original, not to the intermediate');
});

test('a stroke reports the rectangle it touched', () => {
  const grid = createGrid(10, 10);
  const stroke = beginStroke(grid);
  stroke.set(2, 3, 1, 1);
  stroke.set(5, 7, 1, 1);
  const entry = stroke.commit();
  assert.ok(entry);
  assert.deepEqual(entry.rect, { gx: 2, gy: 3, w: 4, h: 5 });
});

test('a stroke drops writes outside the map instead of wrapping', () => {
  const grid = gridOf(['11', '11']);
  const stroke = beginStroke(grid);
  stroke.set(-1, 0, 9, 1);
  stroke.set(0, 5, 9, 1);
  assert.equal(stroke.touched, 0);
  assert.equal(stroke.commit(), null);
});

test('one stack: terrain and object edits undo in the order they were made', () => {
  // The reason there is one history rather than two. Whatever the user did
  // last is what Ctrl+Z takes back, whichever kind of edit it was.
  const history = createHistory();
  const log: string[] = [];
  const entryFor = (label: string) => ({
    label,
    undo: () => log.push(`-${label}`),
    redo: () => log.push(`+${label}`),
  });

  history.push(entryFor('wall'));
  history.push({ ...entryFor('paint'), rect: { gx: 1, gy: 1, w: 2, h: 2 } });

  assert.deepEqual(history.undo(), { gx: 1, gy: 1, w: 2, h: 2 }, 'a stroke says what moved');
  assert.equal(history.undo(), null, 'a snapshot does not, so everything rebuilds');
  assert.equal(history.undo(), false, 'and then there is nothing left');
  assert.deepEqual(log, ['-paint', '-wall']);
});

test('a new edit throws away the redo branch', () => {
  const history = createHistory();
  const noop = { label: 'x', undo() {}, redo() {} };
  history.push(noop);
  history.undo();
  assert.equal(history.canRedo, true);
  history.push(noop);
  assert.equal(history.canRedo, false);
});

test('the history has a floor, and saving clears the dirty flag', () => {
  const history = createHistory(3);
  const noop = { label: 'x', undo() {}, redo() {} };
  for (let i = 0; i < 5; i += 1) history.push(noop);
  assert.equal(history.depth, 3, 'the oldest steps fall off');
  assert.equal(history.dirty, true);
  history.markSaved();
  assert.equal(history.dirty, false);
});

// --- brush shapes ----------------------------------------------------------

test('a brush is square, centred, odd, and clipped to the map', () => {
  const grid = createGrid(10, 10);
  assert.equal(brushCells(grid, { gx: 5, gy: 5 }, 1).length, 1);
  assert.equal(brushCells(grid, { gx: 5, gy: 5 }, 3).length, 9);
  assert.equal(brushCells(grid, { gx: 5, gy: 5 }, 9).length, 81);
  // An even size has no middle cell, so it rounds up to the next size that does.
  assert.equal(brushCells(grid, { gx: 5, gy: 5 }, 4).length, 25);
  assert.ok(brushCells(grid, { gx: 5, gy: 5 }, 3).includes(idx(grid, 5, 5)), 'centred');

  const corner = brushCells(grid, { gx: 0, gy: 0 }, 9);
  assert.equal(corner.length, 25, 'clipped at the corner, not wrapped');
  for (const i of corner) assert.ok(i >= 0 && i < 100);
});

test('a rectangle is the same whichever corner you drag from', () => {
  const grid = createGrid(10, 10);
  const a = rectCells(grid, { gx: 1, gy: 1 }, { gx: 5, gy: 5 });
  const b = rectCells(grid, { gx: 5, gy: 5 }, { gx: 1, gy: 1 });
  assert.deepEqual(a.sort(), b.sort());
  assert.equal(a.length, 25);
  assert.equal(rectCells(grid, { gx: 1, gy: 1 }, { gx: 5, gy: 5 }, false).length, 16, 'outline');
  assert.equal(rectCells(grid, { gx: 1, gy: 1 }, { gx: 1, gy: 5 }, false).length, 5, 'a 1xN line');
});

// --- drag interpolation ----------------------------------------------------

test('a dragged line never skips a cell', () => {
  const cases: [number, number, number, number][] = [
    [0, 0, 0, 0],
    [0, 0, 9, 0],
    [0, 0, 0, 9],
    [0, 0, 9, 9],
    [0, 0, 1, 20],
    [0, 0, 20, 1],
    [7, 3, 2, 11],
  ];
  for (const [ax, ay, bx, by] of cases) {
    const path = cellLine({ gx: ax, gy: ay }, { gx: bx, gy: by });
    assert.equal(path.length, Math.max(Math.abs(bx - ax), Math.abs(by - ay)) + 1, `${ax},${ay}->${bx},${by}`);
    assert.deepEqual(path[0], { gx: ax, gy: ay });
    assert.deepEqual(path[path.length - 1], { gx: bx, gy: by });
    // This is what "a fast mouse must not skip cells" actually means: every
    // step lands on a neighbour, never a jump.
    for (let i = 1; i < path.length; i += 1) {
      const step = Math.max(
        Math.abs(path[i]!.gx - path[i - 1]!.gx),
        Math.abs(path[i]!.gy - path[i - 1]!.gy),
      );
      assert.equal(step, 1, `jump at step ${i}`);
    }
  }
});

// --- validation ------------------------------------------------------------

test('validation reports what a person has to act on, and nothing else', async () => {
  const { validateTerrain } = await import('../Engine/editor/terrain/validate.ts');
  const { normalizeTerrain } = await import('../Engine/src/data/terrains.ts');
  const defs = [normalizeTerrain({ id: 'grass', char: 'gr', top: 'm1' })];

  // A clean map says nothing. The regression guard: it is easy to write a
  // validator that always finds something.
  const clean = gridOf(['11', '11']);
  assert.deepEqual(validateTerrain(clean, ['grass'], defs), []);

  // A map with no terrain draws nothing at all, with no error — the one case
  // worth failing hard on, because it looks exactly like a broken renderer.
  const empty = createGrid(4, 4);
  const fatal = validateTerrain(empty, [], defs);
  assert.ok(fatal.some((p) => p.fatal), 'an empty map is a hard failure');

  // A map naming a terrain the rules no longer define keeps its cells and says
  // so, rather than losing them.
  const renamed = validateTerrain(clean, ['meadow'], defs);
  assert.match(renamed.map((p) => p.text).join('\n'), /4 cells are "meadow"/);

  // Two terrains sharing a key write a file that cannot be read back.
  const clashing = [
    normalizeTerrain({ id: 'grass', char: 'gr', top: 'm1' }),
    normalizeTerrain({ id: 'gravel', char: 'gr', top: 'm1' }),
  ];
  assert.match(
    validateTerrain(clean, ['grass'], clashing).map((p) => p.text).join('\n'),
    /both use the grid letter/,
  );
});

test('a lifted region can be put back down somewhere else', async () => {
  const { readRegion, stampRegion } = await import('../Engine/editor/terrain/tools.ts');
  const grid = gridOf(['12--', '34--', '----', '----']);
  const held = readRegion(grid, { gx: 0, gy: 0, w: 2, h: 2 });
  assert.deepEqual([...held.level], [1, 2, 3, 4]);

  const stroke = beginStroke(grid, 'move');
  stampRegion({ grid, stroke } as never, held, 2, 2);
  stroke.commit();
  assert.equal(grid.level[idx(grid, 2, 2)], 1);
  assert.equal(grid.level[idx(grid, 3, 3)], 4);
  // The source is untouched by a stamp: cutting is the caller's job, which is
  // what lets a move overlap itself without smearing.
  assert.equal(grid.level[idx(grid, 0, 0)], 1);
});

// --- debug layers ----------------------------------------------------------

test('the debug layers read the grid rather than the picture', async () => {
  const { DEBUG_LAYERS } = await import('../Engine/editor/terrain/debugLayers.ts');
  const byId = (id: string) => DEBUG_LAYERS.find((layer) => layer.id === id)!;

  // A three-by-three plateau in a five-wide grid: every cell of it is ground,
  // the middle one is surrounded, and the eight around it drop somewhere.
  const grid = createGrid(5, 5);
  for (let gy = 1; gy <= 3; gy += 1) {
    for (let gx = 1; gx <= 3; gx += 1) grid.kind[idx(grid, gx, gy)] = 1;
  }

  assert.equal(byId('occupied').cells(grid).length, 9);
  // The middle has ground on all four sides, so it is the one that is not a
  // cliff anywhere.
  assert.equal(byId('exposed').cells(grid).length, 8);
  // The four corners of the plateau are corner pieces; the four edges are not.
  assert.equal(byId('corners').cells(grid).length, 4);
});

test('an empty grid puts nothing in any layer', async () => {
  const { DEBUG_LAYERS } = await import('../Engine/editor/terrain/debugLayers.ts');
  const grid = createGrid(4, 4);
  for (const layer of DEBUG_LAYERS) assert.deepEqual(layer.cells(grid), []);
});
