import type { Effect } from '@babylonjs/core/Materials/effect.js';
import type { PBRCustomMaterial } from '@babylonjs/materials/custom/pbrCustomMaterial.js';
import type { MaterialInput } from '../data/materials.ts';
import { colorOf } from './materials.ts';

type MaterialOf = (id: string) => MaterialInput | null;

const DEFINITIONS = /* glsl */ `
float mercVariationHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float mercVariationNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mercVariationHash(i), mercVariationHash(i + vec2(1.0, 0.0)), f.x),
    mix(mercVariationHash(i + vec2(0.0, 1.0)), mercVariationHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float mercVariationFbm(vec2 p) {
  return mercVariationNoise(p) * 0.52 + mercVariationNoise(p * 2.03 + vec2(17.1, 9.2)) * 0.28
    + mercVariationNoise(p * 4.11 + vec2(43.7, 31.6)) * 0.14
    + mercVariationNoise(p * 8.23 + vec2(11.9, 67.4)) * 0.06;
}
`;

// Variation is deliberately quantised to the terrain grid. A tile keeps its
// texture detail intact and receives one colour weight as a whole; the noise
// only decides how neighbouring tiles differ. This is the authored, blocky
// variation used by the editor rather than a filter drawn over every texel.
const ALBEDO = /* glsl */ `
if ((normalW.y > 0.95 || materialVariationAllFaces > 0.5) && materialVariation.x > 0.5 && materialVariation.y > 0.0001) {
  // Preview compresses six logical tiles into its plane; the map scale is one.
  // Quantise before sampling so every fragment of one block gets one answer.
  vec2 cell = floor(vPositionW.xz * materialVariationCoordinateScale + vec2(0.0001));
  vec2 sampleAt = cell * materialVariation.z;
  float broad = mercVariationFbm(sampleAt * 0.72 + vec2(3.8, 19.4));
  float local = mercVariationHash(cell + vec2(41.7, 13.2));
  float rawCoverage = broad;

  if (materialVariationNoiseType > 0.5 && materialVariationNoiseType < 1.5) {
    // Neighbouring blocks gather into clearer light and dark clumps.
    rawCoverage = smoothstep(0.38, 0.66, broad);
  } else if (materialVariationNoiseType > 1.5 && materialVariationNoiseType < 2.5) {
    // A per-cell random layer breaks up the broader grouping.
    rawCoverage = broad * 0.48 + local * 0.52;
  } else if (materialVariationNoiseType > 2.5) {
    // Correlation is longer across X than Z, producing blocky bands.
    vec2 streakAt = vec2(cell.x * materialVariation.z * 0.28, cell.y * materialVariation.z * 1.7);
    rawCoverage = mercVariationFbm(streakAt + vec2(21.4, 6.8));
  }

  // Amount changes only the difference between blocks. At zero they all share
  // the midpoint; Strength still controls the overall colour contribution.
  float coverage = mix(0.5, rawCoverage, materialVariation.w);
  float mask = coverage * materialVariation.y;
  // A real colour blend, not a multiplier: white can lighten the material and
  // black can darken it, while texture detail stays untouched inside each tile.
  surfaceAlbedo = mix(surfaceAlbedo, materialVariationColor, clamp(mask, 0.0, 1.0));
}
`;

/** Add per-material terrain colour variation to a top-surface custom shader. */
export function createTerrainVariation(initialMaterialOf: MaterialOf) {
  let materialOf = initialMaterialOf;
  const configured = new WeakSet<PBRCustomMaterial>();

  function configure(
    material: PBRCustomMaterial,
    materialId: string,
    allFaces = false,
    coordinateScale: number | (() => number) = 1,
  ): void {
    if (configured.has(material)) return;
    configured.add(material);
    material.AddUniform('materialVariation', 'vec4', undefined);
    material.AddUniform('materialVariationColor', 'vec3', undefined);
    material.AddUniform('materialVariationAllFaces', 'float', undefined);
    material.AddUniform('materialVariationCoordinateScale', 'float', undefined);
    material.AddUniform('materialVariationNoiseType', 'float', undefined);
    material.Fragment_Definitions(`${material.CustomParts.Fragment_Definitions ?? ''}\n${DEFINITIONS}`);
    material.Fragment_Custom_Albedo(`${material.CustomParts.Fragment_Custom_Albedo ?? ''}\n${ALBEDO}`);
    material.onBindObservable.add(() => {
      const effect: Effect | null = material.getEffect();
      if (!effect) return;
      const definition = materialOf(materialId);
      const tint = colorOf(definition?.variationColor ?? 0xffffff);
      effect.setFloat4(
        'materialVariation', definition?.variationEnabled ? 1 : 0,
        definition?.variationStrength ?? 0, definition?.variationNoiseScale ?? 0.35,
        definition?.variationNoiseStrength ?? 0.7,
      );
      effect.setFloat3('materialVariationColor', tint.r, tint.g, tint.b);
      effect.setFloat('materialVariationAllFaces', allFaces ? 1 : 0);
      const noiseType = definition?.variationNoiseType ?? 'soft';
      effect.setFloat(
        'materialVariationNoiseType',
        noiseType === 'clumps' ? 1 : noiseType === 'mottled' ? 2 : noiseType === 'streaks' ? 3 : 0,
      );
      effect.setFloat(
        'materialVariationCoordinateScale',
        typeof coordinateScale === 'function' ? coordinateScale() : coordinateScale,
      );
    });
  }

  return {
    configure,
    retarget(nextMaterialOf: MaterialOf) { materialOf = nextMaterialOf; },
  };
}
