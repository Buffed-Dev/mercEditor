import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODIFIER_TYPES,
  curveAt,
  defaultModifier,
  defaultVfx,
  modifierFields,
  modifiersFor,
  normalizeVfx,
  partsOf,
  sheetFrames,
  sheetKeys,
} from '../Engine/src/data/vfx.ts';
import { DEFAULT_ENV, normalizeEnv } from '../Engine/src/data/mapFormat.ts';
import { abilityFields, normalizeAbility } from '../Engine/src/data/abilities.ts';
import { serializeRules } from '../Engine/editor/serializeData.ts';
import { serializeMap } from '../Engine/editor/serialize.ts';
import { mapDoc } from './helpers/terrainFixtures.ts';

/**
 * The parts of the VFX feature that are not Babylon: the shape of a definition,
 * what an old one turns into, and the two files an effect has to survive a
 * round trip through — its own rules module, and the map that places one.
 *
 * What the particles actually look like is not testable here and is not worth
 * pretending otherwise; that is what the stage in the editor is for.
 */

test('an effect read back from a file gains both of its halves', () => {
  const sparse = normalizeVfx({ id: 'smoke', emitter: { count: 12 }, particle: { size: 0.4 } });
  assert.equal(sparse.emitter.count, 12);
  assert.equal(sparse.particle.size, 0.4);
  // Everything it did not say still has a value, and the two lists exist.
  assert.equal(sparse.emitter.shape, 'cone');
  assert.equal(sparse.particle.shape, 'dot');
  assert.deepEqual(sparse.emitter.modifiers, []);
  assert.deepEqual(sparse.particle.modifiers, []);
});

test('a shape the tables no longer have falls back rather than breaking', () => {
  const odd = normalizeVfx({ id: 'x', emitter: { shape: 'trapezoid' }, particle: { shape: 'hex' } });
  assert.equal(odd.emitter.shape, 'cone');
  assert.equal(odd.particle.shape, 'dot');

  // A modifier nobody defines is dropped outright: there is nothing sensible to
  // turn it into, and a silent no-op in the list would be a lie about the list.
  const kept = normalizeVfx({
    id: 'x',
    emitter: {},
    particle: { modifiers: [{ kind: 'nonsense' }, { kind: 'randomize' }] },
  });
  assert.equal(kept.particle.modifiers.length, 1);
  assert.equal(kept.particle.modifiers[0].kind, 'randomize');
});

test('a modifier carries its own fields, and a typed one its type’s', () => {
  const spin = defaultModifier('spin');
  assert.deepEqual(Object.keys(spin).sort(), ['kind', 'spin', 'spinStart']);

  // Movement's fields come from the kind of movement it is.
  const spiral = defaultModifier('movement', 'spiral');
  assert.equal(spiral.type, 'spiral');
  assert.deepEqual(modifierFields(spiral).sort(), ['rise', 'turn', 'widen']);
  assert.equal(defaultModifier('movement', 'sideways').type, MODIFIER_TYPES.movement.typeDefault);
});

test('each half is offered only the modifiers that mean something to it', () => {
  const emitter = modifiersFor('emitter').map(([kind]) => kind);
  const particle = modifiersFor('particle').map(([kind]) => kind);

  // An emitter has no lifetime to randomise over; a particle has no transform.
  assert.ok(emitter.includes('transform'));
  assert.ok(!emitter.includes('randomize'));
  assert.ok(particle.includes('randomize'));
  assert.ok(!particle.includes('transform'));
  // Both can be moved and both can ramp.
  for (const kind of ['movement', 'overTime']) {
    assert.ok(emitter.includes(kind) && particle.includes(kind), `${kind} belongs to both`);
  }
});

