import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
// Side-effect only: this is what adds the thin-instance methods to Mesh.
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { createLights, type Shadows } from './lights.ts';
import { createDecals } from './decals.ts';
import { colorOf, unlit } from './materials.ts';
import { LEVEL_H } from '../data/dimensions.ts';
import { normalizeEnv } from '../data/mapFormat.ts';
import { tagPick } from './pick.ts';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { World } from '../game/world.ts';
import type { MaterialInput } from '../data/materials.ts';
import type { Prop } from '../data/props.ts';
import type { Terrain } from '../data/terrains.ts';
import type { VfxInput } from '../data/vfx.ts';
import type { VfxHandle } from './vfx.ts';
import type { Placement } from './props.ts';
import type { TerrainLayer } from './terrainLayer.ts';

/**
 * The rule tables a map is drawn against.
 *
 * All optional: the game hands nothing and the shipped definitions are used,
 * while the editor hands the document it is part way through editing.
 */
export type MapContent = {
  vfx?: readonly VfxInput[];
  props?: readonly Prop[];
  /**
   * The prefabs being edited.
   *
   * Nothing in here reads them: a map arrives with its placements already
   * turned into objects (see data/prefabs.ts), and by then a prefab is not a
   * thing the view has heard of. They travel with the rest because the editor
   * expands the map itself, from the same table it draws it with — and a
   * second way to hand that over would be a second thing to keep in step.
   */
  prefabs?: readonly unknown[];
  terrains?: readonly Terrain[];
  materials?: readonly MaterialInput[];
  game?: string;
};

import { applyFog } from './fog.ts';
import { createVfxRuntime } from './vfx.ts';
import { createPropRuntime } from './props.ts';
import { createTerrainLayer } from './terrainLayer.ts';
import { skyEnvironment } from './environment.ts';
import { VFX } from '../data/vfx.ts';

/**
 * Everything a map is made of: the ground, the lights, and the objects
 * standing on it.
 *
 * One tile is one world unit on X/Z and Y is up. Grid coordinates map straight
 * through — gx to x, gy to z — so nothing in game/world.js has to know a
 * renderer exists.
 *
 * The whole thing hangs off one root node and is disposed as one. There is a
 * single Babylon Scene for the application, so changing map means dropping this
 * subtree and building another; the camera, the render pipeline and the scene
 * itself outlive every map.
 */

// Colours, sky and fog all come from the map's `env` block, so a bright base
// and a dim dungeon are the same code with different data. Anything a map
// leaves out falls back to the daylight look here.

/**
 * @param {Scene} scene the one scene
 * @param {import('../game/world.ts').World} world
 * @param {object} [content] the rules the map is drawn against — its effects,
 *   objects, materials and blocks, plus which game folder to fetch
 *   files from.
 *   Anything left out falls back to the list the engine was built with, which
 *   is what the game itself relies on: only the editor knows about rules being
 *   edited, and only the editor names a folder, because a built game's files
 *   came through the bundler under hashed names.
 */
