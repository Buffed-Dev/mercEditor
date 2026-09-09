import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleBetween,
  beginCast,
  endCast,
  turnActor,
  updateCastSlow,
} from '../Engine/src/game/abilities.js';
import { createAttributeSet } from '../Engine/src/game/attributes.js';

/** Just enough actor for the cast slow: the attributes it multiplies. */
function caster(moveSpeed = 4) {
  return {
    attrs: createAttributeSet(undefined, { moveSpeed }),
    cast: null,
    slowRelease: null,
    facing: 0,
  };
}

const HALF = { id: 'heave', castTime: 1, castSlow: 0.5 };
const speed = (actor) => actor.attrs.value('moveSpeed');

test('a cast slows the caster while it winds up', () => {
  const actor = caster();
  beginCast(HALF, actor, 0);
  assert.equal(speed(actor), 2);
});

test('the slow eases off over the release rather than snapping back', () => {
  const actor = caster();
  beginCast(HALF, actor, 0);
  endCast(actor);

  // Still slowed the frame the cast ends, and less so as the release runs out.
  assert.ok(speed(actor) < 4);
  updateCastSlow(actor, 0.1);
  assert.equal(speed(actor), 3);
  updateCastSlow(actor, 0.05);
  assert.equal(speed(actor), 3.5);

  updateCastSlow(actor, 0.05);
  assert.equal(speed(actor), 4);
  assert.equal(actor.slowRelease, null);
});

test('a new cast replaces a slow still letting go, rather than stacking on it', () => {
  const actor = caster();
  beginCast(HALF, actor, 0);
  endCast(actor);
  updateCastSlow(actor, 0.1);

  beginCast(HALF, actor, 0);
  assert.equal(actor.slowRelease, null);
  assert.equal(speed(actor), 2);
});

test('an ability with no slow leaves nothing behind to release', () => {
  const actor = caster();
  beginCast({ id: 'poke', castTime: 1, castSlow: 0 }, actor, 0);
  endCast(actor);
  assert.equal(actor.slowRelease, null);
  assert.equal(speed(actor), 4);
});

// --- turning while casting -------------------------------------------------

const NORTH = 0;
const EAST = Math.PI / 2;
/** A quarter turn a second: 90 degrees of steering per second of wind-up. */
const SLOW_TURN = { id: 'heave', castTime: 1, castSlow: 0, castTurn: 90 };

test('turning is free when nothing is winding up', () => {
  const actor = caster();
  turnActor(actor, EAST, 0.016);
  assert.equal(actor.facing, EAST);
});

test('a wind-up caps the turn and is steered by what gets through', () => {
  const actor = caster();
  beginCast(SLOW_TURN, actor, NORTH);

  // Half a second of a quarter-turn-a-second cap is an eighth of a turn.
  turnActor(actor, EAST, 0.5);
  assert.ok(Math.abs(actor.facing - Math.PI / 4) < 1e-9);
  assert.equal(actor.cast.aim, actor.facing);

  // And the rest of the way on the next half second, no further.
  turnActor(actor, EAST, 0.5);
  assert.ok(Math.abs(actor.facing - EAST) < 1e-9);
  assert.equal(actor.cast.aim, EAST);
});

test('a cap of zero commits the direction at the moment of pressing', () => {
  const actor = caster();
  beginCast({ ...SLOW_TURN, castTurn: 0 }, actor, NORTH);
  turnActor(actor, EAST, 1);
  assert.equal(actor.facing, NORTH);
  assert.equal(actor.cast.aim, NORTH);
});

test('the turn takes the short way round the wrap', () => {
  const actor = caster();
  actor.facing = Math.PI - 0.1;
  beginCast(SLOW_TURN, actor, actor.facing);

  // A tenth either side of ±PI: the way round is a fifth, not the long way.
  turnActor(actor, -Math.PI + 0.1, 1);
  assert.ok(Math.abs(angleBetween(actor.facing, -Math.PI + 0.1)) < 1e-9);
});
