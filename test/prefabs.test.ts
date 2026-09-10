import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPrefabs,
  normalizePrefab,
  prefabFootprint,
  prefabObjects,
} from '../Engine/src/data/prefabs.ts';
import { turnEntry } from '../Engine/src/data/maps/rotate.ts';
import { rotatePart } from '../Engine/src/data/maps/generate.ts';
import type { ChunkPart } from '../Engine/src/data/maps/chunks.ts';
import type { GameMap, MapObject } from '../Engine/src/data/mapFormat.ts';
import { mapDoc } from './helpers/terrainFixtures.ts';

/**
 * Prefabs: the arithmetic of turning one, and the contract expansion owes the
 * editor.
 *
 * Whether a campfire *looks* right where you dropped it is not testable here.
 * What is, is that the tile it lands on is the tile the maths says, that a
 * torch comes out of a turned prefab still on the wall it was mounted to, and
 * that expanding a map does not move anything that was already in it.
 */

/** A 3x2 prefab: three tiles across the top row, one below the left. */
const camp = normalizePrefab({
  id: 'camp',
  label: 'Camp',
  props: [
    { gx: 0, gy: 0, id: 'fire', rot: 0 },
    { gx: 2, gy: 0, id: 'pot', rot: 90 },
    { gx: 0, gy: 1, id: 'stone' },
  ],
  torches: [{ gx: 1, gy: 0, face: '+x' }],
});

test('a prefab is measured from what is in it, not told how big it is', () => {
  assert.equal(camp.w, 3);
  assert.equal(camp.h, 2);

  // Built in the middle of a map, it is still the same prefab: the corner of
  // what is in it goes to (0, 0), the way a chunk's does when it is cut out.
  const elsewhere = normalizePrefab({
    id: 'camp',
    props: [
      { gx: 10, gy: 7, id: 'fire' },
      { gx: 12, gy: 8, id: 'stone' },
    ],
  });
  assert.deepEqual(
    elsewhere.props.map((one) => [one.gx, one.gy]),
    [
      [0, 0],
      [2, 1],
    ],
  );
  assert.equal(elsewhere.w, 3);
  assert.equal(elsewhere.h, 2);

  // Nothing in it is a footprint of nothing, rather than one tile of nothing.
  assert.deepEqual([normalizePrefab({ id: 'bare' }).w, normalizePrefab({ id: 'bare' }).h], [0, 0]);
});

test('a quarter turn moves a tile where the arithmetic says, and comes back round', () => {
  // Inside a box `h` tall, one clockwise turn sends (gx, gy) to (h - 1 - gy, gx).
  assert.deepEqual(turnEntry({ gx: 0, gy: 0 }, 2), { gx: 1, gy: 0 });
  assert.deepEqual(turnEntry({ gx: 2, gy: 0 }, 2), { gx: 1, gy: 2 });
  assert.deepEqual(turnEntry({ gx: 0, gy: 1 }, 2), { gx: 0, gy: 0 });

  // Four turns is where you started, which is the cheapest check that the box
  // is being swapped along with the tiles.
  for (const rot of [0, 90, 180, 270]) {
    const there = prefabObjects(camp, { gx: 0, gy: 0, rot });
    const back = prefabObjects(
      normalizePrefab({ id: 'x', ...there }),
      { gx: 0, gy: 0, rot: 360 - rot === 360 ? 0 : 360 - rot },
    );
    assert.deepEqual(
      back.props.map((one) => [one.gx, one.gy]).sort(),
      camp.props.map((one) => [one.gx, one.gy]).sort(),
      `${rot}° and back`,
    );
  }
});

test('everything carrying a direction turns with the tiles', () => {
  // A torch mounts on a wall's face. Left behind, it comes out of a turned
  // prefab hanging in the air off the wrong side.
  const faces = [0, 90, 180, 270].map(
    (rot) => String(prefabObjects(camp, { gx: 0, gy: 0, rot }).torches[0].face),
  );
  assert.deepEqual(faces, ['+x', '+y', '-x', '-y']);

  // An object's own turn, by the same amount and in the same direction: a tile
  // is one unit on X and Z, so turning the grid clockwise turns the world the
  // other way, which is why ninety comes off rather than on.
  const pot = (rot: number) =>
    prefabObjects(camp, { gx: 0, gy: 0, rot }).props.find((one) => one.id === 'pot')?.rot;
  assert.deepEqual([pot(0), pot(90), pot(180), pot(270)], [90, 0, 270, 180]);

  // A sun's bearing is on the same compass and turns the same way.
  assert.equal(turnEntry({ gx: 0, gy: 0, azimuth: 45 }, 1).azimuth, 315);
});

test('a turned prefab covers the box it actually occupies', () => {
  assert.deepEqual(prefabFootprint(camp, { gx: 0, gy: 0 }), { w: 3, h: 2 });
  assert.deepEqual(prefabFootprint(camp, { gx: 0, gy: 0, rot: 180 }), { w: 3, h: 2 });
  // On its side the two swap, or a placement would reserve the wrong tiles.
  assert.deepEqual(prefabFootprint(camp, { gx: 0, gy: 0, rot: 90 }), { w: 2, h: 3 });
  assert.deepEqual(prefabFootprint(camp, { gx: 0, gy: 0, rot: 270 }), { w: 2, h: 3 });
});

