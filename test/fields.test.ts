import test from 'node:test';
import assert from 'node:assert/strict';
import {
  display,
  needsEmptyChoice,
  fromPosition,
  quantise,
  resolveRange,
  splitUnit,
  toPosition,
} from '../Engine/editor/fields/ranges.ts';
import { groupFields } from '../Engine/editor/fields/grouping.ts';
import { fromHsv, toHsv, toHex, fromHex } from '../Engine/editor/fields/color.ts';
import type { FieldSpec } from '../Engine/editor/fields/types.ts';

const range = (over: Partial<FieldSpec> = {}): FieldSpec => ({
  key: 'x',
  kind: 'range',
  label: 'X',
  min: 0,
  max: 10,
  step: 0.5,
  ...over,
});

// --- what a field's ends mean ----------------------------------------------

test('only a range is a scale; a number with ends merely clamps', () => {
  // A stat line is bounded at ±9999 to stop a typo. Those are ends, but they
  // are not a quantity to draw a bar from.
  const stat = resolveRange({ key: 'v', kind: 'number', label: 'V', min: -9999, max: 9999 }, 4);
  assert.equal(stat.clamps, true);
  assert.equal(stat.scaled, false);

  const scale = resolveRange(range(), 5);
  assert.equal(scale.clamps, true);
  assert.equal(scale.scaled, true);
});

test('a field that declares no step gets a grain sized to its own number', () => {
  // "no opinion" is not the same as "whole numbers only" — an attacks-per-second
  // of 1.2 dragged in steps of 1 could never reach most of its useful values.
  const small = resolveRange({ key: 'v', kind: 'number', label: 'V' }, 1.2);
  assert.equal(small.step, 0.1);
  const large = resolveRange({ key: 'v', kind: 'number', label: 'V' }, 250);
  assert.equal(large.step, 1);
});

// --- travel ----------------------------------------------------------------

test('a linear field sits where its value sits between its ends', () => {
  const linear = resolveRange(range(), 0);
  assert.equal(toPosition(linear, 0), 0);
  assert.equal(toPosition(linear, 5), 0.5);
  assert.equal(toPosition(linear, 10), 1);
});

test('an exponential field gives the bottom of its range most of the travel', () => {
  // The reason this exists: a light runs to 200 but is usually about 12, and a
  // material scale runs to 32 but is usually near 1. Spread linearly, every
  // value anyone wants is in the first few pixels of the sweep.
  const exp = resolveRange(range({ min: 0.1, max: 100, step: 0.1, curve: 'exp' }), 1);
  const linear = resolveRange(range({ min: 0.1, max: 100, step: 0.1 }), 1);

  assert.ok(toPosition(exp, 1) > toPosition(linear, 1));
  // A tenth of the way to 100 is nowhere near 10 on a linear scale, and is
  // exactly the region that used to be undialable.
  assert.ok(toPosition(exp, 10) > 0.6);
  assert.equal(Math.round(toPosition(exp, 100)), 1);
});

test('position and value are inverses of each other, both curves', () => {
  for (const curve of ['linear', 'exp'] as const) {
    const spec = resolveRange(range({ min: 0.1, max: 64, step: 0.01, curve }), 1);
    for (const value of [0.1, 1, 7.5, 64]) {
      const round = fromPosition(spec, toPosition(spec, value));
      assert.ok(Math.abs(round - value) < 1e-6, `${curve}: ${value} → ${round}`);
    }
  }
});

// --- landing on a number ---------------------------------------------------

test('a value snaps to its grain and stays inside its ends', () => {
  const spec = resolveRange(range({ min: 0, max: 10, step: 0.5 }), 0);
  assert.equal(quantise(spec, 3.3), 3.5);
  assert.equal(quantise(spec, -4), 0);
  assert.equal(quantise(spec, 99), 10);
});

test('a grain that does not divide cleanly still yields a writable number', () => {
  // 0.05 multiplied out lands on 0.15000000000000002, and that is the number
  // that would be written into the map file.
  const spec = resolveRange(range({ min: 0, max: 1, step: 0.05 }), 0);
  assert.equal(quantise(spec, 0.15), 0.15);
  assert.equal(String(quantise(spec, 0.35)), '0.35');
});

// --- labels ----------------------------------------------------------------

test('a unit is lifted out of a label, and only when it really is one', () => {
  assert.deepEqual(splitUnit('Cooldown (sec)'), { name: 'Cooldown', unit: 's' });
  assert.deepEqual(splitUnit('Arc (degrees)'), { name: 'Arc', unit: '°' });
  // Not a unit: part of the name, and it has to survive intact.
  assert.deepEqual(splitUnit('Level (unlocked at)'), {
    name: 'Level (unlocked at)',
    unit: '',
  });
});

// --- rows ------------------------------------------------------------------

test('fields that are one value with parts share a row', () => {
  const rows = groupFields([
    { key: 'posX', kind: 'range', label: 'Position X' },
    { key: 'posY', kind: 'range', label: 'Position Y' },
    { key: 'posZ', kind: 'range', label: 'Position Z' },
    { key: 'label', kind: 'text', label: 'Label' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.kind, 'vector');
  assert.equal(rows[1]!.kind, 'single');
});

test('a partial match is left alone — it is a different field, not half a vector', () => {
  const rows = groupFields([
    { key: 'w', kind: 'range', label: 'Width' },
    { key: 'label', kind: 'text', label: 'Label' },
  ]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['single', 'single'],
  );
});

test('a group whose parts are not all numbers is not a vector', () => {
  const rows = groupFields([
    { key: 'min', kind: 'range', label: 'Least' },
    { key: 'max', kind: 'text', label: 'Most' },
  ]);
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['single', 'single'],
  );
});

// --- colour ----------------------------------------------------------------

test('a colour survives the trip through hue, saturation and value', () => {
  for (const rgb of [0x000000, 0xffffff, 0xe0a34a, 0x3d7eff, 0x4ade80]) {
    assert.equal(fromHsv(toHsv(rgb)), rgb, toHex(rgb));
  }
});

test('a colour reads and writes as the six digits a map file holds', () => {
  assert.equal(toHex(0x0a0c10), '#0a0c10');
  assert.equal(fromHex('#e0a34a'), 0xe0a34a);
  assert.equal(fromHex('e0a34a'), 0xe0a34a);
});

test('a value off disk is shown to the precision it actually has', () => {
  // A rim depth of 0.14 arrives from the geometry as 0.1399999999999999, and
  // that is what used to reach the screen.
  const spec = resolveRange(range({ min: 0, max: 0.4, step: 0.01 }), 0);
  assert.equal(display(spec, 0.1399999999999999), 0.14);
  assert.equal(display(spec, 0.30000000000000004), 0.3);
  // Integers stay integers rather than gaining a decimal point.
  const whole = resolveRange(range({ min: 0, max: 40, step: 1 }), 0);
  assert.equal(display(whole, 8), 8);
});

test('an empty reference is offered a choice of its own', () => {
  // A <select> with no option matching its value shows the first one instead,
  // so an ability that names no effect would read as naming whichever effect
  // happens to sort first — and one touch would make that true.
  const options: [string, string][] = [
    ['shine', 'Shine'],
    ['burn', 'Burn'],
  ];
  assert.equal(needsEmptyChoice('', options), true);
  assert.equal(needsEmptyChoice('burn', options), false);
});
