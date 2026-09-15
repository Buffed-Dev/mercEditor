import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDraftStore, cleanRel, typeOfName } from '../draftStore.js';

type Entry = { path: string; dir: boolean; draft?: boolean };

/** A game folder with a little published content, and a store over it. */
async function game() {
  const dir = await mkdtemp(join(tmpdir(), 'merc-draft-'));
  await mkdir(join(dir, 'assets/Terrain/Grass'), { recursive: true });
  await mkdir(join(dir, 'maps'), { recursive: true });
  await writeFile(join(dir, 'assets/Terrain/Grass/grass.block.json'), '{"id":"grass"}');
  await writeFile(join(dir, 'assets/Terrain/Grass/top.png'), 'PNG');
  await writeFile(join(dir, 'assets/Terrain/Grass/top.png.meta'), '{"id":"ftop"}');
  await writeFile(join(dir, 'maps/base.js'), 'export const BASE = {};');
  const store = createDraftStore(dir);
  const paths = async () => ((await store.list('assets')) as Entry[]).map((e) => e.path);
  return { dir, store, paths, done: () => rm(dir, { recursive: true, force: true }) };
}

const exists = (path: string) => stat(path).then(() => true, () => false);

test('paths outside assets/ and maps/ are refused', () => {
  assert.equal(cleanRel('assets/Terrain/a.png'), 'assets/Terrain/a.png');
  assert.equal(cleanRel('rules/items.js'), null);
  assert.equal(cleanRel('assets/../game.js'), null);
  assert.equal(cleanRel('assets/.draft/x'), null);
  assert.equal(cleanRel('assets/C:/x'), null);
});

test('a file type comes from its name', () => {
  assert.equal(typeOfName('fire.effect.json'), 'effect');
  assert.equal(typeOfName('grass.block.json'), 'block');
  assert.equal(typeOfName('Rock.GLB'), 'model');
  assert.equal(typeOfName('a.png.meta'), 'meta');
  assert.equal(typeOfName('notes.txt'), null);
});

test('a draft write shadows the published file and leaves the game alone', async () => {
  const { dir, store, done } = await game();
  try {
    await store.apply([{ op: 'write', path: 'assets/Terrain/Grass/grass.block.json', text: '{"id":"grass","v":2}' }]);
    assert.equal(String(await store.read('assets/Terrain/Grass/grass.block.json')), '{"id":"grass","v":2}');
    assert.equal(await readFile(join(dir, 'assets/Terrain/Grass/grass.block.json'), 'utf8'), '{"id":"grass"}');
  } finally {
    await done();
  }
});

test('a move takes a folder, sidecars and all, and only in the draft', async () => {
  const { dir, store, paths, done } = await game();
  try {
    await store.apply([{ op: 'mkdir', path: 'assets/Blocks' }, { op: 'move', from: 'assets/Terrain/Grass', to: 'assets/Blocks/Grass' }]);
    const seen = await paths();
    assert.ok(seen.includes('assets/Blocks/Grass/top.png.meta'));
    assert.ok(!seen.includes('assets/Terrain/Grass/top.png'));
    assert.ok(await exists(join(dir, 'assets/Terrain/Grass/top.png')));
  } finally {
    await done();
  }
});

test('deleting a folder and making it again does not bring its old files back', async () => {
  const { store, paths, done } = await game();
  try {
    await store.apply([{ op: 'delete', path: 'assets/Terrain/Grass' }]);
    await store.apply([{ op: 'mkdir', path: 'assets/Terrain/Grass' }]);
    const seen = await paths();
    assert.ok(seen.includes('assets/Terrain/Grass'));
    assert.ok(!seen.includes('assets/Terrain/Grass/top.png'));
  } finally {
    await done();
  }
});

test('a move onto something that is there is refused unless told to replace it', async () => {
  const { store, done } = await game();
  try {
    await store.apply([{ op: 'write', path: 'assets/Terrain/other.png', text: 'X' }]);
    await assert.rejects(store.apply([{ op: 'move', from: 'assets/Terrain/other.png', to: 'assets/Terrain/Grass/top.png' }]), /already there/);
    await store.apply([{ op: 'move', from: 'assets/Terrain/other.png', to: 'assets/Terrain/Grass/top.png', overwrite: true }]);
    assert.equal(String(await store.read('assets/Terrain/Grass/top.png')), 'X');
  } finally {
    await done();
  }
});

test('a stashed delete is restored by undo, drafted and published files alike', async () => {
  const { store, paths, done } = await game();
  try {
    await store.apply([{ op: 'write', path: 'assets/Terrain/Grass/new.png', text: 'NEW' }]);
    await store.apply([
      { op: 'delete', path: 'assets/Terrain/Grass/new.png', stash: 's1' },
      { op: 'delete', path: 'assets/Terrain/Grass/top.png', stash: 's1' },
    ]);
    assert.ok(!(await paths()).includes('assets/Terrain/Grass/new.png'));
    assert.ok(!(await paths()).includes('assets/Terrain/Grass/top.png'));
    await store.apply([
      { op: 'restore', path: 'assets/Terrain/Grass/top.png', stash: 's1' },
      { op: 'restore', path: 'assets/Terrain/Grass/new.png', stash: 's1' },
    ]);
    assert.equal(String(await store.read('assets/Terrain/Grass/new.png')), 'NEW');
    assert.equal(String(await store.read('assets/Terrain/Grass/top.png')), 'PNG');
  } finally {
    await done();
  }
});

test('publish applies the draft to the game and removes the draft folder', async () => {
  const { dir, store, done } = await game();
  try {
    await store.apply([
      { op: 'delete', path: 'assets/Terrain/Grass/top.png' },
      { op: 'write', path: 'assets/Terrain/sand.block.json', text: '{"id":"sand"}' },
      { op: 'write', path: 'maps/base.js', text: 'export const BASE = { v: 2 };' },
      { op: 'mkdir', path: 'assets/Empty' },
    ]);
    assert.ok((await store.pending()).count > 0);
    await store.publish();
    assert.ok(!(await exists(join(dir, 'assets/Terrain/Grass/top.png'))));
    assert.equal(await readFile(join(dir, 'assets/Terrain/sand.block.json'), 'utf8'), '{"id":"sand"}');
    assert.match(await readFile(join(dir, 'maps/base.js'), 'utf8'), /v: 2/);
    assert.ok(await exists(join(dir, 'assets/Empty')));
    assert.ok(!(await exists(join(dir, '.draft'))));
    assert.equal((await store.pending()).count, 0);
  } finally {
    await done();
  }
});
