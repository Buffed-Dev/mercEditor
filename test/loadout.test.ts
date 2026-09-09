/**
 * What you can do, and which key does it.
 *
 * Two rules to pin down. The first is that the two are reconciled rather than
 * kept in step by hand: an ability you no longer have cannot stay bound, and
 * one you have just been given does not sit unusable until you find it in a
 * menu.
 *
 * The second is that **the first key belongs to the main hand**. A weapon puts
 * its attack there, an empty hand puts your fists there, and nothing else may
 * be bound to it — so most of what follows is driving equipment through that
 * key and checking it says the right thing on both sides of the change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SLOT_BINDINGS } from '../Engine/src/data/abilities.ts';
import { createCharacter } from '../Engine/src/game/character.ts';
import { rollItem } from '../Engine/src/game/items.ts';
import {
  SLOT_COUNT,
  WEAPON_SLOT,
  assignSlot,
  knownAbilities,
  loadoutView,
  mainHandAbility,
  syncSlots,
} from '../Engine/src/game/loadout.ts';

const SWORD = { id: 'sword', label: 'Sword', slot: 'mainHand', grants: 'swing', stats: [] };
const GUN = { id: 'gun', label: 'Gun', slot: 'mainHand', grants: 'shoot', stats: [] };
const SHIELD = { id: 'shield', label: 'Shield', slot: 'offHand', grants: 'block', stats: [] };
const PLAIN = { id: 'hat', label: 'Hat', slot: 'head', stats: [] };

const ABILITIES = [
  { id: 'punch', label: 'Punch' },
  { id: 'slam', label: 'Slam' },
  { id: 'dash', label: 'Dash' },
  { id: 'swing', label: 'Swing' },
  { id: 'shoot', label: 'Shoot' },
  { id: 'block', label: 'Block' },
];

import type { ItemInput } from '../Engine/src/data/items.ts';

/** A character, optionally holding things, with its bar already reconciled. */
function hero({
  worn = [],
  innate = ['slam', 'dash'],
  unarmed = 'punch',
}: { worn?: readonly ItemInput[]; innate?: readonly string[]; unarmed?: string } = {}) {
  const character = createCharacter();
  for (const def of worn) character.inventory.equip(def.slot ?? '', rollItem(def));

  const sync = () =>
    syncSlots(
      character,
      knownAbilities(innate, character.inventory, unarmed),
      mainHandAbility(unarmed, character.inventory),
    );
  sync();

  const view = () =>
    loadoutView({
      character,
      abilities: ABILITIES,
      innate,
      inventory: character.inventory,
      unarmed,
    });

  return { character, sync, view, unarmed, innate };
}

test('there are as many slots as there are bindings, and the first is the hand', () => {
  assert.equal(SLOT_COUNT, SLOT_BINDINGS.length);
  assert.equal(SLOT_COUNT, 5);
  assert.equal(WEAPON_SLOT, 0);
  assert.equal(SLOT_BINDINGS[WEAPON_SLOT].label, 'LMB');
});

test('an empty hand puts your fists on the first key', () => {
  const { character } = hero();
  assert.equal(character.slots[0], 'punch');
  assert.deepEqual(character.slots, ['punch', 'slam', 'dash', null, null]);
});

test('a weapon takes the first key from your fists, and gives it back', () => {
  const { character, sync } = hero();

  character.inventory.equip('mainHand', rollItem(SWORD));
  sync();
  assert.deepEqual(character.slots, ['swing', 'slam', 'dash', null, null]);
  assert.ok(!character.slots.includes('punch'), 'you can still punch with a sword in hand');

  character.inventory.unequip('mainHand');
  sync();
  assert.deepEqual(character.slots, ['punch', 'slam', 'dash', null, null]);
});

test('swapping weapons swaps the first key, with nothing in between', () => {
  const { character, sync } = hero({ worn: [SWORD] });
  assert.equal(character.slots[0], 'swing');

  character.inventory.unequip('mainHand');
  character.inventory.equip('mainHand', rollItem(GUN));
  sync();

  assert.equal(character.slots[0], 'shoot');
  assert.ok(!character.slots.includes('swing'), 'the old weapon is still bound somewhere');
});

test('what is worn elsewhere is an ordinary ability on an ordinary key', () => {
  const { character, sync } = hero({ worn: [SHIELD] });
  assert.equal(character.slots[0], 'punch', 'the off hand took the weapon key');
  assert.ok(character.slots.slice(1).includes('block'));

  character.inventory.unequip('offHand');
  sync();
  assert.ok(!character.slots.includes('block'));
  assert.equal(character.slots[0], 'punch');
});