test('a placement lands where it was put', () => {
  const there = prefabObjects(camp, { gx: 5, gy: 4 });
  assert.deepEqual(
    there.props.map((one) => [one.gx, one.gy]),
    [
      [5, 4],
      [7, 4],
      [5, 5],
    ],
  );
});

// ------------------------------------------------------------------ expansion

const withCamp = (): GameMap =>
  ({
    ...mapDoc(['....', '....'], { id: 'yard' }),
    props: [{ gx: 0, gy: 0, id: 'barrel' }],
    walls: [{ gx: 3, gy: 3, stack: 1 }],
    prefabs: [{ gx: 1, gy: 1, id: 'camp' }],
  }) as GameMap;

const lookup = (id: string) => (id === 'camp' ? camp : null);

test('expansion appends, and never moves what was already there', () => {
  // The contract the editor's picking rests on: the scene tags a wall with its
  // index in the list it was drawn from, so a child spliced in ahead of one
  // would silently make that tag point at something else.
  const map = withCamp();
  const out = expandPrefabs(map, lookup);

  assert.deepEqual(out.props?.[0], map.props?.[0], 'the map’s own prop is still index 0');
  assert.equal(out.props?.length, 4, 'and the three children came after it');
  assert.equal(out.walls?.[0]?.gx, 3, 'an untouched list keeps its first entry');

  // Each child says which placement drew it, so a pick on one resolves back to
  // the single thing you can select.
  assert.deepEqual(
    out.props?.slice(1).map((one) => one.prefab),
    [0, 0, 0],
  );
  // Placed at (1, 1), so the children are offset by it.
  assert.deepEqual(
    out.props?.slice(1).map((one) => [one.gx, one.gy]),
    [
      [1, 1],
      [3, 1],
      [1, 2],
    ],
  );
});

test('a map with no placements is handed back unchanged', () => {
  // Not merely equal: the same object, so nothing that has never seen a prefab
  // pays for them.
  const plain = mapDoc(['....'], { id: 'plain' }) as GameMap;
  assert.equal(expandPrefabs(plain, lookup), plain);
});

test('a placement naming a prefab that is gone draws nothing', () => {
  const map = { ...withCamp(), prefabs: [{ gx: 0, gy: 0, id: 'vanished' }] } as GameMap;
  const out = expandPrefabs(map, lookup);
  assert.equal(out.props?.length, 1, 'only the map’s own');
});

test('a prefab door takes the wall it lands on with it', () => {
  // The editor refuses to leave a door and a wall on one tile, but that rule
  // runs when you draw -- and this is the one moment the two lists meet with
  // nobody drawing.
  const doorway = normalizePrefab({ id: 'doorway', doors: [{ gx: 0, gy: 0 }] });
  const map = {
    ...mapDoc(['....', '....'], { id: 'yard' }),
    walls: [
      { gx: 2, gy: 2, stack: 1 },
      { gx: 3, gy: 3, stack: 1 },
    ],
    prefabs: [{ gx: 2, gy: 2, id: 'doorway' }],
  } as GameMap;

  const out = expandPrefabs(map, (id) => (id === 'doorway' ? doorway : null));
  assert.deepEqual(
    (out.walls ?? []).map((one) => [one.gx, one.gy]),
    [[3, 3]],
    'the wall under the door is gone, the other is not',
  );
});

test('a prefab reaching through prefabs stops rather than running forever', () => {
  // Nesting is not offered by the editor, but a file can say anything and a
  // cycle would be a page that never finished loading.
  const loop = normalizePrefab({ id: 'loop', props: [{ gx: 0, gy: 0, id: 'x' }] });
  const nested = {
    ...mapDoc(['..'], { id: 'deep' }),
    prefabs: [{ gx: 0, gy: 0, id: 'loop' }],
  } as GameMap;
  const out = expandPrefabs(nested, () => loop, 99);
  assert.equal((out.props ?? []).length, 0, 'past the depth limit it expands nothing');
});

test('a prefab is one thing however many lists it reaches into', () => {
  const out = expandPrefabs(withCamp(), lookup) as GameMap & { torches?: readonly MapObject[] };
  assert.equal(out.torches?.length, 1);
  assert.deepEqual([out.torches?.[0].gx, out.torches?.[0].gy], [2, 1]);
  assert.equal(out.torches?.[0].prefab, 0);
});

test('a chunk carries its prefabs, and turns them with the room', () => {
  // The failure this guards is the one test/stations.test.ts was written for:
  // a list the rotation had not been told about is carried through unrotated,
  // with no error either way. Every list turns now, rather than seven written
  // out by hand, so `prefabs` joining MAP_LISTS was enough.
  const room: ChunkPart = {
    id: 'room',
    name: 'room',
    role: '',
    rows: ['111', '1.1', '111'],
    spawns: {},
    env: {},
    walls: [],
    portals: [],
    monsters: [],
    torches: [],
    stations: [],
    lights: [],
    doors: [],
    prefabs: [{ gx: 0, gy: 0, id: 'camp', rot: 0 }],
  };

  const turned = rotatePart(room, 1);
  // Inside a 3-tall box: (0,0) -> (2,0), and the placement's own turn follows.
  assert.deepEqual(
    turned.prefabs.map((one) => [one.gx, one.gy, one.rot]),
    [[2, 0, 270]],
  );

  // And all the way round is where it started.
  assert.deepEqual(
    rotatePart(room, 4).prefabs.map((one) => [one.gx, one.gy, one.rot]),
    [[0, 0, 0]],
  );
});