export function buildMapView(
  scene: Scene,
  world: World,
  content: MapContent = {},
  /**
   * Somewhere to keep the ground, for a caller that outlives this view.
   *
   * The editor throws this whole view away on every click and builds it again,
   * and the ground was three quarters of that — remade to draw a grid that had
   * not changed, because it happened to hang off the same root. Passing this at
   * all says the ground is *yours*: the view will point the one you hand over
   * at the new world, or build one and hand it back in `blocks`, and either way
   * it will not dispose it. Leave it out and the view owns its own, which is
   * what the game does — a level's ground goes when the level does.
   *
   * See `retarget` in terrainLayer.ts for what pointing it at a new view means.
   */
  keep?: { blocks: TerrainLayer | null },
) {
  const {
    vfx: vfxDefs,
    props: propDefs,
    terrains: terrainDefs,
    materials: materialDefs,
    game,
  } = content;
  const map = world.map;
  const env = normalizeEnv(map.env);

  const root = new TransformNode('map', scene);
  /** Materials and lights are not scene-graph children, so they are tracked. */
  const owned: { dispose: () => void }[] = [];

  const sky = colorOf(env.sky);

  // The shapes this map paints on its own ground. Created up here because
  // `applyEnvironment` below is what points the shared ground material at it.
  const decals = createDecals();

  /**
   * Sky, fog and image processing belong to the scene, not to a node, so they
   * are the one part of a map that cannot simply hang off its own root.
   * Re-applied when a map comes back to the front — leaving the editor should
   * not leave you playing under the edited map's weather.
   */
  function applyEnvironment() {
    scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    // What a metal in this map has to reflect: its own sky and its own soil.
    // Without one, `surface` leaves every PBR material's environment at zero
    // and metallic is a dial that does nothing.
    scene.environmentTexture = skyEnvironment(scene, env.sky, env.soilColor);
    // Not distance fog: the camera is orthographic, so every pixel is about as
    // far from it as every other and linear fog only ever tinted the lot.
    scene.fogMode = Scene.FOGMODE_NONE;
    // A reach of nothing is a band nothing can be inside of, which is how a
    // map with its fog switched off says so to a pass that is always there.
    applyFog(scene, world, sky, env.fog ? env.fogReach : 0, env.fogSmooth);

    // Exposure is the one dial that makes a dark map readable without touching
    // a single light, and tone mapping rolls off highlights that would
    // otherwise clip to flat white — which is what a bright sun over pale
    // stone does without it.
    const image = scene.imageProcessingConfiguration;
    image.exposure = env.lighting ? env.exposure : 1;
    image.contrast = env.lighting ? env.contrast : 1;
    image.toneMappingEnabled = env.lighting && Boolean(env.toneMapping);
    image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;

    // The ground material is shared with every other map, so it has to be told
    // whose shapes to paint — and whose weather to paint them under.
    decals.setClouds({
      strength: env.clouds ? env.cloudShade : 0,
      scale: env.cloudScale,
      speed: env.cloudSpeed,
      angle: env.cloudAngle,
    });
    decals.use();
  }
  applyEnvironment();

  // --- lighting ----------------------------------------------------------
  // Ambient is the map's flat base level: direction-free, casts no shadow, and
  // lights every face identically. A hemisphere light whose sky and ground
  // colours match is exactly that — Babylon has no separate ambient light, and
  // this is how you ask for one.
  const ambient = new HemisphericLight('ambient', Vector3.Up(), scene);
  ambient.diffuse = colorOf(env.ambientColor);
  ambient.groundColor = ambient.diffuse;
  ambient.specular = Color3.Black();
  // No ambient at all when a map says it has none, rather than a light left
  // in contributing nothing: one fewer light for every surface to be shaded by.
  ambient.intensity = env.lighting ? env.ambientIntensity : 0;
  ambient.parent = root;
  owned.push(ambient);

  // Everything else the map places by hand: torch glows, spots, a sun.
  const lights = createLights(scene, map, world);
  for (const entry of lights) entry.light.parent = root;

  /**
   * Anything that should throw a shadow has to be handed to every generator —
   * Babylon asks per light which meshes cast, rather than carrying one flag per
   * mesh. Views built after the map (the player, monsters, dropped items) call
   * this as they create their meshes.
   */
  const generators = lights
    .map((entry) => entry.generator)
    .filter((generator): generator is ShadowGenerator => generator !== null);
  const shadows: Shadows = {
    add<T extends AbstractMesh>(mesh: T): T {
      for (const generator of generators) {
        generator.addShadowCaster(mesh);
        // A caster that arrives after the map was drawn — a model off the
        // network, a block bucket the brush has just called for — has to be
        // drawn into the shadow map, and a map set to draw itself once has
        // already been. Harmless where the rate is every frame anyway.
        generator.getShadowMap()?.resetRefreshCounter();
      }
      return mesh;
    },
  };

  // --- terrain -----------------------------------------------------------
  // The ground, as instanced blocks. Which of the sixteen block meshes a tile
  // gets, and how far down its stack goes, falls out of what is next to what;
  // see data/terrain/templates.ts. Nothing about the shape of the ground is art
  // any more, which is what stops a new terrain type needing new meshes.
  //
  // The walkable top is a paintable material because it is the only thing an
  // ability's telegraph is ever drawn on. Stack blocks get an ordinary one,
  // which is what keeps a telegraph from smearing itself down a wall.
  const against = {
    world,
    env,
    content: { terrains: terrainDefs, materials: materialDefs, game },
    shadows,
    decals,
  };
  const held = keep?.blocks ?? null;
  const terrainLayer =
    held ?? createTerrainLayer(scene, world, env, against.content, shadows, decals);
  if (held) held.retarget(against);
  terrainLayer.root.parent = root;

  // --- objects -----------------------------------------------------------
  // Whatever the game's own asset folder holds, standing where the map put it.
  // Unlike everything else here these arrive asynchronously — a model is a file
  // over the network — so each one gets its node now and its geometry when it
  // lands. A map torn down first is what the runtime's own `alive` flag is for.
  const propRuntime = createPropRuntime(scene, propDefs, game, materialDefs);
  const placedProps = (map.props ?? [])
    .map((entry, index) => propRuntime.place(entry, index, world, root, shadows))
    .filter((placed): placed is Placement => placed !== null);
  // Now, not on the microtask the runtime would otherwise fall back to. A map
  // is built and drawn inside one task, and a microtask does not get a turn
  // between the two -- so every object on it would be missing from the frame
  // that follows the build.
  propRuntime.draw();

  // --- chunks ------------------------------------------------------------
  // The rectangles a generated map is cut into: four thin bars laid on the
  // floor, one per side. An outline rather than a filled quad because you have
  // to be able to see — and click — everything standing inside it.
  //
  // Nothing in the game ever draws these: by the time a map has been assembled
  // its chunks have been consumed and the run carries none. They exist for the
  // editor, where a piece you cannot see the edges of is a piece you cannot
  // line a doorway up with.
  let chunkMaterial: StandardMaterial | null = null;
  const chunkOutlines = (map.chunks ?? []).map((chunk, index) => {
    const gx = Math.round(chunk.gx ?? 0);
    const gy = Math.round(chunk.gy ?? 0);
    const w = Math.max(1, Math.round(chunk.w ?? 8));
    const h = Math.max(1, Math.round(chunk.h ?? 8));

    chunkMaterial ??= (() => {
      const material = unlit('chunk', scene, { color: 0x5ad2ff, alpha: 0.5 });
      owned.push(material);
      return material;
    })();

    const group = new TransformNode(`chunk${index}`, scene);
    group.parent = root;
    // Anchored at the corner, so the bars below are laid out in tile space and
    // the whole thing sits where the rectangle actually is.
    group.position.set(gx, world.heightAt(gx + 0.5, gy + 0.5) * LEVEL_H + 0.04, gy);
    tagPick(group, { list: 'chunks', index });

    const T = 0.08;
    const bars = [
      { w, d: T, x: w / 2, z: 0 },
      { w, d: T, x: w / 2, z: h },
      { w: T, d: h, x: 0, z: h / 2 },
      { w: T, d: h, x: w, z: h / 2 },
    ];
    for (const bar of bars) {
      const edge = MeshBuilder.CreateBox('edge', { width: bar.w, height: 0.05, depth: bar.d }, scene);
      edge.material = chunkMaterial;
      edge.position.set(bar.x, 0, bar.z);
      edge.parent = group;
    }

    return { def: chunk, group };
  });

  /** Made on first use: most maps have no doors, and none have many. */
  let doorMaterial: StandardMaterial | null = null;

  // --- doors -------------------------------------------------------------
  // Where one chunk joins on to the next. By the time the chunks have been
  // fitted together the doors have been consumed — the assembled map carries
  // none — so this draws nothing at all in the game and exists for the editor,
  // where you have to be able to see where a piece joins on.
  const doorDefs = map.doors ?? [];
  const doorMarkers = doorDefs.map((door, index) => {
    const marker = MeshBuilder.CreateBox(
      'door',
      { width: 0.9, height: 0.06, depth: 0.9 },
      scene,
    );
    marker.material = doorMaterial ??= (() => {
      const material = unlit('door', scene, { color: 0xffc24d, alpha: 0.75 });
      owned.push(material);
      return material;
    })();
    marker.position.set(
      door.gx + 0.5,
      world.heightAt(door.gx + 0.5, door.gy + 0.5) * LEVEL_H + 0.03,
      door.gy + 0.5,
    );
    marker.parent = root;
    tagPick(marker, { list: 'doors', index });
    return marker;
  });

  // --- placed effects ----------------------------------------------------

  // A map names an effect and a tile; the definition lives in the rules, the
  // same one an ability would name. Ambient by nature — a fire, a shine on a
  // chest — so they are attached rather than played, and stop when the map does.
  const vfxRuntime = createVfxRuntime(scene, vfxDefs ?? VFX, game);
  // Kept with where each was put and which placement it is, so the editor
  // can slide one to show a move live: an effect that stayed behind while its
  // marker went would be a lie.
  const vfx = (map.vfx ?? [])
    .map((entry, index) => {
      const at = new Vector3(
        entry.gx + 0.5,
        world.heightAt(entry.gx + 0.5, entry.gy + 0.5) * LEVEL_H + (entry.lift ?? 0),
        entry.gy + 0.5,
      );
      return { index, at, handle: vfxRuntime.attach(entry.id, at) };
    })
    .filter((one): one is { index: number; at: Vector3; handle: VfxHandle } => one.handle !== null);

  return {
    root,
    blocks: terrainLayer,
    vfx,
    doors: doorMarkers,
    decals,
    shadows,
    props: placedProps,
    /**
     * Slide one object, for the editor's drag. False when that placement is
     * not drawn as an instance — a sprite sheet, which hangs off its own node.
     */
    moveProp: propRuntime.move,
    restandProp: propRuntime.restand,
    /** Draw one object, or stop drawing it. What the panel's eye switches. */
    showProp: propRuntime.show,
    chunks: chunkOutlines,
    lights,
    env,
    applyEnvironment,

    dispose(): void {
      vfxRuntime.dispose();
      propRuntime.dispose();
      // A ground somebody else is keeping is unhooked rather than disposed:
      // the root below takes down everything still hanging off it. Asked for
      // by `keep` being there at all, not by it having held one — the first
      // build fills it in, and that one is theirs too.
      if (keep) terrainLayer.root.parent = null;
      else terrainLayer.dispose();
      for (const entry of lights) entry.dispose();
      for (const thing of owned) thing.dispose();
      // Recursive over meshes and their geometry. Materials are freed through
      // `owned` above instead, because several meshes share one and letting the
      // tree free them would take a shared material down with the first mesh
      // that used it.
      root.dispose(false, false);
    },
  };
}

/** Everything drawn for one map, and the means to take it all down again. */
export type MapView = ReturnType<typeof buildMapView>;
