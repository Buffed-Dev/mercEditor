/**
 * Stacking, which is the one change that can lose things quietly.
 *
 * The census the rest of the game holds to used to be "an item is in exactly
 * one place". With stacks it becomes "every *unit* is in exactly one place",
 * and every case below counts units on both sides of a move. A cell count no
 * longer proves anything: twenty ore in one cell and one in twenty are the same
 * bag by the old measure and very different by this one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STACK_MAX } from '../Engine/src/data/items.ts';
import { createInventory } from '../Engine/src/game/inventory.js';
import { countOf, rollItem, stacks } from '../Engine/src/game/items.js';

const ORE = { id: 'ironOre', label: 'Iron ore', kind: 'material' };
const WOOD = { id: 'oakWood', label: 'Oak wood', kind: 'material' };
const SWORD = { id: 'shortSword', label: 'Short sword', kind: 'equipment', slot: 'mainHand' };

const ore = (n) => rollItem(ORE, Math.random, n);
const wood = (n) => rollItem(WOOD, Math.random, n);
const sword = () => rollItem(SWORD);

const cells = (bag) => bag.snapshot().bag.map((item) => (item ? countOf(item) : null));

test('equipment does not stack and materials do', () => {
  assert.equal(stacks(ore(1), ore(1)), true);
  assert.equal(stacks(ore(1), wood(1)), false, 'two different materials merged');
  assert.equal(stacks(sword(), sword()), false, 'swords stacked');
  assert.equal(sword().stack, 1);
  assert.equal(ore(1).stack, STACK_MAX);
});

test('adding tops up an open stack before opening a cell', () => {
  const bag = createInventory({ cols: 4, rows: 1 });
  bag.add(ore(5));
  bag.add(sword());
  bag.add(ore(3));

  assert.deepEqual(cells(bag), [8, 1, null, null], 'a second ore cell was opened needlessly');
  assert.equal(bag.units, 9);
  assert.equal(bag.countOf('ironOre'), 8);
});

test('a stack too big for one cell spills into the next', () => {
  const bag = createInventory({ cols: 3, rows: 1 });
  const left = bag.add(ore(STACK_MAX + 5));

  assert.equal(left, null, 'something was handed back that there was room for');
  assert.deepEqual(cells(bag), [STACK_MAX, 5, null]);
  assert.equal(bag.countOf('ironOre'), STACK_MAX + 5);
});

test('what will not fit comes back rather than vanishing', () => {
  const bag = createInventory({ cols: 2, rows: 1 });
  const left = bag.add(ore(STACK_MAX * 2 + 7));

  assert.equal(countOf(left), 7, 'the overflow was swallowed');
  assert.equal(bag.units + countOf(left), STACK_MAX * 2 + 7, 'units went missing');
  assert.deepEqual(cells(bag), [STACK_MAX, STACK_MAX]);
});

test('room counts part-filled stacks as well as empty cells', () => {
  const bag = createInventory({ cols: 2, rows: 1 });
  bag.add(ore(STACK_MAX - 3));

  assert.equal(bag.room(ore(1)), 3 + STACK_MAX, 'the gap in the open stack was not counted');
  assert.equal(bag.room(wood(1)), STACK_MAX, 'the ore cell was offered to wood');
  assert.equal(bag.room(sword()), 1, 'one empty cell, one sword');

  bag.add(ore(3));
  assert.equal(bag.room(sword()), 1);
  bag.add(sword());
  assert.equal(bag.room(sword()), 0, 'a full bag still had room');
});

test('dropping a stack onto a matching one keeps the overflow on the cursor', () => {
  const bag = createInventory({ cols: 2, rows: 1 });
  bag.add(ore(STACK_MAX - 4));

  const back = bag.put(0, ore(9));
  assert.equal(countOf(back), 5, 'the overflow was lost into a full cell');
  assert.equal(countOf(bag.at(0)), STACK_MAX);
});

test('dropping onto something else still swaps', () => {
  const bag = createInventory({ cols: 2, rows: 1 });
  const blade = sword();
  bag.put(0, blade);

  const back = bag.put(0, ore(4));
  assert.equal(back, blade, 'the sword was overwritten instead of displaced');
  assert.equal(countOf(bag.at(0)), 4);
});

test('an oversized stack cannot be forced into one cell', () => {
  const bag = createInventory({ cols: 2, rows: 1 });
  const back = bag.put(0, ore(STACK_MAX + 6));

  assert.equal(countOf(bag.at(0)), STACK_MAX, 'a cell held more than a cell can');
  assert.equal(countOf(back), 6);
});

test('removing takes from the smallest stack first, and reports what it could not find', () => {
  const bag = createInventory({ cols: 4, rows: 1 });
  bag.put(0, ore(STACK_MAX));
  bag.put(1, ore(2));

  assert.equal(bag.remove('ironOre', 2), 0);
  assert.deepEqual(cells(bag), [STACK_MAX, null, null, null], 'the big stack was raided first');

  assert.equal(bag.remove('ironOre', STACK_MAX + 5), 5, 'it claimed to find more than was there');
  assert.equal(bag.countOf('ironOre'), 0);
  assert.deepEqual(cells(bag), [null, null, null, null]);
});

test('a material can never be worn', () => {
  const bag = createInventory({ cols: 2, rows: 1 });
  // A slot of 'none' matches no doll slot. An empty one would read as "goes
  // anywhere", which is the bug this is here to catch.
  assert.equal(ore(1).slot, 'none');
  for (const slot of ['mainHand', 'head', 'ring1']) {
    assert.equal(bag.accepts(slot, ore(1)), false, `ore was wearable in ${slot}`);
  }
  assert.equal(bag.firstSlotFor(ore(1)), null);
  assert.equal(bag.equip('mainHand', ore(1)), null);
  assert.equal(bag.wearing('mainHand'), null);
});
