import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_FIELDS,
  ASSET_KIND_KEYS,
  assetFrames,
  assetKeys,
  defaultAsset,
  kindOfFile,
  normalizeAsset,
} from '../Engine/src/data/assets.ts';
import {
  blockedTiles,
  defaultProp,
  normalizeProp,
  standHeights,
} from '../Engine/src/data/props.ts';
import { safeFileName } from '../Engine/editor/uploadAsset.js';
import { serializeRules } from '../Engine/editor/serializeData.js';
import { serializeMap } from '../Engine/editor/serialize.js';
import { mapDoc } from './helpers/terrainFixtures.ts';

/**
 * The parts of the assets feature that are not Babylon: what a record is, what
 * a filename is allowed to be, which tiles an object closes off, and the two
 * files all of it has to survive a round trip through.
 *
 * Whether a model *looks* right is not testable here and is not worth
 * pretending otherwise; that is what the stage in the workspace is for.
 */

test('an asset carries only the fields of the kind it is', () => {
  const mesh = normalizeAsset({ id: 'rock', kind: 'mesh', file: 'rock.glb' });
  assert.ok(assetKeys(mesh).includes('scale'));
  assert.ok(!assetKeys(mesh).includes('uScale'));

  // Switching kind drops the old kind's settings rather than carrying them:
  // a texture has no rotation, and a key nobody reads is a key in every diff.
  const asTexture = normalizeAsset({ ...mesh, kind: 'texture' });
  assert.equal(asTexture.rotX, undefined);
  assert.equal(asTexture.uScale, 1);
  // What it is and where it lives survive the change; only the dials go.
  assert.equal(asTexture.id, 'rock');
  assert.equal(asTexture.file, 'rock.glb');

  // A kind nobody defines falls back rather than producing a record with no
  // fields at all.
  assert.equal(normalizeAsset({ id: 'x', kind: 'nonsense' }).kind, 'mesh');
});

test('every kind has a default for every field it declares', () => {
  for (const kind of ASSET_KIND_KEYS) {
    const made = defaultAsset('x', kind);
    for (const key of Object.keys(ASSET_FIELDS[kind])) {
      assert.notEqual(made[key], undefined, `${kind}.${key} has a default`);
    }
  }
});

test('the kind of a file follows from its extension', () => {
  assert.equal(kindOfFile('rock.glb'), 'mesh');
  assert.equal(kindOfFile('ROCK.GLTF'), 'mesh');
  assert.equal(kindOfFile('bark.png'), 'texture');
  assert.equal(kindOfFile('no-extension'), 'texture');
});

test('a filename is cleaned up rather than refused', () => {
  assert.equal(safeFileName('rock.glb'), 'rock.glb');
  // What a modelling tool actually writes: spaces and brackets are fine, a
  // slash is not — that one would be a path rather than a name.
  assert.equal(safeFileName('rock (final)(2).glb'), 'rock _final__2_.glb');
  assert.equal(safeFileName('../../etc/passwd.png'), 'asset ______etc_passwd.png');
  // A kind of file nothing can read is refused outright: there is no sensible
  // name to give it, because it is not an asset.
  assert.equal(safeFileName('notes.txt'), '');
  assert.equal(safeFileName('model.blend'), '');
});

test('a sprite sheet clip stays inside its own grid', () => {
  assert.deepEqual(assetFrames({ columns: 5, rows: 5, frameFrom: 5, frames: 5 }), {
    columns: 5,
    rows: 5,
    first: 5,
    count: 5,
  });
  // 0 frames is the rest of the sheet, which saves counting a whole one.
  assert.equal(assetFrames({ columns: 4, rows: 2, frameFrom: 0, frames: 0 }).count, 8);
  // Nothing runs off the end, and at least one frame always plays.
  assert.equal(assetFrames({ columns: 4, rows: 2, frameFrom: 6, frames: 99 }).count, 2);
  assert.equal(assetFrames({ columns: 4, rows: 2, frameFrom: 99, frames: 3 }).first, 7);
  assert.equal(assetFrames({}).count, 1);
});

test('an object fills in what it left out, and keeps what it said', () => {
  const bare = normalizeProp({ id: 'barrel' });
  assert.equal(bare.label, 'barrel');
  assert.equal(bare.mesh, '');
  // White, because a tint multiplies: the default has to be "leave it alone".
  assert.equal(bare.tint, 0xffffff);
  assert.equal(bare.blocks, false);
  assert.equal(bare.shadow, true);

  // false is a value, not an absence — the ?? in a normalizer is the usual way
  // this goes wrong, and a prop that would not stop casting a shadow is how it
  // would show up.
  assert.equal(normalizeProp({ id: 'x', shadow: false }).shadow, false);
  assert.deepEqual(Object.keys(normalizeProp({ id: 'x', stray: 1 })), Object.keys(defaultProp('x')));
});

