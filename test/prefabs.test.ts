import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPrefabs,
  isActorPrefab,
  normalizePrefab,
  prefabBounds,
  prefabFootprint,
  prefabObjects,
} from '../Engine/src/data/prefabs.ts';
import { turnEntry } from '../Engine/src/data/maps/rotate.ts';
import { rotatePart } from '../Engine/src/data/maps/generate.ts';
import type { ChunkPart } from '../Engine/src/data/maps/chunks.ts';
import type { GameMap } from '../Engine/src/data/mapFormat.ts';
import { createDocument } from '../Engine/editor/document.ts';
import { createDataDocument } from '../Engine/editor/dataDocument.ts';
import { prefabFromSelection, unpackPrefab } from '../Engine/editor/prefabFromSelection.ts';
import type { Prefab } from '../Engine/src/data/prefabs.ts';
import { serializeMap } from '../Engine/editor/serialize.ts';
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
  vfx: [{ gx: 1, gy: 0, id: 'smoke' }],
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

  // A placement turns about the middle of its box, so a 3×2 turned a quarter
  // stands across its old middle (1.5, 1) and overhangs its corner tile by
  // half a tile: the fire at (0, 0) comes round to (0.5, 1.5).
  const turned = prefabObjects(camp, { gx: 0, gy: 0, rot: 90 });
  assert.deepEqual(
    turned.props.map((one) => [one.gx, one.gy]),
    [
      [0.5, 1.5],
      [0.5, -0.5],
      [1.5, 1.5],
    ],
  );
  // And a whole turn is where you started.
  assert.deepEqual(
    prefabObjects(camp, { gx: 0, gy: 0, rot: 360 }).props.map((one) => [one.gx, one.gy]),
    camp.props.map((one) => [one.gx, one.gy]),
  );
});

test('everything carrying a direction turns with the tiles', () => {
  // An object's own turn, by the same amount and in the same direction: a
  // placement's `rot` is the same turn about Y an object's is, so the two add.
  const pot = (rot: number) =>
    prefabObjects(camp, { gx: 0, gy: 0, rot }).props.find((one) => one.id === 'pot')?.rot;
  assert.deepEqual([pot(0), pot(90), pot(180), pot(270)], [90, 180, 270, 0]);

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
    vfx: [{ gx: 3, gy: 3, id: 'smoke' }],
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
  assert.equal(out.vfx?.[0]?.gx, 3, 'an untouched list keeps its first entry');

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
  const out = expandPrefabs(withCamp(), lookup);
  // The map's own effect is index 0; the camp's is the one that came after.
  assert.equal(out.vfx?.length, 2);
  assert.deepEqual([out.vfx?.[1].gx, out.vfx?.[1].gy], [2, 1]);
  assert.equal((out.vfx?.[1] as { prefab?: number }).prefab, 0);
});

test('an actor prefab is left whole when asked, while scenery still flattens', () => {
  // The game keeps a body in one piece — it has to move — and the editor
  // flattens everything so a part of one can be picked. Same function, one
  // predicate; and what is not flattened is not tagged either.
  const goblin = normalizePrefab({ id: 'goblin', label: 'Goblin', archetype: 'grunt', props: [{ gx: 0, gy: 0, id: 'body' }] });
  assert.equal(isActorPrefab(goblin), true);
  assert.equal(isActorPrefab(camp), false);
  const map = { ...withCamp(), prefabs: [{ gx: 1, gy: 1, id: 'camp' }, { gx: 3, gy: 0, id: 'goblin' }] } as GameMap;
  const both = (id: string) => (id === 'goblin' ? goblin : lookup(id));

  const game = expandPrefabs(map, both, 0, (one) => !isActorPrefab(one));
  assert.equal(game.props?.length, 4, 'the camp came apart; the goblin did not');
  assert.ok(game.props?.every((one) => one.prefab !== 1), 'nothing was tagged with the goblin');

  const editor = expandPrefabs(map, both);
  assert.equal(editor.props?.length, 5, 'the editor flattens the goblin too');
  assert.equal(editor.props?.[4].prefab, 1);
});

