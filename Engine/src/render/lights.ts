import { Light } from '@babylonjs/core/Lights/light.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { colorOf } from './materials.ts';
import { LIGHT_FIELDS, normalizeLight, type Light as LightDef } from '../data/lights.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { ShadowLight } from '@babylonjs/core/Lights/shadowLight.js';
import type { Scene } from '@babylonjs/core/scene.js';

/**
 * Somewhere to register a mesh as casting shadows.
 *
 * One call rather than a generator, because a map has as many generators as it
 * has shadow-casting lights and every caller would otherwise have to loop over
 * them. mapView builds it over the generators these lights hand back.
 */
export type Shadows = { add: <T extends AbstractMesh>(mesh: T) => T };

/** How high the ground is at a point. Most views ask nothing else of it. */
export type Heights = { heightAt: (gx: number, gy: number) => number };

/** What placing a light needs: the height, and how far across the map is. */
export type Ground = Heights & { cols: number; rows: number };

/** The four kinds a map can declare. See data/lights.ts. */
type AnyLight = HemisphericLight | DirectionalLight | SpotLight | PointLight;
import { LEVEL_H } from '../data/dimensions.ts';

/**
 * A map's `lights` list, turned into Babylon lights and their shadow
 * generators.
 *
 * Each entry keeps a reference to the definition it came from and a `refresh()`
 * that pushes changed values back into the live light, which is what lets the
 * editor drag a slider and see the result without rebuilding the scene.
 *
 * Softness is Babylon's contact-hardening filter — percentage-closer soft
 * shadows, built in. A shadow is sharp where its caster meets the floor and
 * opens up with distance, which is what real penumbrae do. In Babylon that is
 * one flag on the generator rather than a shader to patch.
 */

const DEG = Math.PI / 180;

/** Point and spot shadows are cube/perspective renders, so keep them cheap. */
const LOCAL_SHADOW_MAP = 512;
const SUN_SHADOW_MAP = 4096*2;

/**
 * How much finer the sun's shadow map is than the one the numbers below were
 * tuned against.
 *
 * Two of them are measured in that map's texels rather than in world units, and
 * the map was made four times finer without them — which is how they came to
 * disagree with it. Scaled rather than rewritten, so the next change to the map
 * size carries them along instead of leaving them behind.
 */
const TUNED_SUN_MAP = 2048;
const SUN_TEXEL_SCALE = TUNED_SUN_MAP / SUN_SHADOW_MAP;

/**
 * Authored softness (roughly 0–10) to the light's apparent size in shadow-map
 * UV space, which is what sets how fast the penumbra opens.
 *
 * Scaled into the map being drawn to, because the blocker search takes a fixed
 * number of samples across whatever radius this asks for. A radius covering
 * four times as many texels is searched four times as thinly, and past a point
 * the search steps straight over the thing casting the shadow: the sun's
 * shadows did not soften, they stopped existing.
 */
const SOFTNESS_TO_UV = 0.006;

/**
 * How far a receiver is pushed along its own normal before its depth is
 * compared, in world units.
 *
 * Without this a large flat surface lit at a grazing angle shadows itself in
 * bands: one shadow-map texel covers a long stretch of ground, so half of that
 * stretch reads as deeper than the depth stored for it. Offsetting along the
 * normal scales the correction with the angle, which a flat depth bias cannot,
 * and it is why the ground came out striped before this existed.
 *
 * The numbers are roughly one texel each. Both were tuned against the map sizes
 * beside them — the sun over a 2048 map fitted to the whole level, a local light
 * over a 512 one spread across its reach, whose texels are far coarser.
 *
 * Which is why the sun's is worked out rather than written down. The map was
 * made four times finer and the number beside it was not, so the offset stood
 * four texels deep and pushed every shadow clear of the thing casting it — a
 * block with a gap of daylight under it, floating over its own shadow.
 */
const SUN_NORMAL_BIAS = 0.02 * SUN_TEXEL_SCALE;
const LOCAL_NORMAL_BIAS = 0.05;

/** A small constant offset on top, for surfaces facing the light head-on. */
const DEPTH_BIAS = 0.0006;

/** How far outside the map the sun sits. Direction is what matters, not this. */
const sunDistance = (world: Ground | null) =>
  world ? Math.max(world.cols, world.rows) * 0.8 : 20;

function positionLocal(light: ShadowLight, def: LightDef, world: Ground | null): void {
  const x = def.gx + 0.5;
  const z = def.gy + 0.5;
  const groundY = world ? world.heightAt(x, z) * LEVEL_H : 0;
  light.position.set(x, groundY + (def.height ?? LIGHT_FIELDS.height.default), z);
}

/**
 * A sun has no position of its own — only a direction. Azimuth and elevation
 * are far friendlier to edit than an xyz, so the map stores angles and the
 * distance is just far enough to sit outside the map.
 */
