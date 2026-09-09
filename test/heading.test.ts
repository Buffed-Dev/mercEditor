import test from 'node:test';
import assert from 'node:assert/strict';
import { headingToDegrees, headingToFace } from '../Engine/editor/viewport/heading.ts';

const rad = (degrees: number) => (degrees * Math.PI) / 180;

test('a snapped turn lands on a quarter-hour of the compass', () => {
  // What a free handle writes is 309.437284, in a file where every heading
  // anyone typed is a round number.
  assert.equal(headingToDegrees(rad(309.437284), true), 315);
  assert.equal(headingToDegrees(rad(7), true), 0);
  assert.equal(headingToDegrees(rad(8), true), 15);
});

test('a turn just short of all the way round is none of the way round', () => {
  // 359.9 rounds to 360, and 360 degrees is 0 — not a bearing the compass has.
  assert.equal(headingToDegrees(rad(359.9), true), 0);
});

test('an unsnapped turn keeps its angle but not the arithmetic noise', () => {
  assert.equal(headingToDegrees(rad(309.437284), false), 309.44);
});

test('a heading is always a bearing, whichever way it was measured', () => {
  for (const degrees of [-90, -1, 0, 180, 359, 720]) {
    const value = headingToDegrees(rad(degrees), false);
    assert.ok(value >= 0 && value < 360, `${degrees} -> ${value}`);
  }
});

test('a wall face is one of four, and the quarters are where they turn', () => {
  assert.equal(headingToFace(rad(0)), '+y');
  assert.equal(headingToFace(rad(90)), '+x');
  assert.equal(headingToFace(rad(180)), '-y');
  assert.equal(headingToFace(rad(270)), '-x');
  // Wrapping the whole way round comes back to where it started.
  assert.equal(headingToFace(rad(360)), '+y');
  assert.equal(headingToFace(rad(-90)), '-x');
});
