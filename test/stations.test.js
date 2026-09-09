/**
 * A station is a new kind of thing on a map, and cluster.js enumerates its
 * lists by literal name in two places — so a list it has not been told about
 * is carried through unrotated, or dropped from an assembled dungeon, with no
 * error either way. These are the two tests that make that noise.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assemble, rotatePart } from '../Engine/src/data/maps/generate.js';

/** A one-room part with a bench and a monster on known tiles. */
function part(id, extra = {}) {
  return {
    id,
    cluster: 'test',
    rows: ['11111', '1...1', '1...1', '1...1', '11111'],
    spawns: {},
    walls: [],
    portals: [],
    monsters: [{ gx: 1, gy: 3, kind: 'grunt' }],
    stations: [{ gx: 1, gy: 3, label: 'Bench' }],
    torches: [],
    doors: [],
    lights: [],
    env: {},
    ...extra,
  };
}

test('a station turns with the grid, the same way a monster does', () => {
  const original = part('p');

  const once = rotatePart(original, 1);
  assert.deepEqual(
    { gx: once.stations[0].gx, gy: once.stations[0].gy },
    { gx: once.monsters[0].gx, gy: once.monsters[0].gy },
    'a bench and a monster on one tile must land on one tile',
  );
  assert.notDeepEqual(
    { gx: once.stations[0].gx, gy: once.stations[0].gy },
    { gx: 1, gy: 3 },
    'a bench that did not move was never rotated',
  );

  const round = rotatePart(original, 4);
  assert.deepEqual(round.stations[0], original.stations[0]);
  assert.equal(round.stations[0].label, 'Bench');
});

test('a station survives being assembled into a cluster', () => {
  const map = assemble('test', [part('start', { role: 'start', clusterSize: 1 })], 1);
  assert.ok(map.stations?.length, 'the assembled map has no stations at all');
  assert.equal(map.stations[0].label, 'Bench');

  // Offset by wherever the part was laid down — the same move the monster got.
  assert.deepEqual(
    { gx: map.stations[0].gx, gy: map.stations[0].gy },
    { gx: map.monsters[0].gx, gy: map.monsters[0].gy },
  );
});
