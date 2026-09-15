import assert from 'node:assert/strict';
import test from 'node:test';
import { sunRig, type Ground } from '../Engine/src/render/lights.ts';

const flatWorld: Ground = { cols: 64, rows: 32, heightAt: () => 0 };

test('sun shadow projection is centred on the map, not its marker', () => {
  const a = sunRig({ type: 'directional', gx: 0, gy: 0, azimuth: 0, elevation: 45 }, flatWorld);
  const b = sunRig({ type: 'directional', gx: 50, gy: 20, azimuth: 0, elevation: 45 }, flatWorld);
  assert.deepEqual(a.position.asArray(), b.position.asArray());
  assert.deepEqual(a.direction.asArray(), b.direction.asArray());
});

test('sun frustum contains a rectangular map at any compass angle', () => {
  const rig = sunRig({ type: 'directional', gx: 0, gy: 0 }, flatWorld);
  assert.equal(rig.frustum, Math.hypot(64, 32) + 4);
  assert.ok(rig.maxZ > rig.frustum * 2);
});

test('sun compass rotates direction while preserving projection size', () => {
  const north = sunRig({ type: 'directional', gx: 0, gy: 0, azimuth: 0, elevation: 45 }, flatWorld);
  const east = sunRig({ type: 'directional', gx: 0, gy: 0, azimuth: 90, elevation: 45 }, flatWorld);
  assert.ok(north.direction.z < -0.7);
  assert.ok(east.direction.x < -0.7);
  assert.equal(north.frustum, east.frustum);
});
