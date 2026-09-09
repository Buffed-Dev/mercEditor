/**
 * The one thing crafting must never do is lose track of an item or a coin.
 *
 * Every case below asserts a census — what is in the bag, on the body and on
 * the cursor — and the purse, on both sides of the call. A refusal must move
 * neither; a success must move each by exactly one thing.
 *
 * A price is a list now, which adds the one failure a single number could not
 * have: paying the gold and then finding the shard short. That is what the
 * atomic cases are for.
 *
 * Run with `node --test`. Nothing here imports Babylon, so there is no harness.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter } from '../Engine/src/game/character.ts';
import {
  CRAFT_SECONDS,
  advanceCraft,
  beginCraft,
  craftingView,
  finishCraft,
  purseView,
  upgradeBase,
} from '../Engine/src/game/crafting.ts';
import { nextBaseLevel } from '../Engine/src/data/baseLevels.ts';
import { itemRange } from '../Engine/src/game/items.ts';
import { EQUIPMENT_SLOTS } from '../Engine/src/game/inventory.ts';

const CURRENCIES = [
  { id: 'gold', label: 'Gold', start: 0 },
  { id: 'shard', label: 'Shard', start: 0 },
];

const ITEMS = [
  {
    id: 'shortSword',
    label: 'Short sword',
    slot: 'mainHand',
    stats: [
      { attribute: 'attackPower', op: 'add', min: 4, max: 6, step: 1 },
      { attribute: 'attackSpeed', op: 'override', min: 2, max: 2, step: 0.01 },
    ],
    costs: [{ kind: 'currency', id: 'gold', amount: 25 }],
  },
  {
    id: 'runeBlade',
    label: 'Rune blade',
    slot: 'mainHand',
    stats: [{ attribute: 'attackPower', op: 'add', min: 9, max: 9, step: 1 }],
    costs: [
      { kind: 'currency', id: 'gold', amount: 10 },
      { kind: 'currency', id: 'shard', amount: 2 },
    ],
  },
];

const MATERIAL_ITEMS = [
  { id: 'ironOre', label: 'Iron ore', kind: 'material' },
  {
    id: 'runeBlade',
    label: 'Rune blade',
    slot: 'mainHand',
    stats: [],
    costs: [
      { kind: 'currency', id: 'gold', amount: 10 },
      { kind: 'item', id: 'ironOre', amount: 3 },
    ],
  },
];

const RECIPES = [
  { id: 'cheap', label: 'Cheap sword', item: 'shortSword', minBase: 1 },
  { id: 'deep', label: 'Deep sword', item: 'shortSword', minBase: 3 },
  { id: 'runed', label: 'Runed', item: 'runeBlade', minBase: 1 },
  { id: 'dangling', label: 'Ghost', item: 'goneForever', minBase: 1 },
];

const BASE_LEVELS = [
  { id: 'two', level: 2, costs: [{ kind: 'currency', id: 'gold', amount: 100 }] },
  {
    id: 'three',
    level: 3,
    costs: [
      { kind: 'currency', id: 'gold', amount: 200 },
      { kind: 'currency', id: 'shard', amount: 1 },
    ],
  },
];

import type { Character } from '../Engine/src/game/character.ts';
import { anItem } from './helpers/items.ts';

/** Everything the character holds, wherever it is holding it. */
function census(character: Character) {
  const worn = EQUIPMENT_SLOTS.filter((slot) => character.inventory.wearing(slot.id)).length;
  return character.inventory.count + worn + (character.hand ? 1 : 0);
}

const coins = (character: Character) => [character.amount('gold'), character.amount('shard')];

function bench({ gold = 0, shard = 0, baseLevel = 1 } = {}) {
  const character = createCharacter({ currencies: CURRENCIES });
  character.earn('gold', gold);
  character.earn('shard', shard);
  const place = { baseLevel };
  return {
    character,
    place,
    ctx: {
      recipes: RECIPES,
      items: ITEMS,
      currencies: CURRENCIES,
      baseLevels: BASE_LEVELS,
      character,
      place,
    },
  };
}

test('a new character starts with what the currencies say', () => {
  const character = createCharacter({
    currencies: [
      { id: 'gold', label: 'Gold', start: 50 },
      { id: 'shard', label: 'Shard', start: 0 },
      { id: 'sloppy', label: 'Sloppy', start: -4 },
    ],
  });
  assert.equal(character.amount('gold'), 50);
  assert.equal(character.amount('shard'), 0);
  assert.equal(character.amount('sloppy'), 0, 'a negative start became a debt');
  assert.equal(character.amount('neverHeardOf'), 0);
});

test('a recipe above the base level refuses, and costs nothing', () => {
  const { character, ctx } = bench({ gold: 999 });
  const before = [coins(character), census(character)];
  const result = beginCraft('deep', ctx);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'locked');
  assert.deepEqual([coins(character), census(character)], before);
});