test('a chunk carries its prefabs, and turns them with the room', () => {
  // The failure this guards: a list the rotation has not been told about is
  // carried through unrotated, with no error either way. Every list turns now,
  // rather than several written out by hand, so `prefabs` joining MAP_LISTS was
  // enough.
  const room: ChunkPart = {
    id: 'room',
    name: 'room',
    role: '',
    rows: ['111', '1.1', '111'],
    spawns: {},
    env: {},
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

// ------------------------------------------------------------- the document

test('a placement written by hand round-trips through a save', async () => {
  const doc = createDocument(
    {
      ...mapDoc(['....', '....', '....'], { id: 'yard', name: 'Yard' }),
      prefabs: [
        { gx: 1, gy: 1, id: 'camp' },
        { gx: 3, gy: 0, id: 'camp', rot: 90 },
      ],
    } as GameMap,
    lookup,
  );

  const source = serializeMap(doc.map, () => 'gr');
  const module = (await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  )) as Record<string, GameMap>;
  const read = Object.values(module)[0];

  assert.deepEqual(read.prefabs, [
    { gx: 1, gy: 1, id: 'camp' },
    { gx: 3, gy: 0, id: 'camp', rot: 90 },
  ]);
});

test('a prefab is the tiles it covers, not the one it starts on', () => {
  // camp is 3x2, dropped at (1, 1), so it reaches to (3, 2).
  const doc = createDocument(
    { ...mapDoc(['......', '......', '......'], { id: 'yard' }), prefabs: [{ gx: 1, gy: 1, id: 'camp' }] } as GameMap,
    lookup,
  );

  // Clicking the far corner finds it, not nothing.
  assert.deepEqual(doc.selectionAt(3, 2), { list: 'prefabs', index: 0 });
  assert.deepEqual(doc.selectionAt(1, 1), { list: 'prefabs', index: 0 });
  assert.equal(doc.selectionAt(4, 1), null, 'and one tile past it is a bare tile');

  // Nothing drops inside the box, wherever in it you aim.
  const brush = { id: 'wall', label: 'Wall', list: 'walls', group: 'structure', icon: '' };
  assert.ok(doc.place(3, 2, brush), 'the far corner is occupied');
  assert.equal(doc.place(4, 1, brush), null, 'the tile past it is not');

  // And erasing anywhere inside takes the whole placement, because "make this
  // tile empty" is what the eraser is for.
  assert.ok(doc.erase(3, 2));
  assert.equal(doc.map.prefabs.length, 0);
});

test('a prefab will not be placed where it does not fit', () => {
  const doc = createDocument(mapDoc(['....', '....'], { id: 'yard' }) as GameMap, lookup);
  const brush = { id: 'prefab', label: 'Prefab', list: 'prefabs', group: 'layout', icon: '' };

  // 3 wide starting at gx 2 runs off a 4-wide map, and nothing is written.
  assert.match(String(doc.place(2, 0, brush, { prefabId: 'camp' })), /does not fit/);
  assert.equal(doc.map.prefabs.length, 0, 'refused before anything was pushed');

  assert.equal(doc.place(0, 0, brush, { prefabId: 'camp' }), null);
  assert.equal(doc.map.prefabs.length, 1);
  // And a second one overlapping the first is refused by the same test.
  assert.match(String(doc.place(1, 0, brush, { prefabId: 'camp' })), /in the way/);
});

// ------------------------------------------------- making one, and unmaking it

test('a selection becomes a prefab, and the map keeps its shape', () => {
  const doc = createDocument(
    {
      ...mapDoc(['......', '......', '......'], { id: 'yard' }),
      props: [
        { gx: 1, gy: 1, id: 'fire' },
        { gx: 3, gy: 1, id: 'pot' },
        { gx: 5, gy: 2, id: 'keep-me' },
      ],
      vfx: [{ gx: 1, gy: 2, id: 'smoke' }],
    } as GameMap,
    lookup,
  );
  const rules = createDataDocument({});
  const picked = new Set(['props:0', 'props:1', 'vfx:0']);

  const made = prefabFromSelection(doc, picked, rules, 'Camp');
  assert.ok(typeof made !== 'string', String(made));

  // The three picked objects are gone from the map and one placement stands
  // where their top-left corner was.
  assert.deepEqual(
    doc.map.props.map((one) => one.id),
    ['keep-me'],
    'what was not picked is untouched',
  );
  assert.deepEqual(
    doc.map.prefabs.map((one) => [one.gx, one.gy]),
    [[1, 1]],
  );

  // And the record holds them measured from that corner.
  const prefab = rules.list('prefabs')[0] as unknown as Prefab;
  assert.deepEqual(
    prefab.props.map((one) => [one.gx, one.gy, one.id]),
    [
      [0, 0, 'fire'],
      [2, 0, 'pot'],
    ],
  );
  // The effect came too, one row down — which is what makes the box two tall.
  assert.deepEqual(
    prefab.vfx.map((one) => [one.gx, one.gy]),
    [[0, 1]],
  );
  assert.deepEqual([prefab.w, prefab.h], [3, 2]);
});

test('making a prefab is one undo step, not one per object', () => {
  const doc = createDocument(
    {
      ...mapDoc(['....', '....'], { id: 'yard' }),
      props: [
        { gx: 0, gy: 0, id: 'a' },
        { gx: 1, gy: 0, id: 'b' },
        { gx: 2, gy: 0, id: 'c' },
      ],
    } as GameMap,
    lookup,
  );
  const rules = createDataDocument({});

  assert.ok(typeof prefabFromSelection(doc, new Set(['props:0', 'props:1', 'props:2']), rules, 'Trio') !== 'string');
  assert.equal(doc.map.props.length, 0);

  doc.undo();
  assert.deepEqual(
    doc.map.props.map((one) => one.id),
    ['a', 'b', 'c'],
    'one undo brought all three back',
  );
  assert.equal(doc.map.prefabs.length, 0);
});

test('unpacking gives back exactly what was drawn', () => {
  const doc = createDocument(
    { ...mapDoc(['......', '......'], { id: 'yard' }), prefabs: [{ gx: 2, gy: 0, id: 'camp', rot: 90 }] } as GameMap,
    lookup,
  );

  // What the renderer would have drawn for that placement, asked for the same
  // way expansion asks -- so this is a comparison against the screen.
  const drawn = prefabObjects(camp, { gx: 2, gy: 0, rot: 90 });

  assert.equal(unpackPrefab(doc, 0, lookup), null);
  assert.equal(doc.map.prefabs.length, 0, 'the placement is gone');
  assert.deepEqual(
    doc.map.props.map((one) => [one.gx, one.gy, one.id, one.rot]),
    drawn.props.map((one) => [one.gx, one.gy, one.id, one.rot]),
  );
  // The marker saying which placement drew a child does not survive: these are
  // the map's own objects now.
  assert.ok(doc.map.props.every((one) => one.prefab === undefined));

  doc.undo();
  assert.equal(doc.map.prefabs.length, 1, 'one undo put the placement back');
  assert.equal(doc.map.props.length, 0);
});

test('a placement is a whole transform, and its children go through it', () => {
  // A tilted, doubled, lifted placement: the child's own turn is composed with
  // the prefab's rather than added, and its offset is scaled and lifted.
  const tall = normalizePrefab({ id: 'tall', props: [{ gx: 1, gy: 0, id: 'post', rot: 90 }] });
  const [post] = prefabObjects(tall, {
    gx: 0,
    gy: 0,
    lift: 2,
    rot: 90,
    scaleX: 2,
    scaleY: 3,
    scaleZ: 2,
  }).props;
  // Measured to its own corner first, so the post stands at (0, 0) in a 1×1
  // prefab -- which is the middle the placement turns about, so however it is
  // turned or scaled it stays put. Only its lift moves.
  assert.deepEqual([post.gx, post.gy, post.lift], [0, 0, 2]);
  assert.equal(post.rot, 180);
  assert.deepEqual([post.scaleX, post.scaleY, post.scaleZ], [2, 3, 2]);
  // Twice as wide, then on its side: twice as tall, and overhanging its tile
  // by half a tile each way, since it turned about its middle.
  assert.deepEqual(prefabFootprint(tall, { gx: 0, gy: 0, rot: 90, scaleX: 2 }), { w: 1, h: 2 });
  assert.deepEqual(prefabBounds(tall, { gx: 3, gy: 3, rot: 90, scaleX: 2 }), {
    gx: 3,
    gy: 2.5,
    w: 1,
    h: 2,
  });
});
