import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOfFile, safeFileName, stemOf } from '../Engine/editor/uploadAsset.js';

test('a name the server would refuse is renamed rather than rejected', () => {
  // The name came off a file somebody exported hours ago; "rock (final)(2).glb"
  // is not worth a round trip.
  assert.equal(safeFileName('rock (final)(2).glb'), 'rock _final__2_.glb');
  assert.equal(safeFileName('wood.png'), 'wood.png');
});

test('a name that does not start with a letter or digit is given one', () => {
  assert.equal(safeFileName('_hidden.png'), 'asset _hidden.png');
});

test('an extension the editor cannot use is refused outright', () => {
  // Renaming would not help: nothing here can draw a .txt.
  assert.equal(safeFileName('notes.txt'), '');
  assert.equal(safeFileName('noextension'), '');
});

test('what a file is, is read off its extension', () => {
  assert.equal(kindOfFile('rock.glb'), 'mesh');
  assert.equal(kindOfFile('rock.gltf'), 'mesh');
  // A picture, which can be switched to a sheet in one click if that is what
  // it turns out to be.
  assert.equal(kindOfFile('wood.png'), 'texture');
  assert.equal(kindOfFile('WOOD.PNG'), 'texture');
});

test('a record is named after its file, without the extension', () => {
  assert.equal(stemOf('grass_base_color.png'), 'grass_base_color');
  assert.equal(stemOf('rock.glb'), 'rock');
});
