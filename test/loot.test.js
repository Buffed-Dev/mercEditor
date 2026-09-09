/**
 * Coin comes off the floor by a different door from everything else — walking
 * over it rather than clicking it — so the two doors have to agree, and neither
 * may put coin in a bag slot.
 *
 * With more than one currency, "how much" stops being an answer on its own:
 * every pile carries which kind it is, and a table can pay in two at once.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter } from '../Engine/src/game/character.js';
import { SETTLE_SECONDS, createGround } from '../Engine/src/game/ground.js';
import {
  COIN_REACH,
  coinOf,
  coinPile,
  collect,
  rollLoot,
  settled,
  sweepCoin,
} from '../Engine/src/game/loot.js';

const ITEMS = [
  { id: 'ironOre', label: 'Iron ore', kind: 'material' },
];

const CURRENCIES = [
  { id: 'gold', label: 'Gold', start: 0 },
  { id: 'shard', label: 'Shard', start: 0 },
];

const LOOT_TABLES = [
  { id: 'always', label: 'Always', rolls: [{ kind: 'currency', id: 'gold', min: 2, max: 5, chance: 1 }] },
  {
    id: 'mixed',
    label: 'Mixed',
    rolls: [
      { kind: 'currency', id: 'gold', min: 10, max: 10, chance: 1 },
      { kind: 'currency', id: 'shard', min: 1, max: 1, chance: 0.5 },
    ],
  },
  { id: 'never', label: 'Never', rolls: [{ kind: 'currency', id: 'gold', min: 5, max: 5, chance: 0 }] },
  { id: 'bogus', label: 'Bogus', rolls: [{ kind: 'currency', id: 'noSuchCoin', min: 5, max: 5, chance: 1 }] },
  // Typed the wrong way round, which whoever rolls it has to survive.
  { id: 'backwards', label: 'Backwards', rolls: [{ kind: 'currency', id: 'gold', min: 9, max: 3, chance: 1 }] },
];

const sword = () => ({ uid: 'sword1', label: 'Short sword', slot: 'mainHand', stats: [] });
const pile = (currency, amount) => coinPile(currency, amount, CURRENCIES);

/** An rng that hands back exactly the numbers you give it, in order. */
const scripted = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

function floor() {
  const character = createCharacter({ currencies: CURRENCIES });
  const ground = createGround();
  return { character, ground, deps: { ground, character } };
}

test('a pile is coin and an item is not', () => {
  assert.equal(pile('gold', 0), null);
  assert.equal(pile('gold', -5), null);
  assert.equal(pile('', 5), null);
  assert.deepEqual(pile('gold', 7.4), { label: '7 Gold', currency: 'gold', amount: 7 });
  // An unknown currency still makes a pile; it is named by its id rather than
  // vanishing, because losing a payout is worse than an ugly plate.
  assert.equal(pile('mystery', 2).label, '2 mystery');

  assert.deepEqual(coinOf({ item: pile('shard', 3) }), { currency: 'shard', amount: 3 });
  assert.equal(coinOf({ item: sword() }), null);
  assert.equal(coinOf(null), null);
});

test('coin goes in the purse and never in the bag', () => {
  const { character, ground, deps } = floor();
  const drop = ground.drop(pile('gold', 12), 3, 3);

  const result = collect(drop.id, deps);
  assert.deepEqual([result.ok, result.coin, result.item], [true, { currency: 'gold', amount: 12 }, null]);
  assert.equal(character.amount('gold'), 12);
  assert.equal(character.inventory.count, 0, 'coin took a bag slot');
  assert.equal(ground.count, 0);
});

test('each currency lands in its own pocket', () => {
  const { character, ground, deps } = floor();
  collect(ground.drop(pile('gold', 4), 1, 1).id, deps);
  collect(ground.drop(pile('shard', 2), 2, 2).id, deps);

  assert.equal(character.amount('gold'), 4);
  assert.equal(character.amount('shard'), 2);
});