test('too little of ONE currency refuses the whole price', () => {
  const { character, ctx } = bench({ gold: 999, shard: 1 });
  const before = [coins(character), census(character)];

  const result = beginCraft('runed', ctx);
  assert.equal(result.reason, 'poor');
  assert.deepEqual(
    [coins(character), census(character)],
    before,
    'the gold was taken for a price that could not be paid',
  );
});

test('a full bag refuses BEFORE spending', () => {
  const { character, ctx } = bench({ gold: 999 });
  for (let i = 0; i < character.inventory.size; i++) {
    character.inventory.add(anItem({ uid: `filler${i}`, defId: 'rock', label: 'Rock', slot: 'head' }));
  }
  const before = [coins(character), census(character)];
  assert.equal(beginCraft('cheap', ctx).reason, 'full');
  assert.deepEqual([coins(character), census(character)], before);
});

test('a recipe pointing at a deleted item refuses, and costs nothing', () => {
  const { character, ctx } = bench({ gold: 999 });
  const before = [coins(character), census(character)];
  assert.equal(beginCraft('dangling', ctx).reason, 'unknown');
  assert.equal(beginCraft('noSuchRecipe', ctx).reason, 'unknown');
  assert.deepEqual([coins(character), census(character)], before);
});

test('the coin goes at the start and the item arrives at the end', () => {
  const { character, ctx } = bench({ gold: 100 });
  const count = census(character);

  assert.equal(beginCraft('cheap', ctx).ok, true);
  assert.deepEqual(coins(character), [75, 0]);
  assert.equal(census(character), count, 'the item arrived before it was made');

  assert.equal(advanceCraft(character, CRAFT_SECONDS - 0.01), false);
  assert.equal(advanceCraft(character, 0.01), true);

  const { item, stowed } = finishCraft(character, ctx);
  assert.equal(stowed, true);
  assert.equal(census(character), count + 1);
  assert.ok(item, 'nothing came off the bench');
  assert.equal(item.defId, 'shortSword');
  assert.equal(character.job, null, 'the bench is still busy after finishing');

  const ranges = new Map(itemRange(ITEMS[0]).map((stat) => [stat.attribute, stat]));
  for (const stat of item.stats) {
    const range = ranges.get(stat.attribute);
    assert.ok(range, `${stat.attribute} is not a stat this item rolls`);
    assert.ok(stat.value >= range.min && stat.value <= range.max, `${stat.attribute} out of range`);
  }
});

test('a price of two currencies takes both', () => {
  const { character, ctx } = bench({ gold: 30, shard: 3 });
  assert.equal(beginCraft('runed', ctx).ok, true);
  assert.deepEqual(coins(character), [20, 1]);
});

test('one bench makes one thing at a time', () => {
  const { character, ctx } = bench({ gold: 1000 });
  assert.equal(beginCraft('cheap', ctx).ok, true);

  assert.equal(beginCraft('cheap', ctx).reason, 'busy');
  assert.deepEqual(coins(character), [975, 0], 'a refused craft was charged for');

  advanceCraft(character, CRAFT_SECONDS);
  finishCraft(character, ctx);
  assert.equal(beginCraft('cheap', ctx).ok, true, 'the bench never freed up');
});

test('a bag filled while it was working does not lose the item', () => {
  const { character, ctx } = bench({ gold: 100 });
  assert.equal(beginCraft('cheap', ctx).ok, true);
  for (let i = 0; i < character.inventory.size; i++) {
    character.inventory.add(anItem({ uid: `filler${i}`, defId: 'rock', label: 'Rock', slot: 'head' }));
  }

  advanceCraft(character, CRAFT_SECONDS);
  const { item, stowed } = finishCraft(character, ctx);
  assert.ok(item, 'the item was paid for and never made');
  assert.equal(stowed, false, 'it was forced into a full bag');
});

test('a recipe deleted while it was working comes up empty rather than wrong', () => {
  const { character, ctx } = bench({ gold: 100 });
  assert.equal(beginCraft('cheap', ctx).ok, true);
  advanceCraft(character, CRAFT_SECONDS);

  const { item } = finishCraft(character, { ...ctx, recipes: [] });
  assert.equal(item, null);
  assert.equal(character.job, null);
});

test('an idle bench ticks to nothing', () => {
  const { character, ctx } = bench();
  assert.equal(advanceCraft(character, 5), false);
  assert.deepEqual(finishCraft(character, ctx), { item: null, stowed: false });
});