test('every curve starts at nothing and ends where it should', () => {
  for (const curve of ['linear', 'hold', 'quick', 'smooth']) {
    assert.equal(curveAt(curve, 0), 0, `${curve} starts at 0`);
    assert.equal(curveAt(curve, 1), 1, `${curve} ends at 1`);
  }
  // The odd one out runs to the far value and back, which is the whole point.
  assert.equal(curveAt('bell', 0), 0);
  assert.equal(curveAt('bell', 0.5), 1);
  assert.equal(curveAt('bell', 1), 0);
  // Out of range is clamped rather than extrapolated.
  assert.equal(curveAt('linear', -1), 0);
  assert.equal(curveAt('linear', 9), 1);
});

test('an effect written in the old flat shape is read, not lost', () => {
  const old = {
    id: 'campfire',
    label: 'Campfire',
    color: 0xffc040,
    fadeTo: 0x902000,
    glow: true,
    rate: 70,
    burst: 0,
    life: 0.7,
    size: 0.22,
    sizeEnd: 0.11,
    speed: 1.1,
    spread: 20,
    gravity: 0.6,
    radius: 0.12,
    height: 0.15,
    duration: 0,
  };
  const now = normalizeVfx(old);

  assert.equal(now.id, 'campfire');
  assert.equal(now.emitter.mode, 'continuous');
  assert.equal(now.emitter.count, 70);
  assert.equal(now.emitter.radius, 0.12);
  assert.equal(now.emitter.lift, 0.15);
  assert.equal(now.particle.life, 0.7);
  assert.equal(now.particle.size, 0.22);
  // The old on/off glow is 0 or 1 of the dial that replaced it.
  assert.equal(now.particle.glow, 1);

  // What the old form said with dedicated fields is a modifier now: the shrink
  // to sizeEnd and the fade to its death colour.
  const ramp = now.particle.modifiers.find((mod) => mod.kind === 'overTime');
  assert.ok(ramp, 'the ramp survived');
  assert.equal(ramp.scaleTo, 0.5); // sizeEnd 0.11 of size 0.22
  assert.equal(ramp.colorTo, 0x902000);
});

test('an old burst becomes a burst rather than a rate', () => {
  const now = normalizeVfx({ id: 'boom', rate: 0, burst: 90, spread: 180 });
  assert.equal(now.emitter.mode, 'burst');
  assert.equal(now.emitter.count, 90);
  // A spread wide enough to stop being a cone *was* how you asked for a ball.
  assert.equal(now.emitter.shape, 'sphere');
});

test('an old movement list is carried across as movement modifiers', () => {
  const now = normalizeVfx({ id: 'swirl', movements: [{ type: 'spiral', turn: 200 }] });
  const moves = now.particle.modifiers.filter((mod) => mod.kind === 'movement');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].type, 'spiral');
  assert.equal(moves[0].turn, 200);
});

test('an effect knows which kind it is, and keeps the other kind"s settings', () => {
  assert.equal(normalizeVfx({ id: 'x' }).kind, 'particles');
  assert.deepEqual(partsOf('particles'), ['emitter', 'particle']);
  assert.deepEqual(partsOf('sheet'), ['sheet']);

  // Both halves are carried whichever kind it is, so switching across and back
  // finds what you had rather than a default.
  const flip = normalizeVfx({ id: 'x', kind: 'sheet', particle: { size: 0.9 } });
  assert.equal(flip.kind, 'sheet');
  assert.equal(flip.particle.size, 0.9);
  assert.ok(flip.sheet, 'the sheet half exists too');
  // Anything that is not the sheet kind is the particle one, whatever it says.
  assert.equal(normalizeVfx({ id: 'x', kind: 'nonsense' }).kind, 'particles');
});

