import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { keep } from './sceneCache.ts';
import type { Scene } from '@babylonjs/core/scene.js';
import type { MaterialInput } from '../data/materials.ts';

/**
 * A material this module knows how to write onto.
 *
 * The two are not interchangeable and are not meant to be: a flat material is
 * a StandardMaterial with its lighting switched off, and a lit one is a
 * PBRMaterial. Which one a definition gets is decided once, by `materialFrom`.
 */
export type Surface = PBRMaterial | StandardMaterial;

/** Turns an asset id into somewhere it can be fetched from. */
export type UrlOf = (id: string) => string;

/**
 * The two kinds of material this game has, so no module has to decide again.
 *
 * Maps store colours as hex integers, which is what an editor colour field
 * produces and what a map file reads well as. Babylon wants a Color3, and that
 * conversion should happen in exactly one place.
 */

export const colorOf = (hex: number): Color3 =>
  new Color3(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);

/**
 * A lit surface: floors, walls, bodies. Metallic/roughness, so the art
 * direction can reach for a metal look without a second kind of material.
 */
export function surface(
  name: string,
  scene: Scene,
  { color = 0xffffff, roughness = 0.8, metallic = 0 } = {},
): PBRMaterial {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = colorOf(color);
  material.roughness = roughness;
  material.metallic = metallic;
  // No environment texture in this game, so the only reflection a shiny surface
  // could show is the flat fallback — which reads as a grey wash over the
  // albedo rather than as reflection.
  material.environmentIntensity = 0;
  return material;
}

/**
 * A surface that ignores lighting entirely: portal glows, projectiles, health
 * bars, editor gizmos. Everything that is a read-out rather than an object.
 *
 * Babylon has no unlit material as such — this is the idiom: all the colour on
 * emissive, lighting switched off.
 */
export function unlit(
  name: string,
  scene: Scene,
  { color = 0xffffff, alpha = 1 } = {},
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.disableLighting = true;
  material.emissiveColor = colorOf(color);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  if (alpha < 1) material.alpha = alpha;
  // A read-out that fogged out with distance would be unreadable exactly when
  // the camera is furthest from what it describes.
  // `fogEnabled`, not `applyFog`: the latter is a property of a *mesh*, so
  // setting it here only ever added a field to the material that Babylon does
  // not read, and flat materials have been fogged all along.
  material.fogEnabled = false;
  return material;
}

/**
 * A named material, as Babylon understands it.
 *
 * One path for the game and for the editor's preview, so a surface that looks
 * right while it is being tuned looks the same on a map. What it is handed is
 * the record and a way to turn an asset id into a url — the editor answers that
 * per game folder, the game answers it from its own manifest.
 *
 * Split in two because a map is torn down and rebuilt on every edit. Making a
 * material means compiling a shader, and a mesh whose shader has not compiled
 * is not drawn at all — which is what made the map blink. So the material is
 * made once per scene and `applyMaterial` writes the current settings onto it
 * afterwards: those are the editable half, and none of them change the shader.
 *
 * Unlit is the one setting that does, because Babylon has no unlit PBR — it is
 * a different class. That is why it is in the cache key rather than applied.
 */

/** What identifies the material a scene should keep, given what it is made of. */
export const materialKey = (def: MaterialInput): string =>
  `material:named:${def.id}:${def.unlit ? 'flat' : 'lit'}`;

/**
 * The picture a material lays over a surface.
 *
 * Kept per scene like the material, and keyed by the tiling as well as the
 * file: the same file tiled twice over is a different texture object, and two
 * materials sharing one would each keep overwriting the other's tiling.
 */
function pictureFor(
  def: MaterialInput,
  id: string | undefined,
  scene: Scene,
  urlOf: UrlOf,
): Texture | null {
  const url = id ? urlOf(id) : '';
  if (!url) return null;
  const u = def.uScale ?? 1;
  const v = def.vScale ?? 1;
  const du = def.uOffset ?? 0;
  const dv = def.vOffset ?? 0;
  return keep(scene, `texture:${url}:${u},${v},${du},${dv}`, () => {
    // invertY off, because this is worn over a model's own UVs and those came
    // out of a glTF, which puts v=0 at the top of the picture.
    const texture = new Texture(url, scene, false, false);
    texture.uScale = u;
    texture.vScale = v;
    texture.uOffset = du;
    texture.vOffset = dv;
    return texture;
  });
}

/**
 * Write a material record's settings onto a material that already exists.
 *
 * Everything here is editable and none of it recompiles a shader, which is the
 * whole reason the material itself is kept across rebuilds.
 *
 * @param {object} def a normalized material record
 * @param material what to write onto — from `materialFrom` with the same `unlit`
 * @param scene the scene both belong to
 * @param {(id: string) => string} urlOf where a texture asset's file lives
 */
export function applyMaterial<T extends Surface>(
  def: MaterialInput,
  material: T,
  scene: Scene,
  urlOf: UrlOf,
): T {
  const picture = pictureFor(def, def.texture, scene, urlOf);

  // Asked of the material rather than re-read off `def.unlit`, which is the
  // same question: `materialKey` folds the flag into the cache key and
  // `materialFrom` builds to match it, so the two cannot drift apart. It is
  // also the only form of the question the compiler can act on -- the two
  // branches below write to fields the other class does not have.
  if (material instanceof StandardMaterial) {
    // An unlit material *adds* its emissive colour to its emissive texture, so
    // a white tint over a picture is a white surface. Under a picture the tint
    // is the picture's own multiplier, which is what `diffuse` is for once the
    // lighting that would have used it is off.
    material.emissiveTexture = picture;
    material.emissiveColor = colorOf(def.color ?? 0xffffff);
    material.opacityTexture = picture && def.transparent ? picture : null;
    material.alpha = def.alpha ?? 1;
    material.backFaceCulling = !def.backFaces;
    return material;
  }

  material.albedoTexture = picture;
  if (picture) {
    // Alpha off the colour map rather than off a second file: a leaf or a fence
    // is one picture whose transparent parts are already in it.
    picture.hasAlpha = Boolean(def.transparent);
    material.useAlphaFromAlbedoTexture = Boolean(def.transparent);
  }
  material.albedoColor = colorOf(def.color ?? 0xffffff);
  material.roughness = def.roughness ?? 0.8;
  material.metallic = def.metallic ?? 0;

  const bump = pictureFor(def, def.bump, scene, urlOf);
  material.bumpTexture = bump;
  if (bump) bump.level = def.bumpStrength ?? 1;

  material.emissiveColor = colorOf(def.emissive ?? 0x000000);
  material.emissiveIntensity = def.emissiveStrength ?? 0;
  material.alpha = def.alpha ?? 1;
  material.backFaceCulling = !def.backFaces;
  return material;
}

/** A material record, made and filled in. See `applyMaterial` for the split. */
export function materialFrom(def: MaterialInput, scene: Scene, urlOf: UrlOf): Surface {
  const material = def.unlit
    ? unlit(def.id ?? '', scene, {})
    : surface(def.id ?? '', scene, { color: 0xffffff });
  return applyMaterial(def, material, scene, urlOf);
}