test('an item that grants nothing changes nothing', () => {
  const { character, sync } = hero();
  const before = character.slots;
  character.inventory.equip('head', rollItem(PLAIN));
  assert.equal(sync(), false, 'a hat rearranged the bar');
  assert.deepEqual(character.slots, before);
});

test('an actor with no unarmed attack and an empty hand has an empty first key', () => {
  const { character } = hero({ unarmed: '', innate: ['slam'] });
  assert.equal(character.slots[0], null);
  assert.deepEqual(character.slots, [null, 'slam', null, null, null]);
});

test('nothing else fills the first key, however empty it looks', () => {
  const { character } = hero({ unarmed: '', innate: ['slam', 'dash', 'bolt'] });
  assert.equal(character.slots[0], null, 'an innate ability took the hand key');
  assert.deepEqual(character.slots, [null, 'slam', 'dash', 'bolt', null]);
});

test('nothing else may be bound over the attack', () => {
  const { character } = hero();

  assert.equal(assignSlot(character, 0, 'dash'), false, 'something was bound over the hand');
  assert.equal(character.slots[0], 'punch');
  assert.equal(assignSlot(character, 0, null), false, 'the attack was cleared');
  assert.equal(character.slots[0], 'punch');
});

test('the attack can be moved to another key, and takes that key with it', () => {
  const { character, sync } = hero();

  assert.equal(assignSlot(character, 3, 'punch'), true);
  assert.equal(character.handSlot, 3);
  assert.deepEqual(character.slots, [null, 'slam', 'dash', 'punch', null]);

  // What is on that key is still decided by the hand: drawing a sword puts the
  // swing where the fists were, not back on the first key.
  character.inventory.equip('mainHand', rollItem(SWORD));
  sync();
  assert.equal(character.slots[3], 'swing');
  assert.equal(character.slots[0], null, 'the attack went home when a weapon was drawn');
});

test('moving the attack onto an occupied key swaps with it', () => {
  const { character } = hero();

  assignSlot(character, 1, 'punch');
  assert.equal(character.handSlot, 1);
  assert.deepEqual(character.slots, ['slam', 'punch', 'dash', null, null]);

  // And back again, which is the same move.
  assignSlot(character, 0, 'punch');
  assert.equal(character.handSlot, 0);
  assert.deepEqual(character.slots, ['punch', 'slam', 'dash', null, null]);
});

test('the other four still swap and clear', () => {
  const { character } = hero();

  assignSlot(character, 4, 'slam');
  assert.deepEqual(character.slots, ['punch', null, 'dash', null, 'slam']);

  assignSlot(character, 2, 'slam');
  assert.deepEqual(character.slots, ['punch', null, 'slam', null, 'dash'], 'they did not swap');

  assignSlot(character, 2, null);
  assert.deepEqual(character.slots, ['punch', null, null, null, 'dash']);
});

test('syncing twice changes nothing the second time', () => {
  const { sync } = hero({ worn: [SWORD] });
  assert.equal(sync(), false);
});

test('what you know leads with the hand', () => {
  const bare = hero();
  assert.deepEqual(bare.view().known.map((a) => a?.id), ['punch', 'slam', 'dash']);

  const armed = hero({ worn: [SWORD, SHIELD] });
  assert.deepEqual(armed.view().known.map((a) => a?.id), ['swing', 'slam', 'dash', 'block']);
});

test('the view marks the hand key and says which of the two it is', () => {
  const bare = hero().view();
  assert.equal(bare.slots[0].hand, true);
  assert.equal(bare.slots[0].ability?.label, 'Punch');
  assert.equal(bare.slots[0].ability?.unarmed, true, 'bare hands were not named as such');
  assert.equal(bare.hand?.id, 'punch');
  assert.deepEqual(
    bare.slots.slice(1).map((slot) => slot.hand),
    [false, false, false, false],
  );

  const armed = hero({ worn: [SWORD] }).view();
  assert.equal(armed.slots[0].ability?.label, 'Swing');
  assert.equal(armed.slots[0].ability?.unarmed, false);
  assert.equal(armed.slots[0].ability?.from, 'Sword', 'the screen cannot say where it came from');
  assert.equal(armed.hand?.id, 'swing');
});

test('an ability the rules no longer define is shown, not silently dropped', () => {
  const view = hero({ innate: ['slam', 'ghost'] }).view();
  const ghost = view.known.find((ability) => ability?.id === 'ghost');
  assert.equal(ghost?.missing, true);
  assert.equal(ghost?.label, 'ghost', 'it lost the only name it had left');
});
