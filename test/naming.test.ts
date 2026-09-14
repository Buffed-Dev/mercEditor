import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataDocument, idFromLabel } from '../Engine/editor/dataDocument.ts';
import { blankMap, createDocument } from '../Engine/editor/document.ts';
import { serializeMap } from '../Engine/editor/serialize.ts';
import { decodeTerrain } from '../Engine/src/data/terrain/codec.ts';

/**
 * Two things the editor now does that a file has to survive: a record called
 * what it was named, and a grid whose cells are wider than one character.
 */

test('a name becomes the id somebody would have typed', () => {
  assert.equal(idFromLabel('Stone Wall'), 'stoneWall');
  assert.equal(idFromLabel('rock (final)(2)'), 'rockFinal2');
  // An id starts with a letter, so a name that starts with a digit gets one
  // rather than being refused outright.
  assert.equal(idFromLabel('2x2 tile'), 'a2x2Tile');
  assert.equal(idFromLabel('  '), '');
});

test('two records cannot answer to one id', () => {
  // There is nothing to chase for the files a record draws itself out of: it
  // names them by filename inside its own folder, so they have no id at all.
  // What still has to hold is that a rename cannot land on a name in use.
  const doc = createDataDocument({
    props: [{ id: 'boulder', mesh: 'rock.glb' }],
  });

  assert.equal(doc.rename('props', 0, 'rock'), null);
  assert.equal(doc.list('props')[0]!.id, 'rock');
  // The file it names is untouched by its own rename: the two are unrelated
  // now, which is the point of naming files rather than records.
  assert.equal(doc.list('props')[0]!.mesh, 'rock.glb');

  doc.add('props');
  const second = doc.list('props').length - 1;
  const clash = doc.rename('props', second, 'rock');
  assert.ok(clash, 'renaming onto an id another record holds was allowed');
  assert.match(clash, /already taken/);
});

test('renaming a material carries the terrains wearing it', () => {
  // A terrain names materials rather than assets: what the ground is made of is
  // a top block and the blocks under it, and both are named surfaces that exist
  // once. The turned overrides are carried too, or a rename would strand them.
  const doc = createDataDocument({
    materials: [{ id: 'material1', label: 'material1' }],
    terrains: [{ id: 'grass', char: 'gr', top: 'material1', sub: 'material1', top90: 'material1' }],
  });
  assert.equal(doc.rename('materials', 0, 'turf'), null);
  assert.equal(doc.list('terrains')[0]!.top, 'turf');
  assert.equal(doc.list('terrains')[0]!.sub, 'turf');
  assert.equal(doc.list('terrains')[0]!.top90, 'turf');
});

test('renaming a terrain keeps its grid key', () => {
  const doc = createDataDocument({
    terrains: [{ id: 'terrain3', label: 'terrain3', char: 'gr' }],
  });
  assert.equal(doc.rename('terrains', 0, 'grass'), null);
  assert.equal(doc.list('terrains')[0]!.id, 'grass');
  // The key is what a map's rows are written in, so it survives the rename.
  // The id does appear in a saved map's legend, which is why validation
  // reports a map naming a terrain the rules no longer define.
  assert.equal(doc.list('terrains')[0]!.char, 'gr');
});

test('a painted map round-trips through the file it writes', () => {
  // The old format widened every row when a two-character letter appeared,
  // which is how a resized map lost its ground. Cells are always two characters
  // now, so there is no widening left to get wrong — what this guards instead
  // is that what the editor writes is what it reads back.
  const doc = createDocument(blankMap('m', 4, 3));
  const charOf = (id: string) =>
    ({ grass: 'gr', road: 'r2' }) [id as 'grass' | 'road'] ?? '';

  const stroke = doc.beginStroke('paint');
  stroke.set(0, 0, 0, doc.kindOf('grass'));
  stroke.set(2, 1, 3, doc.kindOf('road'));
  doc.commit(stroke);

  assert.equal(doc.terrainAt(0, 0), 'grass');
  assert.equal(doc.terrainAt(2, 1), 'road');
  assert.equal(doc.levelAt(2, 1), 3);
  // Never painted, so it is empty — not level-0 ground.
  assert.equal(doc.levelAt(3, 2), null);

  const source = serializeMap(doc.map, charOf);
  assert.match(source, /terrainKeys: \{ 'gr': 'grass', 'r2': 'road' \},/);
  assert.match(source, /terrain: \[\n {4}'gr\.\.\.\.\.\.',/);

  /** The quoted rows of one `key: [...]` block of the serialized map. */
  const rowsOf = (key: string): string[] => {
    const block = source.match(new RegExp(`${key}: \\[([^\\]]*)\\]`));
    assert.ok(block, `the serialized map has no ${key} block`);
    return (block[1]!.match(/'([^']*)'/g) ?? []).map((r) => r.slice(1, -1));
  };

  const read = decodeTerrain({
    height: rowsOf('height'),
    terrain: rowsOf('terrain'),
    terrainKeys: { gr: 'grass', r2: 'road' },
  });
  assert.deepEqual(read.problems, [], 'a file this code wrote reads back clean');
  assert.deepEqual([...read.grid.kind], [...doc.terrain.kind]);
  assert.deepEqual([...read.grid.level], [...doc.terrain.level]);
});
