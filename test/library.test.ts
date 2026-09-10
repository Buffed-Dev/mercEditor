import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataDocument } from '../Engine/editor/dataDocument.ts';
import { libraryWrites } from '../Engine/editor/serializeData.ts';
import { filterRows, libraryRows, thumbFor, visibleRows } from '../Engine/editor/rules/libraryTree.ts';

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

// ------------------------------------------------------------------- the tree

const scan = {
  tree: [
    { path: 'Materials', dir: true },
    { path: 'Materials/Wood', dir: true },
    { path: 'Materials/Wood/material.json', size: 300 },
    { path: 'Materials/Wood/diffuse.png', size: 900 },
    { path: 'Materials/Wood/spare.png', size: 40 },
    { path: 'Materials/Broken', dir: true },
    { path: 'Materials/Broken/material.json', size: 12 },
    { path: 'loose.png', size: 10 },
  ],
  records: [],
  errors: [{ path: 'Materials/Broken/material.json', message: 'Unexpected token }' }],
};

const held = {
  materials: [
    { id: 'wood', label: 'Wood', path: 'Materials/Wood', texture: 'diffuse.png', bump: 'gone.png' },
  ],
};

test('the tree says which files nothing has claimed, and which are missing', () => {
  const rows = libraryRows(scan, held);
  const at = (path: string) => rows.find((row) => row.path === path);

  // A folder holding a record file *is* the record: one row, named by the
  // record, not two rows saying the same thing.
  const wood = at('Materials/Wood');
  assert.equal(wood?.row, 'record');
  assert.equal(wood?.row === 'record' && wood.label, 'Wood');
  assert.equal(at('Materials/Wood/material.json'), undefined, 'the record file is not its own row');

  // The two disagreements this panel exists to show.
  const claimed = at('Materials/Wood/diffuse.png');
  assert.equal(claimed?.row === 'file' && claimed.used, true);
  const orphan = at('Materials/Wood/spare.png');
  assert.equal(orphan?.row === 'file' && orphan.used, false, 'a file no record names');
  assert.deepEqual(wood?.row === 'record' && wood.missing, ['Materials/Wood/gone.png']);

  // A record that will not parse is a row that says so, not a thrown error.
  assert.equal(at('Materials/Broken/material.json')?.row, 'broken');
  // And the folder above it is still a plain folder, because the document has
  // no record for it -- which is exactly what "will not parse" means.
  assert.equal(at('Materials/Broken')?.row, 'folder');

  // Depth is the indent, taken from the path rather than tracked in the walk.
  assert.equal(at('Materials')?.depth, 0);
  assert.equal(at('Materials/Wood')?.depth, 1);
  assert.equal(at('loose.png')?.depth, 0);
});

test('an effect claims the picture it plays, which no field table declares', () => {
  // The four tables an effect is built from are gathered by its own editor, so
  // there is no `file` field to find `sheet.image` by. Missed, the sheet an
  // effect plays reads as a file nothing wants.
  const rows = libraryRows(
    {
      tree: [
        { path: 'Effects/Slash', dir: true },
        { path: 'Effects/Slash/effect.json', size: 100 },
        { path: 'Effects/Slash/sheet.png', size: 900 },
      ],
      records: [],
      errors: [],
    },
    { vfx: [{ id: 'slash', label: 'Slash', path: 'Effects/Slash', sheet: { image: 'sheet.png' } }] },
  );
  const sheet = rows.find((row) => row.path === 'Effects/Slash/sheet.png');
  assert.equal(sheet?.row === 'file' && sheet.used, true);
});

test('a picture still held inline is not a file on disk', () => {
  // Before the migration an effect carried its sheet as base64. One that still
  // does names no file, and must not claim one.
  const rows = libraryRows(
    {
      tree: [
        { path: 'Effects/Old', dir: true },
        { path: 'Effects/Old/sheet.png', size: 900 },
      ],
      records: [],
      errors: [],
    },
    { vfx: [{ id: 'old', label: 'Old', path: 'Effects/Old', sheet: { image: 'data:image/png;base64,AAAA' } }] },
  );
  const sheet = rows.find((row) => row.path === 'Effects/Old/sheet.png');
  assert.equal(sheet?.row === 'file' && sheet.used, false);
});

