import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceChain,
  chainGapFraction,
  chainIndex,
  chainReady,
  updateChain,
} from '../Engine/src/game/abilities.ts';
import { normalizeAbility } from '../Engine/src/data/abilities.ts';

const combo = normalizeAbility({
  id: 'sword',
  target: 'combo',
  steps: ['swing', 'swipe', 'slam'],
  chainWindow: 1,
});

test('a chain walks its steps and starts over after the finisher', () => {
  const actor = {};

  assert.equal(chainIndex(actor, combo), 0);

  assert.equal(advanceChain(actor, combo), false);
  assert.equal(chainIndex(actor, combo), 1);

  assert.equal(advanceChain(actor, combo), false);
  assert.equal(chainIndex(actor, combo), 2);

  // The finisher says so, which is what puts the combo on cooldown.
  assert.equal(advanceChain(actor, combo), true);
  assert.equal(chainIndex(actor, combo), 0);
});

test('the window drops a chain that is not kept up', () => {
  const actor = {};
  advanceChain(actor, combo);

  updateChain(actor, 0.9);
  assert.equal(chainIndex(actor, combo), 1);

  updateChain(actor, 0.2);
  assert.equal(chainIndex(actor, combo), 0);
});

test('another combo does not resume this one', () => {
  const actor = {};
  advanceChain(actor, combo);
  assert.equal(chainIndex(actor, { ...combo, id: 'axe' }), 0);
});

const paced = normalizeAbility({
  id: 'axe',
  target: 'combo',
  steps: ['chop', 'cleave'],
  chainWindow: 1,
  stepGap: 0.4,
});

test('a step that has just landed holds the next one back', () => {
  const actor = {};
  advanceChain(actor, paced);

  assert.equal(chainReady(actor, paced), false);
  assert.equal(chainGapFraction(actor, paced), 1);

  updateChain(actor, 0.2);
  assert.equal(chainReady(actor, paced), false);
  assert.equal(chainGapFraction(actor, paced), 0.5);

  updateChain(actor, 0.25);
  assert.equal(chainReady(actor, paced), true);
  assert.equal(chainGapFraction(actor, paced), 0);
  assert.equal(chainIndex(actor, paced), 1, 'the recovery dropped the chain');
});

test('the window only starts once the recovery is over', () => {
  const actor = {};
  advanceChain(actor, paced);

  // 0.4 of recovery and then the whole 1s window: a chain is never dropped
  // during a wait it was not allowed to act in.
  updateChain(actor, 0.4);
  updateChain(actor, 0.9);
  assert.equal(chainIndex(actor, paced), 1);

  updateChain(actor, 0.2);
  assert.equal(chainIndex(actor, paced), 0, 'the window never ran out');
});

test('a combo with no recovery is paced by its steps alone', () => {
  const actor = {};
  advanceChain(actor, combo);
  assert.equal(chainReady(actor, combo), true);
  assert.equal(chainGapFraction(actor, combo), 0);
});