test('the upgrade table is the ladder, and its top is the cap', () => {
  const { character, place } = bench({ gold: 100 });
  const buy = () => upgradeBase({ character, place, baseLevels: BASE_LEVELS });

  assert.equal(nextBaseLevel(1, BASE_LEVELS)?.level, 2);
  assert.equal(nextBaseLevel(3, BASE_LEVELS), null);

  assert.equal(buy().ok, true);
  assert.equal(place.baseLevel, 2);
  assert.deepEqual(coins(character), [0, 0]);

  // Level 3 wants gold AND a shard; a heap of gold alone is not enough.
  character.earn('gold', 500);
  assert.equal(buy().reason, 'poor');
  assert.deepEqual(coins(character), [500, 0], 'a refused upgrade was charged for');

  character.earn('shard', 1);
  assert.equal(buy().ok, true);
  assert.equal(place.baseLevel, 3);
  assert.deepEqual(coins(character), [300, 0]);

  assert.equal(buy().reason, 'maxed');
});

test('the view says why each recipe cannot be pressed, and what it costs', () => {
  const { ctx } = bench({ gold: 30 });
  const view = craftingView({ ...ctx, attributes: [{ id: 'attackPower', label: 'Attack power' }] });

  assert.deepEqual(view.purse, [
    { id: 'gold', label: 'Gold', amount: 30 },
    { id: 'shard', label: 'Shard', amount: 0 },
  ]);
  assert.deepEqual(
    view.recipes.map((r) => [r.cost, r.locked, r.affordable, r.missing]),
    [
      ['25 Gold', false, true, false],
      ['25 Gold', true, true, false],
      ['10 Gold + 2 Shard', false, false, false],
      ['Free', false, true, true],
    ],
  );
  assert.equal(view.recipes[0].lines[0], '+4–6 Attack power');
  assert.equal(view.upgradeCost, '100 Gold');
  assert.equal(view.canUpgrade, false);
  assert.equal(view.job, null);
});

test('the view reports what is being made, and how far along', () => {
  const { character, ctx } = bench({ gold: 100 });
  const look = () => craftingView({ ...ctx, attributes: [] });

  beginCraft('cheap', ctx);
  assert.equal(look().job?.recipeId, 'cheap');
  assert.equal(look().job?.progress, 0);
  assert.deepEqual(
    look().recipes.map((r) => r.making),
    [true, false, false, false],
  );

  advanceCraft(character, CRAFT_SECONDS / 2);
  const halfway = look().job;
  assert.ok(halfway, 'the bench forgot what it was making');
  assert.ok(Math.abs(halfway.progress - 0.5) < 1e-9);

  advanceCraft(character, CRAFT_SECONDS);
  assert.equal(look().job?.progress, 1, 'progress ran past the end');

  finishCraft(character, ctx);
  assert.equal(look().job, null);
});

test('the purse read-out lists every currency, zeroes included', () => {
  const { character } = bench({ gold: 7 });
  assert.deepEqual(purseView(CURRENCIES, character), [
    { id: 'gold', label: 'Gold', amount: 7 },
    { id: 'shard', label: 'Shard', amount: 0 },
  ]);
});

test('a price can be paid out of the bag as well as the purse', async () => {
  const { rollItem } = await import('../Engine/src/game/items.ts');
  const ore = MATERIAL_ITEMS[0];

  const { character, ctx } = bench({ gold: 100 });
  const forged = { ...ctx, items: MATERIAL_ITEMS, recipes: [{ id: 'blade', item: 'runeBlade', minBase: 1 }] };

  // Gold enough, ore short: the whole price is refused and the gold stays.
  character.inventory.add(rollItem(ore, Math.random, 2));
  assert.equal(beginCraft('blade', forged).reason, 'poor');
  assert.deepEqual(coins(character), [100, 0], 'gold was taken for a price that could not be paid');
  assert.equal(character.inventory.countOf('ironOre'), 2, 'ore was taken as well');

  // One more ore and it goes through, taking from both pockets at once.
  character.inventory.add(rollItem(ore, Math.random, 1));
  assert.equal(beginCraft('blade', forged).ok, true);
  assert.deepEqual(coins(character), [90, 0]);
  assert.equal(character.inventory.countOf('ironOre'), 0);
});

test('the view prices a material by name', async () => {
  const { character, ctx } = bench({ gold: 100 });
  const forged = {
    ...ctx,
    items: MATERIAL_ITEMS,
    recipes: [{ id: 'blade', label: 'Blade', item: 'runeBlade', minBase: 1 }],
    attributes: [],
  };
  const view = craftingView(forged);
  assert.equal(view.recipes[0].cost, '10 Gold + 3 Iron ore');
  assert.equal(view.recipes[0].affordable, false, 'affordable with no ore in the bag');

  character.inventory.add((await import('../Engine/src/game/items.ts')).rollItem(MATERIAL_ITEMS[0], Math.random, 3));
  assert.equal(craftingView(forged).recipes[0].affordable, true);
});