function positionSun(light: ShadowLight, def: LightDef, world: Ground | null): void {
  const tx = def.gx + 0.5;
  const tz = def.gy + 0.5;
  const radius = sunDistance(world);
  const azimuth = (def.azimuth ?? LIGHT_FIELDS.azimuth.default) * DEG;
  const elevation = (def.elevation ?? LIGHT_FIELDS.elevation.default) * DEG;

  light.position.set(
    tx + Math.cos(elevation) * Math.sin(azimuth) * radius,
    Math.sin(elevation) * radius,
    tz + Math.cos(elevation) * Math.cos(azimuth) * radius,
  );
  light.direction = new Vector3(tx, 0, tz).subtractInPlace(light.position).normalize();
}

function build(def: LightDef, world: Ground | null, scene: Scene): AnyLight {
  switch (def.type) {
    case 'hemisphere': {
      const light = new HemisphericLight('hemi', Vector3.Up(), scene);
      light.groundColor = colorOf(def.groundColor ?? LIGHT_FIELDS.groundColor.default);
      return light;
    }

    case 'directional': {
      const light = new DirectionalLight('sun', Vector3.Down(), scene);
      positionSun(light, def, world);
      // Babylon fits the shadow frustum to whatever is casting, every frame.
      // Every wasted unit of frustum is wasted shadow-map resolution, and a
      // slack frustum is the usual reason shadows look chunky.
      light.autoUpdateExtends = true;
      light.autoCalcShadowZBounds = true;
      return light;
    }

    case 'spot': {
      // Babylon's angle is the whole cone; the authored number is the half
      // angle, as it is everywhere else that talks about spotlights.
      const light = new SpotLight(
        'spot',
        Vector3.Zero(),
        Vector3.Down(),
        (def.angle ?? LIGHT_FIELDS.angle.default) * DEG * 2,
        1,
        scene,
      );
      positionLocal(light, def, world);
      return light;
    }

    default:
      return new PointLight('point', Vector3.Zero(), scene);
  }
}

/** Push the current values of `def` onto an already-built light. */
function apply(
  light: AnyLight,
  generator: ShadowGenerator | null,
  def: LightDef,
  world: Ground | null,
): void {
  light.diffuse = colorOf(def.color ?? LIGHT_FIELDS.color.default);
  light.intensity = def.intensity ?? LIGHT_FIELDS.intensity.default;

  // Asked of the light rather than of `def.type`, which is the same question --
  // `build` makes the class from the type -- and the only form of it that lets
  // the compiler follow which fields exist further down.
  if (light instanceof HemisphericLight) {
    light.groundColor = colorOf(def.groundColor ?? LIGHT_FIELDS.groundColor.default);
    return;
  }

  if (generator) {
    generator.useContactHardeningShadow = true;
    // The floor is on the authored softness; the scale turns it into the texels
    // of the map this generator actually draws to.
    generator.contactHardeningLightSizeUVRatio =
      Math.max(0.001, (def.shadowSoftness ?? 3) * SOFTNESS_TO_UV) *
      (def.type === 'directional' ? SUN_TEXEL_SCALE : 1);
    generator.normalBias = def.type === 'directional' ? SUN_NORMAL_BIAS : LOCAL_NORMAL_BIAS;
    generator.bias = DEPTH_BIAS;
    // Babylon's darkness is how much light a shadow keeps; the authored number
    // is how dark it goes.
    generator.setDarkness(1 - (def.shadowDarkness ?? 1));
  }
  light.shadowEnabled = Boolean(def.castShadow);

  if (light instanceof DirectionalLight) {
    positionSun(light, def, world);
    return;
  }

  // Inverse-square falloff, so `distance` reads as the reach at which the
  // light has effectively run out rather than as an arbitrary cutoff.
  light.range = def.distance ?? LIGHT_FIELDS.distance.default;
  light.falloffType = Light.FALLOFF_PHYSICAL;
  positionLocal(light, def, world);

  if (light instanceof SpotLight) {
    light.angle = (def.angle ?? LIGHT_FIELDS.angle.default) * DEG * 2;
    // Babylon softens between the inner cone and the outer one; the authored
    // penumbra is what fraction of the cone that soft band takes up.
    light.innerAngle = light.angle * (1 - (def.penumbra ?? LIGHT_FIELDS.penumbra.default));
    light.direction = Vector3.Down();
  }
}

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {object} map the map definition
 * @param {import('../game/world.ts').World} world
 */
export function createLights(
  scene: Scene,
  map: { lights?: readonly Partial<LightDef>[] },
  world: Ground | null,
) {
  return (map.lights ?? []).map((raw) => {
    const def = normalizeLight(raw);
    const light = build(def, world, scene);

    // Hemisphere light is direction-free and casts nothing, so it has no
    // generator and nothing to fit a frustum to.
    const generator =
      def.type === 'hemisphere'
        ? null
        : new ShadowGenerator(
            def.type === 'directional' ? SUN_SHADOW_MAP : LOCAL_SHADOW_MAP,
            light as ShadowLight,
          );

    apply(light, generator, def, world);

    return {
      def: raw,
      light,
      generator,
      /** Re-read the (possibly edited) definition. Used by the editor. */
      refresh(next: Partial<LightDef> = raw): void {
        apply(light, generator, normalizeLight(next), world);
      },
      dispose(): void {
        generator?.dispose();
        light.dispose();
      },
    };
  });
}

/** One light on a map, and the shadows it casts. */
export type LightHandle = ReturnType<typeof createLights>[number];