test('an object can be a sprite sheet instead of a model', () => {
  const flame = normalizeProp({ id: 'flame', sheet: 'fire' });
  assert.equal(flame.mesh, '');
  assert.equal(flame.sheet, 'fire');
  // Facing the camera is what makes a flat frame read as a thing standing up,
  // so it is on unless someone says otherwise — a floor decal, say.
  assert.equal(flame.billboard, true);
  assert.equal(normalizeProp({ id: 'x', sheet: 'fire', billboard: false }).billboard, false);

  // An object naming both is a model. Said here as well as in the renderer
  // because it is a rule about the data, not about how it happens to be drawn.
  const both = normalizeProp({ id: 'x', mesh: 'rock', sheet: 'fire' });
  assert.equal(both.mesh, 'rock');
  assert.equal(both.sheet, 'fire');
});

test('only the objects that block close a tile off', () => {
  // Reads the game's own list, which is empty in a test run — so an id nothing
  // defines blocks nothing, which is the safe direction to be wrong in.
  assert.equal(blockedTiles([{ gx: 1, gy: 2, id: 'nothing' }]).size, 0);
  assert.equal(blockedTiles([]).size, 0);
  assert.equal(blockedTiles(undefined).size, 0);
});

test('both rules files parse back to what went in', async () => {
  const assets = [
    normalizeAsset({ id: 'rock', label: 'Rock', kind: 'mesh', file: 'rock.glb', scale: 2 }),
    normalizeAsset({ id: 'bark', kind: 'texture', file: 'bark.png', uScale: 4 }),
    normalizeAsset({ id: 'fire', kind: 'sheet', file: 'fire.png', columns: 5, rows: 5 }),
  ];
  const props = [normalizeProp({ id: 'boulder', mesh: 'rock', texture: 'bark', blocks: true })];

  for (const [kind, list] of [
    ['assets', assets],
    ['props', props],
  ]) {
    const source = serializeRules(kind, list);
    const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    const read = Object.values(module)[0];
    assert.deepEqual(read, list, `${kind} survived the round trip`);
  }
});

test('a map remembers which object stands on which tile, and which way', () => {
  const source = serializeMap({
    ...mapDoc(['....', '....'], { id: 'yard', name: 'Yard' }),
    props: [
      { gx: 1, gy: 2, id: 'boulder' },
      { gx: 3, gy: 0, id: 'boulder', rot: 90 },
      { gx: 3, gy: 0, id: 'boulder', lift: 1.5 },
    ],
  });
  // A turn of nothing is not written, so the ordinary case stays one line.
  assert.match(source, /\{ gx: 1, gy: 2, id: 'boulder' \},/);
  assert.match(source, /\{ gx: 3, gy: 0, id: 'boulder', rot: 90 \},/);
  // Standing one on top of another: the height is the placement's, not the
  // object's, so two of the same thing can be at two heights.
  assert.match(source, /\{ gx: 3, gy: 0, id: 'boulder', lift: 1.5 \},/);
});

test('an object list group is written on the objects, not kept in a list of its own', () => {
  const source = serializeMap({
    ...mapDoc(['....', '....'], { id: 'yard', name: 'Yard' }),
    props: [{ gx: 1, gy: 2, id: 'boulder', group: 'North wall' }],
    torches: [{ gx: 0, gy: 0, face: '+x', radius: 5, group: 'North wall' }],
    lights: [{ type: 'point', gx: 2, gy: 2, radius: 6, group: 'North wall' }],
    monsters: [{ gx: 3, gy: 1, kind: 'grunt' }],
  });
  assert.match(source, /id: 'boulder', group: 'North wall'/);
  assert.match(source, /radius: 5, group: 'North wall'/);
  // A light writes whatever fields it happens to have, so the one string among
  // its numbers has to come out quoted.
  assert.match(source, /radius: 6, group: 'North wall'/);
  // Ungrouped things say nothing, so a map nobody has organised is untouched.
  assert.match(source, /\{ gx: 3, gy: 1, kind: 'grunt' \},/);
});

test('a flat-topped object raises the tile it stands on', () => {
  const defs = { crate: { top: 1 }, barrel: { top: 0 } };
  const lookup = (id) => defs[id] ?? null;

  // Two crates on one tile: the top of the upper one, not the two added up.
  const tops = standHeights(
    [
      { gx: 2, gy: 3, id: 'crate' },
      { gx: 2, gy: 3, id: 'crate', lift: 1 },
      { gx: 5, gy: 5, id: 'barrel' },
      { gx: 6, gy: 6, id: 'nothing' },
    ],
    lookup,
  );
  assert.equal(tops.get('2,3'), 2);
  // Something with no flat top is something you walk around, so its tile is
  // untouched — and an id nothing defines contributes nothing rather than
  // throwing.
  assert.equal(tops.get('5,5'), undefined);
  assert.equal(tops.size, 1);
});

test('a map remembers how high its start is, and says nothing when it is on the ground', () => {
  const on = serializeMap(mapDoc(['..', '..'], { id: 'y', name: 'Y', startZ: 2 }));
  assert.match(on, /startZ: 2,/);
  const off = serializeMap(mapDoc(['..', '..'], { id: 'y', name: 'Y' }));
  assert.ok(!off.includes('startZ'));
});
