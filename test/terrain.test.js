import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeMap } from '../Engine/editor/serialize.ts';
import { gridOf, mapDoc } from './helpers/terrainFixtures.ts';

/**
 * Where a map's ground comes from, end to end: the file it is written to, and
 * the World that walks it.
 *
 * What a plateau *looks* like — which edges are cliffs, which corners are
 * bevelled — is not here: it is derived from the cells around a tile rather
 * than stored, and terrain/mask and terrain/geometry test it directly.
 */

test('a map writes its terrain and its heights', () => {
  const grid = gridOf(['00', '01']);
  const built = serializeMap(
    { id: 'y', name: 'Y', terrain: grid, terrainIds: ['grass', 'sand'], stepHeight: 2 },
    (id) => ({ grass: 'gr', sand: 'sa' })[id] ?? '',
  );

  assert.match(built, /terrainKeys: \{ 'gr': 'grass', 'sa': 'sand' \},/);
  assert.match(built, /height: \[\n {4}'\.\.',\n {4}'\.1',\n {2}\],/);
  assert.match(built, /terrain: \[\n {4}'grgr',\n {4}'grgr',\n {2}\],/);
  assert.match(built, /stepHeight: 2,/);

  // A map that never thought about it says nothing: one block of step is the
  // ordinary answer.
  const plain = serializeMap(mapDoc(['..', '..']), () => 'gr');
  assert.ok(!plain.includes('stepHeight'));
  // Ramps are gone, so nothing writes a slope list any more.
  assert.ok(!plain.includes('tops'));
});

/**
 * A map in the current terrain format, from a grid of height characters.
 *
 * World reads the map's rows rather than a grid, so these stay row-shaped.
 * Every cell is the same terrain: these tests are about height and walkability,
 * and a terrain type has no say in either.
 */
const mapOf = (height, extra = {}) => ({
  id: 'w',
  name: 'W',
  terrainKeys: { gr: 'grass' },
  height,
  terrain: height.map((row) => [...row].map(() => 'gr').join('')),
  ...extra,
});

test('the ground is flat across a tile and steps to the next', async () => {
  const { World } = await import('../Engine/src/game/world.ts');
  //  0 0 2
  //  0 0 2
  const world = new World(mapOf(['002', '002']));

  // Flat all the way across its own tile, right up to the edge — where the old
  // surface would already have been climbing toward the neighbour.
  assert.equal(world.heightAt(0.5, 0.5), 0);
  assert.equal(world.heightAt(1.99, 0.5), 0);
  // And a hard step at the boundary rather than a slope through it.
  assert.equal(world.heightAt(2.01, 0.5), 2);

  // Off the map reads as the ground, not as a hole.
  assert.equal(world.heightAt(-1, 0), 0);
});

test('how much you can climb is the map\u2019s own answer', async () => {
  const { World } = await import('../Engine/src/game/world.ts');
  const low = new World(mapOf(['01']));

  // One level is a step by default: you can walk up it.
  assert.equal(low.canStand(1.5, 0.5, 0), true);
  // Two is a cliff, which is what makes a tall column a wall without anything
  // having to declare itself one.
  const tall = new World(mapOf(['03']));
  assert.equal(tall.canStand(1.5, 0.5, 0), false);
  // Unless the map says otherwise.
  const climber = new World(mapOf(['03'], { stepHeight: 3 }));
  assert.equal(climber.canStand(1.5, 0.5, 0), true);

  // Down is not the same rule. A step height is about climbing, and a
  // symmetric rule strands anything standing on a raised tile: every way off it
  // is a drop taller than a step, so it cannot move at all. This is the case
  // that froze the player on the dungeon's own spawn.
  assert.equal(tall.canStand(0.5, 0.5, 3), true);
});

