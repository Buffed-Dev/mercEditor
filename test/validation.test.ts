import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAbility } from '../Engine/src/data/abilities.ts';
import { atLeast, finite, within } from '../Engine/src/util/numbers.ts';

/**
 * What a hand-edited rules file is allowed to do to the game.
 *
 * The files under `Games/` are JavaScript nobody type-checks — that is the
 * point of them; the editor writes them and a person can too — so every number
 * in one is a number by hope. These are the cases that hope does not cover.
 */

test('a number that is not one reads as the default rather than as itself', () => {
  assert.equal(finite(3), 3);
  assert.equal(finite('3', 7), 7, 'a string is not a number, even one that looks like it');
  assert.equal(finite(null, 7), 7);
  assert.equal(finite(undefined, 7), 7);
  assert.equal(finite(Number.NaN, 7), 7);
  assert.equal(finite(Number.POSITIVE_INFINITY, 7), 7, 'infinity is not a number to divide by');
  assert.equal(atLeast(0, -5), 0);
  assert.equal(within(0, 1, 4), 1);
  assert.equal(within(0, 1, Number.NaN, 0.5), 0.5, 'NaN takes the fallback, then the clamp');
});

test('an ability whose cooldown is not a number still has a cooldown', () => {
  // The failure this exists for: `Math.max(0, NaN)` is NaN, NaN survives the
  // division, and `remaining > 0` is false for NaN — so the ability came back
  // instantly, for ever, and nothing anywhere said why.
  const broken = normalizeAbility({
    id: 'punch',
    cooldown: Number.NaN,
    range: 'far' as unknown as number,
    arc: 900,
    cost: -5,
  });

  assert.ok(Number.isFinite(broken.cooldown), 'the cooldown is a number');
  assert.ok(broken.cooldown > 0, 'and a real wait, not zero');
  assert.ok(Number.isFinite(broken.range) && broken.range > 0);
  assert.equal(broken.arc, 360, 'an arc wider than a circle is a circle');
  assert.equal(broken.cost, 0, 'nothing costs less than nothing');
});

test('an ability that says nothing at all is still an ability', () => {
  const bare = normalizeAbility({});
  for (const [key, value] of Object.entries(bare)) {
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `${key} is ${value}`);
    }
  }
  assert.equal(bare.target, 'melee');
  assert.deepEqual(bare.effects, []);
  assert.deepEqual(bare.steps, []);
});

test('what a rules file does write is kept exactly', () => {
  // The other half of the same rule: normalizing is a floor under bad input,
  // not a filter over good input.
  const real = normalizeAbility({
    id: 'swing',
    cooldown: 1.25,
    range: 3,
    arc: 120,
    castTime: 0.1,
    castSlow: 0.5,
    cast: 'timed',
  });
  assert.equal(real.cooldown, 1.25);
  assert.equal(real.range, 3);
  assert.equal(real.arc, 120);
  assert.equal(real.castTime, 0.1);
  assert.equal(real.castSlow, 0.5);
});