test('a sheet shows only its own shape"s geometry, and counts its cells', () => {
  const plane = normalizeVfx({ id: 'x', kind: 'sheet' }).sheet;
  assert.ok(sheetKeys(plane).includes('width'));
  assert.ok(!sheetKeys(plane).includes('radius'));

  const disc = normalizeVfx({ id: 'x', kind: 'sheet', sheet: { shape: 'disc' } }).sheet;
  assert.ok(sheetKeys(disc).includes('radius'));
  assert.ok(!sheetKeys(disc).includes('width'));

  // A clip is where it starts and how many from there: 5 and 5 plays 5 to 9.
  assert.deepEqual(sheetFrames({ columns: 5, rows: 5, frameFrom: 5, frames: 5 }), {
    columns: 5,
    rows: 5,
    first: 5,
    count: 5,
  });

  // 0 frames is the rest of the sheet, which saves counting a whole one.
  assert.deepEqual(sheetFrames({ columns: 4, rows: 4, frameFrom: 0, frames: 0 }), {
    columns: 4,
    rows: 4,
    first: 0,
    count: 16,
  });

  // Nothing may run off the end: a count longer than what is left is cut to
  // it, a start past the last cell lands on the last cell, and either way at
  // least one frame plays — a clip of nothing is not something anyone means.
  assert.equal(sheetFrames({ columns: 4, rows: 4, frameFrom: 12, frames: 99 }).count, 4);
  assert.equal(sheetFrames({ columns: 4, rows: 4, frameFrom: 99, frames: 3 }).first, 15);
  assert.equal(sheetFrames({ columns: 4, rows: 4, frameFrom: 15, frames: 0 }).count, 1);
});

test('the rules file it is written to parses back to what went in', async () => {
  const effect = defaultVfx('shine');
  effect.emitter.modifiers = [defaultModifier('transform'), defaultModifier('movement', 'orbit')];
  effect.particle.modifiers = [defaultModifier('overTime'), defaultModifier('randomize')];
  effect.sheet.modifiers = [defaultModifier('movement', 'drift')];

  const source = serializeRules('vfx', [effect]);
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.deepEqual(module.VFX[0], effect);
  // And reading it back changes nothing, which is what makes a save idempotent.
  assert.deepEqual(normalizeVfx(module.VFX[0]), effect);
});

test('an ability carries an effect and a trail, and none by default', () => {
  assert.equal(normalizeAbility({ id: 'punch' }).vfx, '');
  assert.equal(normalizeAbility({ id: 'punch', vfx: 'boom' }).vfx, 'boom');
  assert.equal(normalizeAbility({ id: 'bolt', target: 'projectile' }).trail, '');

  const fields = abilityFields({ target: 'projectile', cast: 'instant' });
  assert.ok(fields.includes('trail'));
  assert.ok(!abilityFields({ target: 'melee', cast: 'instant' }).includes('trail'));
});

test('a map remembers which effect stands on which tile', () => {
  const source = serializeMap({
    ...mapDoc(['....', '....'], { id: 'shrine', name: 'Shrine' }),
    vfx: [{ id: 'shine', gx: 1, gy: 2 }],
  });
  assert.match(source, /vfx: \[\s+\{ gx: 1, gy: 2, id: 'shine' \},/);
});

test('a map that says its clouds with a number is read as clouds switched on', () => {
  // The setting was the strength before it was a switch, so an old map still
  // reads: on, and that strong. Everything it never mentioned comes back too.
  const old = normalizeEnv({ clouds: 0.4, fogReach: 2 });
  assert.equal(old.clouds, true);
  assert.equal(old.cloudShade, 0.4);
  assert.equal(old.fogReach, 2);
  assert.equal(old.fog, DEFAULT_ENV.fog);

  assert.equal(normalizeEnv({ clouds: 0 }).clouds, false);
  assert.equal(normalizeEnv({ clouds: true }).cloudShade, DEFAULT_ENV.cloudShade);

  // And a save writes every switch it has, so nothing is lost by omission.
  const source = serializeMap(mapDoc(['..'], { id: 'x', name: 'X', env: { clouds: 0.4 } }));
  for (const key of ['lighting', 'ao', 'fog', 'clouds']) {
    assert.match(source, new RegExp(`\n    ${key}: (true|false),`), `${key} was written`);
  }
  assert.match(source, /\n {4}cloudShade: 0.4,/);
  assert.match(source, /\n {4}sky: 0x[0-9a-f]{6},/);
});
