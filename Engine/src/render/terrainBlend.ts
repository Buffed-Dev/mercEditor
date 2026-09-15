import { Constants } from '@babylonjs/core/Engines/constants.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { Effect } from '@babylonjs/core/Materials/effect.js';
import type { PBRCustomMaterial } from '@babylonjs/materials/custom/pbrCustomMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { MaterialInput } from '../data/materials.ts';
import type { Terrain } from '../data/terrains.ts';
import type { TerrainGrid } from '../data/terrain/grid.ts';
import { colorOf, pictureFor, type UrlOf } from './materials.ts';

export const MAX_BLEND_TERRAINS = 8;

type Source = {
  grid: TerrainGrid;
  terrainIds: readonly string[];
  terrains: readonly Terrain[];
  materialOf: (id: string) => MaterialInput | null;
  urlOf: UrlOf;
};

const groupCode = (value: string): number => {
  // Empty is the wildcard group: an asset can simply enable Blendable.
  if (!value) return 1;
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 65521 + 1;
};

const GLSL = /* glsl */ `
float mercBlendHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}
float mercBlendNoise( vec2 p ) {
  vec2 cell = floor( p );
  vec2 part = fract( p );
  part = part * part * ( 3.0 - 2.0 * part );
  return mix(
    mix( mercBlendHash( cell ), mercBlendHash( cell + vec2( 1.0, 0.0 ) ), part.x ),
    mix( mercBlendHash( cell + vec2( 0.0, 1.0 ) ), mercBlendHash( cell + vec2( 1.0, 1.0 ) ), part.x ),
    part.y
  );
}
vec4 mercBlendCell( vec2 cell ) {
  if ( cell.x < 0.0 || cell.y < 0.0 || cell.x >= terrainBlendGridSize.x || cell.y >= terrainBlendGridSize.y ) return vec4( 0.0 );
  return texture2D( terrainBlendGrid, ( cell + 0.5 ) / terrainBlendGridSize );
}
vec4 mercBlendInfoFor( float kind ) {
  for ( int i = 0; i < ${MAX_BLEND_TERRAINS}; i ++ ) if ( abs( terrainBlendInfo[i].x - kind ) < 0.25 ) return terrainBlendInfo[i];
  return vec4( 0.0 );
}
float mercBlendStrengthFor( float kind ) {
  for ( int i = 0; i < ${MAX_BLEND_TERRAINS}; i ++ ) if ( abs( terrainBlendInfo[i].x - kind ) < 0.25 ) return terrainBlendStrength[i];
  return 0.0;
}
vec3 mercBlendSurface( float kind, vec2 worldXZ ) {
  vec4 uv = vec4( 1.0, 1.0, 0.0, 0.0 );
  vec3 tint = vec3( 1.0 );
  for ( int i = 0; i < ${MAX_BLEND_TERRAINS}; i ++ ) {
    if ( abs( terrainBlendInfo[i].x - kind ) < 0.25 ) { uv = terrainBlendUv[i]; tint = terrainBlendColor[i]; break; }
  }
  vec2 at = worldXZ * uv.xy + uv.zw;
  if ( abs( terrainBlendInfo[0].x - kind ) < 0.25 ) return toLinearSpace(texture2D( terrainBlendTexture0, at ).rgb) * tint;
  if ( abs( terrainBlendInfo[1].x - kind ) < 0.25 ) return toLinearSpace(texture2D( terrainBlendTexture1, at ).rgb) * tint;
  if ( abs( terrainBlendInfo[2].x - kind ) < 0.25 ) return toLinearSpace(texture2D( terrainBlendTexture2, at ).rgb) * tint;
  if ( abs( terrainBlendInfo[3].x - kind ) < 0.25 ) return toLinearSpace(texture2D( terrainBlendTexture3, at ).rgb) * tint;
  if ( abs( terrainBlendInfo[4].x - kind ) < 0.25 ) return toLinearSpace(texture2D( terrainBlendTexture4, at ).rgb) * tint;
  if ( abs( terrainBlendInfo[5].x - kind ) < 0.25 ) return toLinearSpace(texture2D( terrainBlendTexture5, at ).rgb) * tint;
  if ( abs( terrainBlendInfo[6].x - kind ) < 0.25 ) return toLinearSpace(texture2D( terrainBlendTexture6, at ).rgb) * tint;
  if ( abs( terrainBlendInfo[7].x - kind ) < 0.25 ) return toLinearSpace(texture2D( terrainBlendTexture7, at ).rgb) * tint;
  return tint;
}
float mercBlendFractal( vec2 p ) {
  return mercBlendNoise(p) * 0.57 + mercBlendNoise(p * 2.13 + 17.4) * 0.1
    + mercBlendNoise(p * 4.37 + 39.1) * 0.14;
}
`;

