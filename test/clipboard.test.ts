import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../Engine/editor/document.ts';
import { clipboardSize, copyObjects, pasteObjects } from '../Engine/editor/clipboard.ts';
import type { GameMap } from '../Engine/src/data/mapFormat.ts';
import { mapDoc } from './helpers/terrainFixtures.ts';

/**
 * Copy and paste: what is remembered, and where it lands.
 *
 * The clipboard is a prefab without a name, so most of the arithmetic is
 * already tested next door. What is here is the part that is only true of a
 * clipboard — that it keeps the shape of what was taken, that it puts it down
 * by its corner, and that it refuses rather than clipping when the shape would
 * not fit.
 */

const yard = () =>
  createDocument({
    ...mapDoc(['......', '......', '......'], { id: 'yard' }),
    props: [
      { gx: 1, gy: 1, id: 'fire' },
      { gx: 3, gy: 1, id: 'pot' },
      { gx: 5, gy: 2, id: 'other' },
    ],
    vfx: [{ gx: 1, gy: 2, id: 'smoke' }],
  } as GameMap);

test('a copy keeps the shape of what was taken, not where it was', () => {
  const doc = yard();
  assert.equal(copyObjects(doc, new Set(['props:0', 'props:1', 'vfx:0']), null), 3);
  assert.equal(clipboardSize(), 3);

  // Pasted at the origin, the gaps between them are what they were: the fire
  // and the pot two tiles apart, the torch one row down.
  assert.equal(pasteObjects(doc, 0, 0), null);
  assert.deepEqual(
    doc.map.props.slice(3).map((one) => [one.gx, one.gy, one.id]),
    [
      [0, 0, 'fire'],
      [2, 0, 'pot'],
    ],
  );
  assert.deepEqual(
    doc.map.vfx.slice(1).map((one) => [one.gx, one.gy, one.id]),
    [[0, 1, 'smoke']],
  );
});

test('a paste lands with its corner on the tile you point at', () => {
  const doc = yard();
  copyObjects(doc, new Set(['props:0', 'props:1']), null);
  assert.equal(pasteObjects(doc, 2, 2), null);
  assert.deepEqual(
    doc.map.props.slice(3).map((one) => [one.gx, one.gy]),
    [
      [2, 2],
      [4, 2],
    ],
  );
});

test('the original is left where it is', () => {
  const doc = yard();
  copyObjects(doc, new Set(['props:0']), null);
  pasteObjects(doc, 4, 0);
  assert.deepEqual(doc.map.props[0], { gx: 1, gy: 1, id: 'fire' }, 'copy is not cut');
  assert.equal(doc.map.props.length, 4);
});

test('one paste is one undo step, however many objects it was', () => {
  const doc = yard();
  copyObjects(doc, new Set(['props:0', 'props:1', 'vfx:0']), null);
  pasteObjects(doc, 0, 0);
  assert.equal(doc.map.props.length, 5);

  doc.undo();
  assert.equal(doc.map.props.length, 3, 'all of it went back together');
  assert.equal(doc.map.vfx.length, 1);
});

test('a paste that would fall off the map is refused, not clipped', () => {
  // Half a paste landing silently is the one outcome worth a message: a map
  // cannot hold a tile that is not on it, and the serializer would write
  // coordinates no grid can read back.
  const doc = yard();
  copyObjects(doc, new Set(['props:0', 'props:1']), null);
  const before = doc.map.props.length;

  assert.match(String(pasteObjects(doc, 5, 0)), /off the map/);
  assert.equal(doc.map.props.length, before, 'and nothing was written');
});

test('copy falls back to the one thing selected', () => {
  // Ctrl+C with something chosen means that thing. Asking you to pick it a
  // second way first would be a rule with nothing behind it.
  const doc = yard();
  assert.equal(copyObjects(doc, new Set(), { list: 'props', index: 2 }), 1);
  assert.equal(pasteObjects(doc, 0, 0), null);
  assert.equal(doc.map.props.at(-1)?.id, 'other');
});

test('nothing picked and nothing selected copies nothing', () => {
  const doc = yard();
  assert.equal(copyObjects(doc, new Set(), null), 0);
});

test('a spawn is not something you can copy', () => {
  // It is a name for a tile rather than a thing standing on one, so there is
  // nothing to put down a second time.
  const doc = yard();
  doc.nameSpawn('start', 2, 2);
  assert.equal(copyObjects(doc, new Set(['spawns:start']), null), 0);
});
