import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { normalizeMaterial } from '../../src/data/materials.ts';
import { applyMaterial, materialFrom, materialKey } from '../../src/render/materials.ts';
import type { Surface, UrlOf } from '../../src/render/materials.ts';
import type { MaterialInput } from '../../src/data/materials.ts';
import type { Light } from '@babylonjs/core/Lights/light.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { PBRCustomMaterial } from '@babylonjs/materials/custom/pbrCustomMaterial.js';
import { createTerrainVariation } from '../../src/render/terrainVariation.ts';

/**
 * A named surface, and the same surface being drawn.
 *
 * Every number in a material is about light, and none of them can be read.
 * "Roughness 0.35" is not a thing anyone knows the look of — so half the editor
 * is the form and the other half is a shape wearing what the form says.
 *
 * Three shapes rather than one, because they answer different questions. A
 * plane shows the picture: whether the tiling lines up, and what the thing
 * actually looks like flat on. A cube shows three faces at once, which is where
 * a tiling factor and a metal go wrong. A sphere has every angle in it at once,
 * which is the only way to see a highlight move.
 *
 * It builds through the game's own `materialFrom`, so what is tuned here is
 * what a map draws. The effects editor drifted from the game twice by having a
 * path of its own, and both times the effect looked right in the tool and wrong
 * in play.
 *
 * Lifted out of the old materials mode unchanged — this is the part worth
 * keeping, and the panel around it is the part being replaced.
 */
export function createMaterialPreview() {
  let scene: Scene | null = null;
  let lamps: Light[] = [];
  let body: Mesh | null = null;
  let material: Surface | null = null;
  let materialFor = '';
  let currentDef: MaterialInput | null = null;
  let variationCoordinateScale = 1;
  const variation = createTerrainVariation(() => currentDef);

  /** Drop the shape. The material outlives it — see `draw`. */
  function clear(): void {
    body?.dispose(false, false);
    body = null;
  }

  return {
    /** How wide a view the preview opens on, in world units. */
    frustum: 3.4,

    /** The scene, for the console. See the map workspace's handle. */
    get scene() {
      return scene;
    },

    mount(made: Scene): void {
      scene = made;
      // Two lights: a fill so nothing is unreadable, and a key so a curved
      // surface has a bright side and a dark one. A material under one flat
      // light is a material you cannot judge.
      const fill = new HemisphericLight('matFill', new Vector3(0.2, 1, 0.1), made);
      fill.intensity = 0.7;
      fill.groundColor = new Color3(0.18, 0.2, 0.26);
      const key = new DirectionalLight('matKey', new Vector3(-0.6, -1, 0.55), made);
      key.intensity = 1.6;
      lamps = [fill, key];
    },

    unmount(): void {
      clear();
      material?.dispose(true, false);
      material = null;
      materialFor = '';
      for (const lamp of lamps) lamp.dispose();
      lamps = [];
      scene = null;
    },

    /**
     * Stand a material on the chosen shape.
     *
     * @param record the material being edited
     * @param {{shape?: string, urlOf?: (id: string) => string}} context `shape`
     *   is 'box', 'sphere' or 'plane'; `urlOf` resolves a texture asset id to a
     *   url the server will serve.
     */
    draw(
      record: MaterialInput | null | undefined,
      context: { shape?: string; urlOf?: UrlOf } = {},
    ): void {
      const { shape = 'box', urlOf = () => '' } = context;
      const stage = scene;
      if (!stage || !record) return clear();
      clear();
      const def = normalizeMaterial(record);
      currentDef = def;
      // The plane compresses a six-tile map sample into the preview window.
      // Sample world-space variation over those same six logical tiles, too.
      variationCoordinateScale = shape === 'plane' ? 6 / 2.35 : 1;

      // One unit across whatever the shape, because a tile is one unit and that
      // is the only scale a tiling factor can be judged against.
      body =
        shape === 'sphere'
          ? MeshBuilder.CreateSphere('matBody', { diameter: 1.6, segments: 48 }, stage)
          : shape === 'plane'
            ? MeshBuilder.CreatePlane(
                'matBody',
                // Two-sided, because which side of a plane faces you is a
                // question the preview should not be able to get wrong: a
                // material that culls its back faces would show nothing at all.
                {
                  size: 2.35,
                  sideOrientation: Mesh.DOUBLESIDE,
                  // Show six repeats in each direction before the material's
                  // own tiling is applied. This makes seams and repetition
                  // readable without making the material settings lie.
                  frontUVs: new Vector4(0, 0, 6, 6),
                  backUVs: new Vector4(0, 0, 6, 6),
                },
                stage,
              )
            : MeshBuilder.CreateBox('matBody', { size: 1.3 }, stage);

      // Lay the plane on XZ exactly like terrain. Variation is world-space, so
      // a camera-facing XY card loses one axis and can never resemble the map.
      if (shape === 'plane') body.rotation.x = Math.PI / 2;
      body.isPickable = false;

      // Made once and written onto after that. Compiling a shader is what makes
      // a preview blink, and every field on this form except "ignore lighting"
      // leaves the shader alone — which is why that one is what the key turns
      // on.
      const key = materialKey(def);
      if (key !== materialFor || !material) {
        material?.dispose(true, false);
        if (def.unlit) {
          material = materialFrom(def, stage, urlOf);
        } else {
          const custom = new PBRCustomMaterial(`${def.id}:preview`, stage);
          applyMaterial(def, custom, stage, urlOf);
          variation.configure(custom, def.id, true, () => variationCoordinateScale);
          material = custom;
        }
        materialFor = key;
      } else {
        applyMaterial(def, material, stage, urlOf);
      }
      body.material = material;
    },
  };
}

/** One material on a body you can turn, for the rules editor. */
export type MaterialPreview = ReturnType<typeof createMaterialPreview>;
