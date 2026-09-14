import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureKey } from '../Engine/src/render/materials.ts';

/**
 * What a material's picture is cached under.
 *
 * The cache lives on the scene and is never pruned, so what this key varies
 * with is exactly what the scene accumulates one of. It used to vary with the
 * tiling, which comes off a slider — "Tile across" runs 0.1 to 32 in steps of
 * 0.1 — so a single drag of that slider asked for three hundred textures
 * nobody had asked for before and the scene kept every one of them.
 */

const flat = { animated: false, columns: 1, rows: 1, count: 1, fps: 0 };
const sheet = { animated: true, columns: 4, rows: 4, count: 16, fps: 12 };

test('one texture per material per file, whatever the tiling is doing', () => {
  const wood = { id: 'wood' };
  const at = (u: number, v: number) => pictureKey('/assets/wood.png', wood, [u, v, 0, 0], flat);

  // The whole sweep of the slider is one key, so the drag stops allocating.
  assert.equal(at(1, 1), at(8, 8));
  assert.equal(at(1, 1), at(0.1, 32));
});

test('two materials cutting one file two ways still get two textures', () => {
  // The invariant the tiling used to be in the key for: they would otherwise
  // each keep overwriting the other's tiling.
  const url = '/assets/wood.png';
  const wood = pictureKey(url, { id: 'wood' }, [1, 1, 0, 0], flat);
  const planks = pictureKey(url, { id: 'planks' }, [8, 8, 0, 0], flat);
  assert.notEqual(wood, planks);
});

test('two files of one material are two textures', () => {
  const wood = { id: 'wood' };
  assert.notEqual(
    pictureKey('/assets/wood.png', wood, [1, 1, 0, 0], flat),
    pictureKey('/assets/wood_normal.png', wood, [1, 1, 0, 0], flat),
  );
});

test('a record with no id falls back to the tiling, as it always did', () => {
  // Nothing can tell two of these apart, so the old key is the safe one: it
  // separates them by the only thing that differs.
  const url = '/assets/wood.png';
  assert.notEqual(
    pictureKey(url, {}, [1, 1, 0, 0], flat),
    pictureKey(url, {}, [8, 8, 0, 0], flat),
  );
});

test('a sheet is keyed by its cutting, and never by the tiling', () => {
  // The window is the tiling for an animated sheet, so the material's own
  // tiling has nothing to say and must not reach the key.
  const url = '/assets/fire.png';
  const one = pictureKey(url, { id: 'fire' }, [1, 1, 0, 0], sheet);
  const other = pictureKey(url, { id: 'fire' }, [8, 8, 2, 2], sheet);
  assert.equal(one, other);
  assert.notEqual(one, pictureKey(url, { id: 'fire' }, [1, 1, 0, 0], { ...sheet, columns: 8 }));
  assert.notEqual(one, pictureKey(url, { id: 'fire' }, [1, 1, 0, 0], { ...sheet, fps: 24 }));
  // And an animated cutting is never the same key as a flat one.
  assert.notEqual(one, pictureKey(url, { id: 'fire' }, [1, 1, 0, 0], flat));
});