test('a full bag refuses an item but never a coin', () => {
  const { character, ground, deps } = floor();
  for (let i = 0; i < character.inventory.size; i++) {
    character.inventory.add({ uid: `filler${i}`, label: 'Rock', slot: 'head', stats: [] });
  }
  const item = ground.drop(sword(), 1, 1);
  const coin = ground.drop(pile('gold', 5), 2, 2);

  assert.equal(collect(item.id, deps).reason, 'full');
  assert.equal(ground.at(item.id)?.item.label, 'Short sword', 'a refused item left the floor');

  assert.equal(collect(coin.id, deps).ok, true);
  assert.equal(character.amount('gold'), 5);
});

test('collecting the same pile twice pays once', () => {
  const { character, ground, deps } = floor();
  const drop = ground.drop(pile('gold', 9), 0, 0);

  assert.equal(collect(drop.id, deps).ok, true);
  assert.equal(collect(drop.id, deps).reason, 'gone');
  assert.equal(character.amount('gold'), 9);
});

test('walking over sweeps coin within reach, and leaves items and distant piles', () => {
  const { character, ground, deps } = floor();
  const near = ground.drop(pile('gold', 4), 5, 5);
  const alsoNear = ground.drop(pile('gold', 6), 5, 6);
  const far = ground.drop(pile('gold', 100), 12, 12);
  const item = ground.drop(sword(), 5, 4);

  const taken = sweepCoin({ gx: near.gx, gy: near.gy }, deps);

  assert.equal(taken, 1);
  assert.equal(character.amount('gold'), 4);
  assert.equal(ground.at(near.id), null);
  assert.ok(ground.at(alsoNear.id), 'a pile a whole tile away was vacuumed up');
  assert.ok(ground.at(far.id), 'a pile across the room was vacuumed up');
  assert.ok(ground.at(item.id), 'an item was swept up as if it were coin');
  assert.equal(character.inventory.count, 0);
});

test('a pile still in the air is not swept', () => {
  const { character, ground, deps } = floor();
  const drop = ground.drop(pile('gold', 15), 5, 5, { gx: 5.5, gy: 5.5 }, 10);
  const at = { gx: drop.gx, gy: drop.gy };

  assert.equal(settled(drop, 10), false);
  assert.equal(sweepCoin(at, { ...deps, now: 10 }), 0, 'swept in the frame it was thrown');
  assert.equal(sweepCoin(at, { ...deps, now: 10 + SETTLE_SECONDS - 0.01 }), 0);
  assert.equal(character.amount('gold'), 0);

  assert.equal(sweepCoin(at, { ...deps, now: 10 + SETTLE_SECONDS }), 1);
  assert.equal(character.amount('gold'), 15);
});

test('a pile that was never thrown is settled from the start', () => {
  const { ground, deps } = floor();
  const drop = ground.drop(pile('gold', 3), 1, 1);
  assert.equal(settled(drop, 0), true);
  assert.equal(sweepCoin({ gx: drop.gx, gy: drop.gy }, { ...deps, now: 0 }), 1);
});

test('reach is under a tile, so sweeping is standing on it', () => {
  assert.ok(COIN_REACH < 1, 'a reach of a tile or more picks up neighbours you never stepped on');
});

test('a loot table rolls its range, inclusive at both ends', () => {
  const roll = (r) =>
    rollLoot('always', { lootTables: LOOT_TABLES, currencies: CURRENCIES, items: ITEMS, rng: scripted(0, r) });

  // chance is tested with the first number, the amount with the second.
  assert.equal(roll(0)[0].amount, 2, 'the bottom of the range never comes up');
  assert.equal(roll(0.999)[0].amount, 5, 'the top of the range never comes up');
  assert.equal(roll(0.5)[0].currency, 'gold');
});

test('chance decides each roll on its own', () => {
  const of = (rng) => rollLoot('mixed', { lootTables: LOOT_TABLES, currencies: CURRENCIES, items: ITEMS, rng });

  // gold: chance 1 always passes. shard: chance 0.5 — 0.4 passes, 0.6 does not.
  assert.deepEqual(
    of(scripted(0, 0, 0.4, 0)).map((p) => p.currency),
    ['gold', 'shard'],
  );
  assert.deepEqual(
    of(scripted(0, 0, 0.6, 0)).map((p) => p.currency),
    ['gold'],
  );
  assert.deepEqual(rollLoot('never', { lootTables: LOOT_TABLES, currencies: CURRENCIES, items: ITEMS }), []);
});