const ALBEDO = /* glsl */ `
if ( normalW.y > 0.95 && terrainBlendCurrent.y > 0.5 ) {
  vec2 p = vPositionW.xz;
  vec2 cell = floor(p);
  vec4 mine = mercBlendCell(cell);
  float mineKind = floor(mine.r * 255.0 + 0.5);
  float mineLevel = floor(mine.g * 255.0 + 0.5);
  if (abs(mineKind - terrainBlendCurrent.x) < 0.25) {
    vec3 sum = vec3(0.0);
    float total = 0.0;
    float foreignWeight = 0.0;
    // Each candidate owns a smooth square footprint. All tiles evaluate the
    // same world-space field, including diagonals, so path corners join.
    for (int dz = -1; dz <= 1; dz++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec2 candidate = cell + vec2(float(dx), float(dz));
        vec4 entry = mercBlendCell(candidate);
        float kind = floor(entry.r * 255.0 + 0.5);
        float level = floor(entry.g * 255.0 + 0.5);
        vec4 data = mercBlendInfoFor(kind);
        bool same = abs(kind - mineKind) < 0.25;
        bool group = terrainBlendCurrent.z < 1.5 || data.y < 1.5 || abs(data.y - terrainBlendCurrent.z) < 0.25;
        if (kind < 0.5 || abs(level - mineLevel) > 0.25 || (!same && (data.y < 0.5 || !group))) continue;
        float width = max(data.z, 0.01);
        vec2 noiseAt = p * max(data.w, 0.25) * 5.0;
        vec2 warp = vec2(mercBlendFractal(noiseAt), mercBlendFractal(noiseAt + vec2(73.2, 19.7))) - 0.5;
        vec2 sampleAt = p + warp * width * mercBlendStrengthFor(kind) * 1.6;
        vec2 distanceAt = abs(sampleAt - (candidate + 0.5));
        vec2 coverage = 1.0 - smoothstep(vec2(0.5 - width), vec2(0.5 + width), distanceAt);
        float weight = coverage.x * coverage.y;
        if (weight <= 0.00001) continue;
        // Keep the original material exactly in uniform regions. Foreign
        // samples follow the baked top UVs (1..2), rather than changing UV
        // phase at the boundary. Raw PNG samples MUST be decoded to linear.
        vec3 color = same ? surfaceAlbedo : mercBlendSurface(kind, fract(p) + 1.0);
        sum += color * weight;
        total += weight;
        if (!same) foreignWeight += weight;
      }
    }
    if (foreignWeight > 0.00001 && total > 0.00001) surfaceAlbedo = sum / total;
  }
}
`;

