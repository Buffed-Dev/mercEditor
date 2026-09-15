import test from 'node:test';
import assert from 'node:assert/strict';
import { canBlend, normalizeTerrain } from '../Engine/src/data/terrains.ts';
import { normalizeMaterial } from '../Engine/src/data/materials.ts';

test('terrain blending is opt-in; an empty group acts as a wildcard', () => {
  const grass = normalizeTerrain({ id: 'grass', blendable: true, blendGroup: 'natural' });
  const sand = normalizeTerrain({ id: 'sand', blendable: true, blendGroup: 'natural' });
  const wood = normalizeTerrain({ id: 'wood', blendable: false, blendGroup: 'natural' });
  const magic = normalizeTerrain({ id: 'magic', blendable: true, blendGroup: 'arcane' });
  const ungrouped = normalizeTerrain({ id: 'mud', blendable: true });

  assert.equal(canBlend(grass, sand), true);
  assert.equal(canBlend(grass, wood), false);
  assert.equal(canBlend(grass, ungrouped), true);
  assert.equal(canBlend(grass, magic), false);
});

test('old terrain records remain hard-edged by default', () => {
  const old = normalizeTerrain({ id: 'old', top: 'stone' });
  assert.equal(old.blendable, false);
  assert.equal(old.blendWidth, 0.22);
  assert.equal(old.blendNoiseScale, 1);
  assert.equal(old.blendNoiseStrength, 0.65);
});

test('colour variation belongs to each material and remains opt-in', () => {
  const old = normalizeMaterial({ id: 'old', texture: 'stone.png' });
  const grass = normalizeMaterial({
    id: 'grass', variationEnabled: true, variationColor: 0x769b55,
    variationStrength: 0.22, variationNoiseType: 'mottled',
    variationNoiseScale: 0.3, variationNoiseStrength: 0.8,
  });
  assert.equal(old.variationEnabled, false);
  assert.equal(old.variationNoiseScale, 0.35);
  assert.equal(old.variationNoiseType, 'soft');
  assert.equal(grass.variationEnabled, true);
  assert.equal(grass.variationColor, 0x769b55);
  assert.equal(grass.variationStrength, 0.22);
  assert.equal(grass.variationNoiseType, 'mottled');
  assert.equal(grass.variationNoiseStrength, 0.8);
});

test('an unknown variation noise type falls back to soft patches', () => {
  const material = normalizeMaterial({ id: 'grass', variationNoiseType: 'missing' });
  assert.equal(material.variationNoiseType, 'soft');
});
