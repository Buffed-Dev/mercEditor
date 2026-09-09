import assert from 'node:assert/strict';
import { isCoinPile } from '../../Engine/src/game/items.ts';
import type { CoinPile, ItemInstance, Loot } from '../../Engine/src/game/items.ts';
import type { Ability } from '../../Engine/src/data/abilities.ts';

/**
 * Fixtures for tests that care about what an item *does* rather than what it
 * is made of.
 *
 * Most of the inventory and loot tests want a thing with an identity and
 * nothing else: something to put in a cell, take out again, and recognise.
 * Writing that out by hand at every call site meant each one quietly agreed to
 * a different partial shape, so the reader could not tell which fields
 * mattered to the test and which were only there to fill the object out.
 */
export const anItem = (overrides: Partial<ItemInstance> = {}): ItemInstance => ({
  uid: 'item1',
  defId: 'thing',
  label: 'Thing',
  slot: 'none',
  grants: '',
  stack: 1,
  count: 1,
  stats: [],
  ...overrides,
});

/**
 * Reads loot as money, failing the test if it is not.
 *
 * The ground holds either half of `Loot`, so a test that means to inspect a
 * payout has to say which it expected. Saying it here turns a wrong guess into
 * a named assertion failure rather than a read of `undefined` three lines
 * further on.
 */
export function asCoin(loot: Loot | null | undefined): CoinPile {
  assert.ok(loot && isCoinPile(loot), 'expected money, got an item');
  return loot;
}

/** Reads loot as an item, failing the test if it is money. See `asCoin`. */
export function asItem(loot: Loot | null | undefined): ItemInstance {
  assert.ok(loot && !isCoinPile(loot), 'expected an item, got money');
  return loot;
}

/**
 * A fully filled-in ability, with everything neutral unless it is overridden.
 *
 * Deliberately not `normalizeAbility`: that fills a blank cast turn in with
 * the editor's default of 180 degrees a second, which is right for an ability
 * someone is authoring and wrong for a test measuring what a cap of nothing
 * does. Here every number starts at zero and the test says what it cares about.
 */
export const anAbility = (overrides: Partial<Ability> = {}): Ability => ({
  id: 'ability',
  label: 'Ability',
  target: 'melee',
  range: 1,
  arc: 120,
  speed: 12,
  size: 0.18,
  aimedBy: 'cursor',
  cast: 'instant',
  castTime: 0,
  castSlow: 0,
  castTurn: 0,
  interrupts: false,
  stepGap: 0,
  chainWindow: 1,
  cooldown: 0,
  cooldownRate: '',
  vfx: '',
  trail: '',
  costAttribute: '',
  cost: 0,
  effects: [],
  steps: [],
  ...overrides,
});