export function createTerrainBlend(scene: Scene, initial: Source) {
  let source = initial;
  let pixels = new Uint8Array(4);
  let gridTexture = RawTexture.CreateRGBATexture(pixels, 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
  const white = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
  const configured = new WeakSet<PBRCustomMaterial>();
  let slotTerrains: Array<Terrain | undefined> = [];
  let slotTextures: Array<Texture | null> = [];
  let info = new Float32Array(MAX_BLEND_TERRAINS * 4);
  let uv = new Float32Array(MAX_BLEND_TERRAINS * 4);
  let colors = new Float32Array(MAX_BLEND_TERRAINS * 3);
  let strengths = new Float32Array(MAX_BLEND_TERRAINS);

  function rebuildSlots(): void {
    slotTerrains = [];
    slotTextures = [];
    info = new Float32Array(MAX_BLEND_TERRAINS * 4);
    uv = new Float32Array(MAX_BLEND_TERRAINS * 4);
    colors = new Float32Array(MAX_BLEND_TERRAINS * 3);
    strengths = new Float32Array(MAX_BLEND_TERRAINS);
    source.terrainIds.slice(0, MAX_BLEND_TERRAINS).forEach((id, i) => {
      const terrain = source.terrains.find((one) => one.id === id);
      const def = terrain ? source.materialOf(terrain.top) : null;
      slotTerrains[i] = terrain;
      slotTextures[i] = def ? pictureFor(def, def.texture, scene, source.urlOf) : null;
      info.set([i + 1, terrain?.blendable ? groupCode(terrain.blendGroup) : 0, terrain?.blendWidth ?? 0.22, terrain?.blendNoiseScale ?? 1], i * 4);
      uv.set([def?.uScale ?? 1, def?.vScale ?? 1, def?.uOffset ?? 0, def?.vOffset ?? 0], i * 4);
      const tint = colorOf(def?.color ?? terrain?.tint ?? 0xffffff);
      colors.set([tint.r, tint.g, tint.b], i * 3);
      strengths[i] = terrain?.blendNoiseStrength ?? 0.65;
    });
  }

  function updateGrid(): void {
    // Painting a previously unused terrain appends to the map's kind table.
    if (slotTerrains.length !== Math.min(source.terrainIds.length, MAX_BLEND_TERRAINS)) rebuildSlots();
    const grid = source.grid;
    const next = new Uint8Array(Math.max(1, grid.cols * grid.rows) * 4);
    for (let i = 0; i < grid.kind.length; i += 1) { next[i * 4] = grid.kind[i]!; next[i * 4 + 1] = grid.level[i]!; next[i * 4 + 3] = 255; }
    if (gridTexture.getSize().width !== grid.cols || gridTexture.getSize().height !== grid.rows) {
      gridTexture.dispose();
      gridTexture = RawTexture.CreateRGBATexture(next, grid.cols, grid.rows, scene, false, false, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    } else gridTexture.update(next);
    pixels = next;
  }

  function configure(material: PBRCustomMaterial, kind: number): void {
    if (configured.has(material)) return;
    configured.add(material);
    material.AddUniform('terrainBlendGrid', 'sampler2D', undefined);
    material.AddUniform('terrainBlendGridSize', 'vec2', undefined);
    material.AddUniform('terrainBlendCurrent', 'vec4', undefined);
    material.AddUniform('terrainBlendNoise', 'vec2', undefined);
    material.AddUniform(`terrainBlendInfo[${MAX_BLEND_TERRAINS}]`, 'vec4', undefined);
    material.AddUniform(`terrainBlendUv[${MAX_BLEND_TERRAINS}]`, 'vec4', undefined);
    material.AddUniform(`terrainBlendColor[${MAX_BLEND_TERRAINS}]`, 'vec3', undefined);
    material.AddUniform(`terrainBlendStrength[${MAX_BLEND_TERRAINS}]`, 'float', undefined);
    for (let i = 0; i < MAX_BLEND_TERRAINS; i += 1) material.AddUniform(`terrainBlendTexture${i}`, 'sampler2D', undefined);
    material.Fragment_Definitions(`${material.CustomParts.Fragment_Definitions ?? ''}\n${GLSL}`);
    material.Fragment_Custom_Albedo(`${material.CustomParts.Fragment_Custom_Albedo ?? ''}\n${ALBEDO}`);
    material.onBindObservable.add(() => {
      const effect: Effect | null = material.getEffect();
      if (!effect) return;
      const current = slotTerrains[kind - 1];
      for (let i = 0; i < MAX_BLEND_TERRAINS; i += 1) effect.setTexture(`terrainBlendTexture${i}`, slotTextures[i] ?? white);
      effect.setTexture('terrainBlendGrid', gridTexture);
      effect.setFloat2('terrainBlendGridSize', source.grid.cols, source.grid.rows);
      effect.setFloat4('terrainBlendCurrent', kind, current?.blendable ? 1 : 0, current ? groupCode(current.blendGroup) : 0, current?.blendWidth ?? 0.22);
      effect.setFloat2('terrainBlendNoise', current?.blendNoiseStrength ?? 0.65, current?.blendNoiseScale ?? 1);
      effect.setArray4('terrainBlendInfo', info as unknown as number[]);
      effect.setArray4('terrainBlendUv', uv as unknown as number[]);
      effect.setArray3('terrainBlendColor', colors as unknown as number[]);
      effect.setArray('terrainBlendStrength', strengths as unknown as number[]);
    });
  }

  rebuildSlots();
  updateGrid();
  return {
    configure,
    updateGrid,
    retarget(next: Source) { source = next; rebuildSlots(); updateGrid(); },
    dispose() { gridTexture.dispose(); white.dispose(); },
  };
}
