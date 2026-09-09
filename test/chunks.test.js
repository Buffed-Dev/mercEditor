/**
 * Chunks: the rectangles a generated map is cut into.
 *
 * The thing worth pinning down is that cutting a chunk out gives back exactly
 * the little map that was drawn there — its terrain, and every object standing
 * inside it, moved to its own origin. Everything downstream assumes that: the
 * generator rotates and fits these as though they had been authored separately,
 * which is what they used to be.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chunkCount, chunksOf, isGenerated, normalizeChunk, strayCount } from '../Engine/src/data/maps/chunks.js';
import { assemble } from '../Engine/src/data/maps/generate.js';

/** Two 4x4 rooms side by side with a gap, and one thing outside both. */
const map = {
  id: 'test',
  name: 'Test',
  generated: true,
  chunkCount: 3,
  rows: [
    '1111.1111.',
    '1..1.1..1.',
    '1..1.1..1.',
    '11.1.1111.',
    '..........',
  ],
  spawns: { default: { gx: 1, gy: 1 } },
  chunks: [
    { gx: 0, gy: 0, w: 4, h: 4, name: 'left', role: 'start' },
    { gx: 5, gy: 0, w: 4, h: 4, name: 'right', role: 'end' },
  ],
  walls: [{ gx: 1, gy: 0 }, { gx: 6, gy: 0 }, { gx: 0, gy: 4 }],
  monsters: [{ gx: 2, gy: 2, kind: 'grunt' }, { gx: 7, gy: 1, kind: 'vase' }],
  doors: [{ gx: 2, gy: 3 }],
  portals: [],
  torches: [],
  stations: [],
  lights: [],
  env: { sky: 0x112233 },
};

test('a map is generated only when it says so and has chunks', () => {
  assert.equal(isGenerated(map), true);
  assert.equal(isGenerated({ ...map, generated: false }), false, 'the toggle did nothing');
  assert.equal(isGenerated({ ...map, chunks: [] }), false, 'nothing to build it out of');
  assert.equal(chunkCount(map), 3);
  assert.equal(chunkCount({ ...map, chunkCount: 0 }), 10, 'no count fell back to nothing');
});

test('cutting a chunk gives back what was drawn inside it, at its own origin', () => {
  const [left, right] = chunksOf(map);

  assert.equal(left.id, 'left');
  assert.equal(left.role, 'start');
  assert.deepEqual(left.rows, ['1111', '1..1', '1..1', '11.1']);
  assert.deepEqual(right.rows, ['1111', '1..1', '1..1', '1111']);

  // Objects come along, moved so the chunk's corner is the origin.
  assert.deepEqual(left.walls, [{ gx: 1, gy: 0 }]);
  assert.deepEqual(right.walls, [{ gx: 1, gy: 0 }], 'the right room kept the map coordinates');
  assert.deepEqual(left.monsters, [{ gx: 2, gy: 2, kind: 'grunt' }]);
  assert.deepEqual(right.monsters, [{ gx: 2, gy: 1, kind: 'vase' }]);
  assert.deepEqual(left.doors, [{ gx: 2, gy: 3 }]);
  assert.deepEqual(right.doors, []);

  // Everyone gets the map's weather: they are rooms in one place.
  assert.deepEqual(left.env, right.env);
});

test('the arrival tile belongs to the entrance', () => {
  const spawned = {
    ...map,
    rows: ['@111.1@11.', '1..1.1..1.', '1..1.1..1.', '11.1.1111.', '..........'],
  };
  const [left, right] = chunksOf(spawned);
  assert.ok(left.rows[0].includes('@'), 'the entrance lost its spawn');
  assert.ok(!right.rows[0].includes('@'), 'a second spawn travelled and would win the parse');
});

test('a chunk hanging off the edge of the grid is floor, not a crash', () => {
  const over = { ...map, chunks: [{ gx: 8, gy: 3, w: 4, h: 4, name: 'edge' }] };
  const [chunk] = chunksOf(over);
  assert.equal(chunk.rows.length, 4);
  assert.ok(
    chunk.rows.every((row) => row.length === 4),
    'a row came back short and would misalign the whole grid',
  );
});

test('what is outside every chunk is counted, not silently generated', () => {
  // A wall at 0,4 and nothing else lies outside both rooms.
  assert.equal(strayCount(map), 1);
  // 23 tiles of terrain plus the six objects: with no chunks, all of it.
  assert.equal(strayCount({ ...map, chunks: [] }), 29, 'with no chunks, everything is a stray');
});

test('a chunk is squared up before anything reads it', () => {
  const odd = normalizeChunk({ gx: -3, gy: 2.6, w: 0, h: -5, role: 'nonsense' }, 4);
  assert.deepEqual(odd, { gx: 0, gy: 3, w: 1, h: 1, name: 'chunk5', role: '' });
});

test('the chunks of a map assemble into something walkable', () => {
  const run = assemble(map.id, chunksOf(map), { count: 3, seed: 11 });

  assert.ok(run.rows.length > 4, 'the assembled map is no bigger than one chunk');
  assert.ok(run.generated.parts >= 1);
  // Doors are consumed by the fitting, so a run carries none to draw.
  assert.deepEqual(run.doors ?? [], []);
});