test('a table naming nothing, or a currency that is gone, pays nothing', () => {
  const deps = { lootTables: LOOT_TABLES, currencies: CURRENCIES, items: ITEMS, rng: () => 0 };
  assert.deepEqual(rollLoot('bogus', deps), [], 'a deleted currency still dropped');
  assert.deepEqual(rollLoot('noSuchTable', deps), []);
  assert.deepEqual(rollLoot('', deps), []);
});

test('a range typed backwards still pays', () => {
  const piles = rollLoot('backwards', {
    lootTables: LOOT_TABLES,
    currencies: CURRENCIES,
    rng: scripted(0, 0),
  });
  assert.equal(piles[0].amount, 3, 'the ends were not put the right way round');
});

test('a vase is placed like a monster and pays out like one', async () => {
  const { MONSTER_KINDS, spawnMonsters } = await import('../Engine/src/game/monsters.js');
  const { ARCHETYPES } = await import('../Engine/src/data/archetypes.js');
  const { ATTRIBUTES } = await import('../Engine/src/data/attributes.js');

  assert.equal(MONSTER_KINDS.vase.prop, true, 'a vase would be drawn with a face');

  const vase = ARCHETYPES.find((a) => a.id === 'vase');
  assert.ok(vase, 'no vase archetype');
  assert.ok(vase.loot, 'a vase that drops nothing is just scenery');
  // The two attributes that switch the monster behaviour off without a branch.
  assert.equal(vase.attributes.moveSpeed, 0, 'a vase can wander off');
  assert.equal(vase.attributes.sight, 0, 'a vase can see you coming');
  assert.deepEqual(vase.abilities, [], 'a vase can fight back');
  // Same team as a monster, so the player can break it and monsters ignore it.
  assert.equal(vase.team, 'monster');

  const [built] = spawnMonsters(
    { monsters: [{ gx: 4, gy: 4, kind: 'vase' }] },
    { attributes: ATTRIBUTES, archetypes: ARCHETYPES },
  );
  assert.equal(built.actor.archetype, 'vase');
  assert.equal(built.alive, true);
  built.update({ move: () => {} }, { gx: 4.5, gy: 4.5 }, 0.1, null);
  assert.equal(built.chasing, false, 'a vase noticed the player standing on it');
});

test('a stack only partly fits: take what you can, leave the rest', async () => {
  const { rollItem, countOf } = await import('../Engine/src/game/items.js');
  const { STACK_MAX } = await import('../Engine/src/data/items.js');
  const character = createCharacter({ currencies: CURRENCIES });
  const ground = createGround();
  const deps = { ground, character };

  // One cell free, and it already holds ore two short of full.
  for (let i = 0; i < character.inventory.size - 1; i++) {
    character.inventory.add({ uid: `filler${i}`, label: 'Rock', slot: 'head', stats: [] });
  }
  character.inventory.add(rollItem(ITEMS[0], Math.random, STACK_MAX - 2));

  const drop = ground.drop(rollItem(ITEMS[0], Math.random, 9), 4, 4);
  const result = collect(drop.id, deps);

  assert.equal(result.ok, true);
  assert.equal(countOf(result.left), 7, 'more than the two that fit were taken');
  assert.equal(character.inventory.countOf('ironOre'), STACK_MAX);
  // Same id and same tile, so the pile does not leap out of the ground again.
  assert.equal(ground.at(drop.id)?.item.count, 7);
});

test('a pickup that moves nothing at all is a refusal', async () => {
  const { rollItem } = await import('../Engine/src/game/items.js');
  const character = createCharacter({ currencies: CURRENCIES });
  const ground = createGround();
  for (let i = 0; i < character.inventory.size; i++) {
    character.inventory.add({ uid: `filler${i}`, label: 'Rock', slot: 'head', stats: [] });
  }
  const drop = ground.drop(rollItem(ITEMS[0], Math.random, 4), 1, 1);

  assert.equal(collect(drop.id, { ground, character }).reason, 'full');
  assert.equal(ground.at(drop.id)?.item.count, 4, 'a refused stack was raided anyway');
});
