/**
 * What you can do, and which key does it.
 *
 * Two different questions, kept apart. **Known** abilities are whatever you
 * happen to have: the ones your archetype was born with, plus one for every
 * weapon you are wearing that grants one. That set is *derived* — it is read
 * off the body every time it is asked for, so putting a sword on is the whole
 * of learning to swing and taking it off is the whole of forgetting.
 *
 * **Slots** are the five bindings, and they are *stored*, on the character —
 * because where you like your dash is a preference, and a preference that reset
 * every time you changed gloves would not be one.
 *
 * **One key is the main hand's**, and *what* is on it is not yours to assign:
 * whatever is in that hand decides it — a sword puts its swing there, a gun its
 * shot, and an empty hand your bare fists. You never draw a sword and find it
 * bound to nothing.
 *
 * *Which* key that is, though, is a preference like any other, kept on the
 * character as `handSlot` and moved by dragging the attack itself onto another
 * key. Left-click is only where it starts.
 *
 * The rest are yours, and are reconciled with what is known by
 * `syncSlots` after anything that could change what is worn. Nothing else has
 * to remember to tidy up: an ability that is no longer known cannot stay bound,
 * and a newly known one takes the first free key rather than waiting to be
 * found in a menu.
 */

import { SLOT_BINDINGS } from '../data/abilities.ts';
import { EQUIPMENT_SLOTS } from './inventory.js';

/** How many bindings there are. The list of bindings is the authority. */
export const SLOT_COUNT = SLOT_BINDINGS.length;

/**
 * The key the main hand starts on. First, because it is the one you attack
 * with; a character that has moved it keeps the choice in `handSlot`, and
 * everything below reads that rather than this.
 */
export const WEAPON_SLOT = 0;

/**
 * What the main hand attacks with: its weapon's ability, or bare hands.
 *
 * `unarmed` comes off the archetype, so a thing with claws and a thing with
 * fists are data rather than a branch — and something with neither simply has
 * an empty first key until it picks something up.
 */
export function mainHandAbility(unarmed = '', inventory = null) {
  return inventory?.wearing('mainHand')?.grants || unarmed || null;
}

/**
 * Everything this actor can currently do, the main hand's attack first.
 *
 * Ordered and de-duplicated: two swords granting the same swing is one swing.
 * The hand leads because it is what the first key fires; after that it is what
 * you were born with, then whatever else you are wearing.
 */
export function knownAbilities(innate = [], inventory = null, unarmed = '') {
  const known = [];
  // The main hand's attack first: it is the one bound to the first key, and
  // listing it anywhere else would say it was optional.
  const hand = mainHandAbility(unarmed, inventory);
  if (hand) known.push(hand);
  for (const ability of innate) if (!known.includes(ability)) known.push(ability);
  for (const slot of EQUIPMENT_SLOTS) {
    const worn = inventory?.wearing(slot.id);
    if (worn?.grants && !known.includes(worn.grants)) known.push(worn.grants);
  }
  return known;
}

/**
 * Make the bound slots agree with what is known.
 *
 * Unknown ones are cleared and newly known ones are armed, in that order, so a
 * slot freed by taking a sword off is available to the sword you are putting on
 * in its place. Idempotent: calling it twice changes nothing the second time,
 * which is what lets every equipment path call it without any of them having to
 * know whether another already did.
 *
 * @returns {boolean} whether anything moved.
 */
export function syncSlots(character, known, hand = null) {
  let moved = false;
  const handSlot = character.handSlot ?? WEAPON_SLOT;

  // The main hand's key first, and it is simply taken. Whatever was sitting
  // there is not rehomed: it is either the weapon you just took off, which is
  // no longer known and would be cleared anyway, or something you bound there
  // before this rule existed.
  if (character.slots[handSlot] !== hand) {
    character.setSlot(handSlot, hand);
    moved = true;
  }

  for (let i = 0; i < character.slots.length; i++) {
    if (i === handSlot) continue;
    if (character.slots[i] && !known.includes(character.slots[i])) {
      character.setSlot(i, null);
      moved = true;
    }
  }

  for (const ability of known) {
    if (character.slots.includes(ability)) continue;
    // Anywhere but the hand's key: nothing else lands there, however empty it
    // looks.
    const free = character.slots.findIndex((slot, i) => i !== handSlot && !slot);
    if (free < 0) break;
    character.setSlot(free, ability);
    moved = true;
  }

  return moved;
}

/**
 * Put an ability on a key.
 *
 * Moving one that is already bound *swaps* rather than duplicating: an ability
 * is on at most one key, so dragging RMB onto 1 trades them, which is what
 * anyone dragging two things between two boxes expects. Dropping nothing on a
 * slot empties it.
 *
 * The main hand's attack is the one thing that carries its key with it: drop it
 * on another and `handSlot` follows, so the attack stays the attack and only
 * moves house. Nothing else may land on the key it is on, and it cannot be
 * cleared — what is on that key is decided by what you are holding, and a
 * binding that silently reverted the next time you changed weapons would be
 * worse than one you cannot make.
 */
export function assignSlot(character, index, ability) {
  if (index < 0 || index >= character.slots.length) return false;

  const handSlot = character.handSlot ?? WEAPON_SLOT;
  const hand = character.slots[handSlot];

  if (hand && ability === hand) {
    if (index === handSlot) return false;
    // Straight swap with whatever was there, exactly as any other pair of keys
    // trades, and then the hand's key is the one it landed on.
    character.setSlot(handSlot, character.slots[index] ?? null);
    character.setSlot(index, ability);
    character.setHandSlot(index);
    return true;
  }

  if (hand && index === handSlot) return false;

  const from = ability ? character.slots.indexOf(ability) : -1;
  const displaced = character.slots[index];

  character.setSlot(index, ability ?? null);
  // Only when it came from another slot. An ability dragged out of the list has
  // nowhere to send the displaced one, and it simply goes back to the list.
  if (from >= 0 && from !== index) character.setSlot(from, displaced ?? null);
  return true;
}

/**
 * Everything the abilities screen draws.
 *
 * Built here rather than in the panel so the panel stays something that only
 * writes text: what is known, what is bound where, and which of those a key
 * would actually fire.
 */
export function loadoutView({ character, abilities, innate = [], inventory = null, unarmed = '' }) {
  const known = knownAbilities(innate, inventory, unarmed);
  const hand = mainHandAbility(unarmed, inventory);
  const byId = new Map((abilities ?? []).map((ability) => [ability.id, ability]));
  const source = new Map();
  for (const slot of EQUIPMENT_SLOTS) {
    const worn = inventory?.wearing(slot.id);
    if (worn?.grants) source.set(worn.grants, worn.label);
  }

  const describe = (id) => {
    if (!id) return null;
    const ability = byId.get(id);
    return {
      id,
      label: ability?.label ?? id,
      // Bare hands are not granted by anything, so they are named as such.
      unarmed: id === (mainHandAbility(unarmed, null) || null),
      // Where it comes from, because "why can I not unequip this" and "why did
      // this vanish" are the same question asked from two directions.
      from: source.get(id) ?? null,
      missing: !ability,
    };
  };

  return {
    slots: character.slots.map((id, index) => ({
      index,
      binding: SLOT_BINDINGS[index]?.label ?? '',
      // Said out loud rather than left to be discovered by dragging at it:
      // this key holds the attack, so it takes nothing else — but the attack
      // itself can be dragged off it.
      hand: index === (character.handSlot ?? WEAPON_SLOT),
      ability: describe(id),
    })),
    // What the first key is, and why, for the screen to explain itself.
    hand: describe(hand),
    known: known.map(describe),
  };
}