test('filtering to a kind keeps the folders that lead to it', () => {
  const rows = libraryRows(scan, held);
  const paths = filterRows(rows, new Set(['materials'])).map((row) => row.path);
  // The match, and the way down to it. A match you cannot see the path to is a
  // match you cannot find.
  assert.ok(paths.includes('Materials/Wood'));
  assert.ok(paths.includes('Materials'));
  // Its files are not materials, so they go.
  assert.ok(!paths.includes('Materials/Wood/diffuse.png'));
  // And a folder leading nowhere goes with them, or the filter is a highlight.
  assert.ok(!paths.includes('Materials/Broken'));

  // Files are a kind of their own, being what is left over.
  const files = filterRows(rows, new Set(['files'])).map((row) => row.path);
  assert.ok(files.includes('loose.png'));
  assert.ok(files.includes('Materials/Wood/spare.png'));
  // The record above it survives as the way down to it, not as a match: a file
  // shown with no path to it is a file you cannot find. What is dropped is the
  // record that leads to no file at all.
  assert.ok(files.includes('Materials/Wood'));
  assert.ok(!files.includes('Materials/Broken'));
});

test('a collapsed folder hides what is under it, and nothing else', () => {
  const rows = libraryRows(scan, held);
  const paths = visibleRows(rows, new Set(['Materials/Wood'])).map((row) => row.path);
  assert.ok(paths.includes('Materials/Wood'), 'the folder itself still shows');
  assert.ok(!paths.includes('Materials/Wood/diffuse.png'));
  assert.ok(paths.includes('Materials/Broken'), 'a sibling is untouched');
});

test('a row shows a picture it already has, or admits it has none', () => {
  const held2 = {
    materials: [
      { id: 'wood', label: 'Wood', path: 'Materials/Wood', texture: 'diffuse.png' },
      { id: 'plain', label: 'Plain', path: 'Materials/Plain', color: 0x336699 },
    ],
    terrains: [{ id: 'floor', label: 'Floor', path: 'Terrain/Floor', top: 'wood' }],
    props: [{ id: 'crate', label: 'Crate', path: 'Objects/Crate', mesh: 'crate.glb' }],
    vfx: [{ id: 'slash', label: 'Slash', path: 'Effects/Slash', sheet: { image: 'sheet.png' } }],
  };
  const rows = libraryRows(
    {
      tree: [
        { path: 'Materials/Wood', dir: true },
        { path: 'Materials/Wood/diffuse.png', size: 1 },
        { path: 'Materials/Plain', dir: true },
        { path: 'Terrain/Floor', dir: true },
        { path: 'Objects/Crate', dir: true },
        { path: 'Objects/Crate/crate.glb', size: 1 },
        { path: 'Effects/Slash', dir: true },
      ],
      records: [],
      errors: [],
    },
    held2,
  );
  const thumb = (path: string) => thumbFor(rows.find((row) => row.path === path)!, held2);

  assert.deepEqual(thumb('Materials/Wood'), { src: 'Materials/Wood/diffuse.png' });
  // A terrain has no picture of its own: it wears materials, so the thumbnail
  // is one hop through the one it names.
  assert.deepEqual(thumb('Terrain/Floor'), { src: 'Materials/Wood/diffuse.png' });
  assert.deepEqual(thumb('Effects/Slash'), { src: 'Effects/Slash/sheet.png' });
  // A material with no map is still a colour, which is all it looks like.
  assert.deepEqual(thumb('Materials/Plain'), { color: 0x336699 });

  // A file is its own picture, and a model is not a picture at all -- an object
  // naming only a .glb keeps its glyph rather than being given a wrong one.
  assert.deepEqual(thumb('Materials/Wood/diffuse.png'), { src: 'Materials/Wood/diffuse.png' });
  assert.equal(thumb('Objects/Crate'), null);
  assert.equal(thumb('Objects/Crate/crate.glb'), null);
});