test('standing beside a ledge is allowed, and climbing onto one works', async () => {
  const { World } = await import('../Engine/src/game/world.ts');
  const world = new World(mapOf(['01']));

  // The old surface had a footprint check that refused any position whose
  // corners straddled two heights. On stepped ground that is every position
  // next to every step, so it would have made a step impossible to climb — the
  // regression this asserts against.
  assert.equal(world.canStand(0.95, 0.5, 0), true);
  assert.equal(world.canStand(1.05, 0.5, 0), true);
});

test('walking into a step too tall to climb stops, and stays stopped', async () => {
  const { World, PLAYER_RADIUS } = await import('../Engine/src/game/world.ts');
  //  0 3   — a three-level wall at tile 1, with one block of step allowed
  const world = new World(mapOf(['03']));
  const pos = { gx: 0.5, gy: 0.5 };

  // The body's edge comes to rest against the face of the cliff, not with its
  // centre inside it: a rise is refused on the footprint, unlike a drop.
  const seen = [];
  for (let i = 0; i < 20; i += 1) {
    world.move(pos, 0.1, 0);
    seen.push(pos.gx);
  }
  assert.ok(Math.abs(pos.gx + PLAYER_RADIUS - 1) < 1e-3, `stopped at ${pos.gx}, not flush`);

  // And it never goes backwards on the way. This is the actual bug: the snap
  // to flush was computed from the footprint while the height test read the
  // centre, so the body was shoved back off the edge, walked up to it again,
  // and buzzed there for as long as the key was held.
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(seen[i] >= seen[i - 1] - 1e-9, `moved backwards: ${seen[i - 1]} to ${seen[i]}`);
  }
});

test('a step within the step height is still walked straight up', async () => {
  const { World } = await import('../Engine/src/game/world.ts');
  const world = new World(mapOf(['01']));
  const pos = { gx: 0.5, gy: 0.5 };

  for (let i = 0; i < 20; i += 1) world.move(pos, 0.1, 0);
  // One level is a step, so the footprint rule must not touch it — the whole
  // point of a step height is that you can walk onto it.
  assert.ok(pos.gx > 1.5, `stopped at ${pos.gx} instead of climbing`);
  assert.equal(world.heightAt(pos.gx, pos.gy), 1);
});

test('a body already inside a cliff can still walk out of it', async () => {
  const { World } = await import('../Engine/src/game/world.ts');
  const world = new World(mapOf(['03']));
  // Standing with its footprint over the tall tile — spawned there, or the
  // ground came up underneath it. Refusing every move on the footprint rule
  // would leave it stuck for good, which is worse than any amount of clipping.
  const pos = { gx: 0.95, gy: 0.5 };

  world.move(pos, -0.1, 0);
  assert.ok(pos.gx < 0.95, 'away from the cliff is always allowed');

  // And it still cannot push further in.
  const stuck = { gx: 0.95, gy: 0.5 };
  world.move(stuck, 0.1, 0);
  assert.equal(stuck.gx, 0.95);
});

test('the body climbs to a new step instead of appearing at it', async () => {
  const { riseToward, RISE_TIME } = await import('../Engine/src/render/player.ts');

  // One level takes RISE_TIME, so half of it covers half the step.
  assert.equal(riseToward(0, 1, RISE_TIME / 2), 0.5);
  // And the second half arrives exactly, rather than approaching forever the
  // way a decay would.
  assert.equal(riseToward(0.5, 1, RISE_TIME / 2), 1);

  // Falling is the same rule in the other direction.
  assert.equal(riseToward(1, 0, RISE_TIME / 2), 0.5);

  // A long frame lands on the target rather than shooting past it and
  // rubber-banding back — the failure that turns a hitch into a bounce.
  assert.equal(riseToward(0, 1, RISE_TIME * 10), 1);
  assert.equal(riseToward(3, 0, 1), 0);

  // No dt at all means arrive now: a fresh level or a teleport should start
  // where it stands rather than flying in from the last place.
  assert.equal(riseToward(0, 4, 0), 4);
});
