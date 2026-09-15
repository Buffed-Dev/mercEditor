import test from 'node:test';
import assert from 'node:assert/strict';
import {
  childrenOf,
  crumbs,
  displayName,
  fileNameFor,
  keepBothName,
  recordFromFile,
  recordPath,
  recordText,
  typeOfName,
  usedBy,
  validate,
} from '../Engine/editor/assets/model.ts';

/** The Assets panel's rules that are not React: names, order and references. */

test('a folder lists its folders first, then everything else A to Z', () => {
  const entries = [
    { path: 'Terrain/b.png', dir: false },
    { path: 'Terrain/Zeta', dir: true },
    { path: 'Terrain/a10.png', dir: false },
    { path: 'Terrain/a2.png', dir: false },
    { path: 'Terrain/Alpha', dir: true },
    { path: 'Other/x.png', dir: false },
  ];
  assert.deepEqual(
    childrenOf(entries, 'Terrain').map((entry) => entry.path),
    ['Terrain/Alpha', 'Terrain/Zeta', 'Terrain/a2.png', 'Terrain/a10.png', 'Terrain/b.png'],
  );
});

test('an asset is shown by its name, and renaming keeps what kind of file it is', () => {
  assert.equal(typeOfName('fire.effect.json'), 'effect');
  assert.equal(typeOfName('grass.block.json'), 'block');
  assert.equal(typeOfName('rock.GLB'), 'model');
  assert.equal(displayName({ path: 'A/grass.material.json', type: 'material' }), 'grass');
  assert.equal(displayName({ path: 'A/rock.glb', type: 'model' }), 'rock');
  assert.equal(fileNameFor({ path: 'A/grass.material.json', type: 'material' }, 'dirt'), 'dirt.material.json');
  assert.equal(fileNameFor({ path: 'A/rock.glb', type: 'model' }, 'stone'), 'stone.glb');
});

test('keeping both finds the first free numbered name', () => {
  const taken = new Set(['rock (1).glb']);
  assert.equal(keepBothName('rock.glb', (name) => taken.has(name)), 'rock (2).glb');
  assert.equal(keepBothName('grass.material.json', () => false), 'grass (1).material.json');
});

test('breadcrumbs walk from Assets down to the folder', () => {
  assert.deepEqual(crumbs('Terrain/Grass'), [
    { name: 'Assets', path: '' },
    { name: 'Terrain', path: 'Terrain' },
    { name: 'Grass', path: 'Terrain/Grass' },
  ]);
});

test('a record file holds neither its name nor its folder', () => {
  const record = recordFromFile('Terrain/Grass/grass.block.json', 'block', { id: 'grass', top: 'mat1', tags: [] });
  assert.equal(record.label, 'grass');
  assert.equal(record.path, 'Terrain/Grass');
  assert.equal(recordPath('block', record), 'Terrain/Grass/grass.block.json');
  assert.deepEqual(JSON.parse(recordText(record)), { id: 'grass', top: 'mat1' });
});

test('what uses an id, and what would block a publish', () => {
  const lists = {
    materials: [{ id: 'mat1', label: 'grass', path: 'M', texture: 'ftex' }],
    terrains: [{ id: 'grass', label: 'grass', path: 'T', top: 'mat1', defaultSideProfile: 'soft' }],
    profiles: [{ id: 'soft', label: 'soft', path: 'P', edge: 'fmesh' }],
    prefabs: [{ id: 'camp', label: 'camp', path: 'P', props: [{ id: 'fmesh', gx: 0, gy: 0 }] }],
  };
  assert.deepEqual(usedBy('mat1', lists).map((user) => user.id), ['grass']);
  assert.deepEqual(
    usedBy('fmesh', lists, [{ id: 'base', value: { prefabs: [] } }]).map((user) => user.id).sort(),
    ['camp', 'soft'],
  );
  assert.deepEqual(usedBy('soft', lists).map((user) => user.id), ['grass']);

  const props = [{ id: 'fmesh', label: 'rock', path: 'M' }];
  assert.deepEqual(validate({ ...lists, props }, new Set(['ftex', 'fmesh'])), []);
  const missing = validate({ ...lists, props: [] }, new Set(['ftex']));
  assert.equal(missing.length, 2);
  const said = missing.map((problem) => problem.message).join('\n');
  assert.match(said, /file that is not there \(fmesh\)/);
  assert.match(said, /model that is not there \(fmesh\)/);
});
