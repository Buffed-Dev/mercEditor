import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataDocument } from '../Engine/editor/dataDocument.ts';
import { libraryWrites } from '../Engine/editor/serializeData.ts';

/**
 * The library as folders: where a record lives, what moving it costs, and what
 * would break if it went away.
 *
 * The filesystem half is not here — that is the dev server's, and it is poked
 * over HTTP. What is testable is the half that has to agree with it afterwards.
 */

const doc = () =>
  createDataDocument({
    materials: [
      { id: 'wood', label: 'Wood', path: 'Materials/Wood', texture: 'diffuse.png' },
      { id: 'stone', label: 'Stone', path: 'Materials/Stone' },
    ],
    props: [{ id: 'crate', label: 'Crate', path: 'Objects/Crate', material: 'wood' }],
    terrains: [{ id: 'floor', label: 'Floor', char: 'fl', path: 'Terrain/Floor', top: 'wood' }],
    vfx: [{ id: 'fire', label: 'Fire', path: 'Effects/Fire' }],
    abilities: [{ id: 'burn', label: 'Burn', vfx: 'fire' }],
  });

const pathOf = (d: ReturnType<typeof doc>, list: string, id: string) =>
  String(d.list(list).find((r) => r.id === id)?.path ?? '');

test('a record moves to another folder, and its files go with it', () => {
  const d = doc();
  assert.equal(d.setPath('materials', 0, 'Materials/Old/Wood'), null);
  assert.equal(pathOf(d, 'materials', 'wood'), 'Materials/Old/Wood');
  // The filename is untouched: it is relative to the folder, which is the whole
  // reason a move rewrites nothing inside the record.
  assert.equal(d.list('materials')[0].texture, 'diffuse.png');
});

test('moving a folder is not something undo takes back', () => {
  // The bytes are elsewhere the moment the move returns and nothing here can
  // fetch them home. A path an undo restored would name a folder that is not
  // there, and the only symptom would be a picture that stopped loading.
  const d = doc();
  d.update('materials', 0, { roughness: 0.25 });
  assert.equal(d.setPath('materials', 0, 'Materials/Old/Wood'), null);

  assert.ok(d.undo(), 'there was an edit to undo');
  assert.equal(d.list('materials')[0].roughness, 0.8, 'the edit was undone');
  assert.equal(
    pathOf(d, 'materials', 'wood'),
    'Materials/Old/Wood',
    'the folder stayed where the filesystem put it',
  );

  assert.ok(d.redo());
  assert.equal(pathOf(d, 'materials', 'wood'), 'Materials/Old/Wood');
});

test('a move chases the references that name a file from the assets root', () => {
  // A leading slash is the escape hatch for a file two folders share. It is the
  // one kind of reference a move has to rewrite; everything else is relative
  // and travels along.
  const d = createDataDocument({
    materials: [{ id: 'shared', label: 'Shared', path: 'Materials/Shared', texture: 'noise.png' }],
    props: [{ id: 'crate', label: 'Crate', path: 'Objects/Crate', texture: '/Materials/Shared/noise.png' }],
  });

  assert.equal(d.setPath('materials', 0, 'Materials/Common'), null);
  assert.equal(d.list('props')[0].texture, '/Materials/Common/noise.png');
  // Its own relative name is left alone.
  assert.equal(d.list('materials')[0].texture, 'noise.png');
});

test('a folder two records could share is refused', () => {
  const d = doc();
  assert.match(String(d.setPath('materials', 0, 'Materials/Stone')), /already at/);
  // Case-blind, because on Windows these are one directory and the second
  // record would land on the first's files.
  assert.match(String(d.setPath('materials', 0, 'materials/stone')), /already at/);
  assert.equal(pathOf(d, 'materials', 'wood'), 'Materials/Wood', 'refused and unchanged');
});

test('a folder name that could not be written is refused before the request', () => {
  const d = doc();
  for (const bad of ['', '   ', '../escape', 'Materials/../..', '.hidden/x', 'a\\b']) {
    assert.ok(d.setPath('materials', 0, bad), `"${bad}" was allowed`);
  }
  assert.equal(pathOf(d, 'materials', 'wood'), 'Materials/Wood');
  // Trailing and leading slashes are tidied rather than refused: they are a
  // typo, not an attack.
  assert.equal(d.setPath('materials', 0, '/Materials/Timber/'), null);
  assert.equal(pathOf(d, 'materials', 'wood'), 'Materials/Timber');
});

test('deleting a record can say what it would break', () => {
  const d = doc();
  const users = d.usedBy('materials', 0).map((one) => `${one.list}:${one.id}`).sort();
  assert.deepEqual(users, ['props:crate', 'terrains:floor']);

  // An ability names the flash it throws, which is not one of the field tables
  // the walk above covers and so is spelled out.
  assert.deepEqual(
    d.usedBy('vfx', 0).map((one) => `${one.list}:${one.id}`),
    ['abilities:burn'],
  );

  // Nothing in the rules names an object -- only maps do, and this document has
  // never opened one. An empty answer means "nothing in the rules", which is
  // what whatever asks has to say.
  assert.deepEqual(d.usedBy('props', 0), []);
});

test('a new record is given a folder, so a save cannot skip it', () => {
  const d = doc();
  const made = d.add('materials');
  assert.ok(made);
  const record = d.list('materials')[made.index];
  assert.match(String(record.path), /^Materials\//);

  // And it is written where that says, with `path` stripped: the folder says
  // where the record is, so a copy inside it would be a second answer.
  const written = libraryWrites(d.data);
  const mine = written.find((one) => one.path === `${String(record.path)}/material.json`);
  assert.ok(mine, 'the new record was written');
  assert.ok(!('path' in (mine.record as Record<string, unknown>)), '`path` was not written');
});

test('a record with nowhere to live is skipped rather than written to the root', () => {
  // The assets root is where files nothing has claimed sit. A record dropped
  // there would be in no folder and findable by no glob.
  const d = createDataDocument({ materials: [{ id: 'homeless', label: 'Homeless' }] });
  assert.deepEqual(libraryWrites(d.data), []);
});
