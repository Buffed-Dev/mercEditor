import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
// Side-effect only: this is what adds the thin-instance methods to Mesh.
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { createLights } from './lights.ts';
import { createDecals } from './decals.ts';
import { colorOf, surface, unlit } from './materials.ts';
import { LEVEL_H, WALL_H } from '../data/dimensions.ts';
import { normalizeEnv } from '../data/mapFormat.ts';
import { applyFog } from './fog.ts';
import { createVfxRuntime } from './vfx.ts';
import { createPropRuntime } from './props.ts';
import { createTerrainLayer } from './terrainLayer.ts';
import { VFX } from '../data/vfx.ts';

/**
 * Everything a map is made of: the ground, the walls standing on it, the
 * lights, the torches and the portals.
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

const FACE_DIRS = {
  '+x': { x: 1, y: 0 },
  '-x': { x: -1, y: 0 },
  '+y': { x: 0, y: 1 },
  '-y': { x: 0, y: -1 },
};

/**
 * @param {Scene} scene the one scene
 * @param {import('../game/world.ts').World} world
 * @param {object} [content] the rules the map is drawn against — its effects,
 *   objects, assets, materials and blocks, plus which game folder to fetch
 *   files from.
 *   Anything left out falls back to the list the engine was built with, which
 *   is what the game itself relies on: only the editor knows about rules being
 *   edited, and only the editor names a folder, because a built game's files
 *   came through the bundler under hashed names.
 */
export function buildMapView(scene, world, content = {}) {
  const {
    vfx: vfxDefs,
    props: propDefs,
    assets: assetDefs,
    terrains: terrainDefs,
    materials: materialDefs,
    game,
  } = content;
  const map = world.map;
  const env = normalizeEnv(map.env);

  const root = new TransformNode('map', scene);
  /** Materials and lights are not scene-graph children, so they are tracked. */
  const owned = [];

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
  const generators = lights.map((entry) => entry.generator).filter(Boolean);
  const shadows = {
    add(mesh) {
      for (const generator of generators) generator.addShadowCaster(mesh);
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
  const terrainLayer = createTerrainLayer(
    scene,
    world,
    env,
    { terrains: terrainDefs, materials: materialDefs, assets: assetDefs, game },
    shadows,
    decals,
  );
  terrainLayer.root.parent = root;

  // --- walls -------------------------------------------------------------
  // Objects standing on the ground rather than part of it, so they come from
  // the map's own list and sit at whatever height the terrain under them
  // reaches. A stack is the same block repeated up the same tile.
  const blocks = [];
  (map.walls ?? []).forEach((wall, index) => {
    const { gx, gy } = wall;
    // The top of the tile's own column, so a wall stands on the ground it is on
    // — and on a ramp tile, on the high end of it rather than through it.
    const base = (world.levelAt(gx, gy) ?? 0) * LEVEL_H;
    const stack = Math.max(1, Math.round(wall.stack ?? 1));
    for (let i = 0; i < stack; i++) blocks.push({ gx, gy, y: base + WALL_H * (i + 0.5), index });
  });

  const wallMaterial = surface('wall', scene, { color: env.wallColor, roughness: 0.85 });
  owned.push(wallMaterial);

  const wallMesh = MeshBuilder.CreateBox('walls', { width: 1, height: WALL_H, depth: 1 }, scene);
  wallMesh.material = wallMaterial;
  wallMesh.parent = root;
  wallMesh.receiveShadows = true;

  if (blocks.length) {
    // Thin instances: one draw call for every wall block on the map.
    const matrices = new Float32Array(blocks.length * 16);
    blocks.forEach(({ gx, gy, y }, i) => {
      Matrix.Translation(gx + 0.5, y, gy + 0.5).copyToArray(matrices, i * 16);
    });
    wallMesh.thinInstanceSetBuffer('matrix', matrices, 16);
    wallMesh.thinInstanceEnablePicking = true;
    shadows.add(wallMesh);
  } else {
    // Nothing to draw, and an instanced mesh with no instances still renders
    // its source geometry at the origin.
    wallMesh.setEnabled(false);
  }

  // What a ray that hits this mesh has actually hit. One instance is one block
  // and a wall may be several, so the instance index is looked up rather than
  // used directly. Inert for the game; it is how the editor picks things.
  wallMesh.metadata = { pick: { list: 'walls', instances: blocks.map((block) => block.index) } };

  // --- torches -----------------------------------------------------------
  let doorMaterial = null;

  const flameMaterial = unlit('flame', scene, { color: 0xffd9a0 });
  const bracketMaterial = surface('bracket', scene, { color: 0x2a2118, roughness: 1 });
  owned.push(flameMaterial, bracketMaterial);

  const torches = (map.torches ?? []).map(({ gx, gy, face }, index) => {
    const dir = FACE_DIRS[face];

    // Hang the flame off the wall face. No point light here: the flame and
    // bracket stay as props so the walls still read as torch-lit architecture,
    // but they emit nothing — a map that wants light places one.
    const x = gx + 0.5 + dir.x * 0.62;
    const z = gy + 0.5 + dir.y * 0.62;
    const y = WALL_H * 0.72;

    const group = new TransformNode(`torch${index}`, scene);
    group.parent = root;
    group.metadata = { pick: { list: 'torches', index } };

    const flame = MeshBuilder.CreateSphere('flame', { diameter: 0.18, segments: 8 }, scene);
    flame.material = flameMaterial;
    flame.position.set(x, y, z);
    flame.parent = group;

    const bracket = MeshBuilder.CreateCylinder(
      'bracket',
      { diameterTop: 0.1, diameterBottom: 0.14, height: 0.14, tessellation: 8 },
      scene,
    );
    bracket.material = bracketMaterial;
    bracket.position.set(x, y - 0.13, z);
    bracket.parent = group;
    // Never shadow-casting: it sits inside its own light, and would throw a
    // huge cone of shadow across everything below it.

    return { flame, phase: Math.random() * Math.PI * 2 };
  });

  // --- portals -----------------------------------------------------------
  // A portal is one tile: a glowing disc on the floor with a slowly turning
  // ring above it. The trigger itself is grid-side (World.portalAt), so these
  // meshes are purely the thing you can see.
  const portals = (map.portals ?? []).map((portal, index) => {
    const x = portal.gx + 0.5;
    const z = portal.gy + 0.5;
    const y = world.heightAt(x, z) * LEVEL_H;
    const color = portal.color ?? 0x9d6bff;

    const group = new TransformNode(`portal${index}`, scene);
    group.parent = root;
    group.position.set(x, y, z);
    group.metadata = { pick: { list: 'portals', index } };

    const discMaterial = unlit('portal-disc', scene, { color, alpha: 0.55 });
    const ringMaterial = unlit('portal-ring', scene, { color });
    owned.push(discMaterial, ringMaterial);

    const disc = MeshBuilder.CreateDisc('disc', { radius: 0.42, tessellation: 28 }, scene);
    disc.material = discMaterial;
    // Babylon builds a disc facing -Z, so this is the turn that leaves it
    // facing up. Turned the other way it lies face-down on the floor and is
    // culled away, which is exactly what happened to it.
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.02; // clear of the floor, so it does not z-fight
    disc.parent = group;

    const ring = MeshBuilder.CreateTorus(
      'ring',
      { diameter: 0.68, thickness: 0.09, tessellation: 24 },
      scene,
    );
    ring.material = ringMaterial;
    // Babylon builds a torus lying in the XZ plane already — no turning it flat.
    ring.position.y = 0.55;
    ring.parent = group;

    return { def: portal, group, ring, disc, phase: Math.random() * Math.PI * 2 };
  });

  // --- stations ----------------------------------------------------------
  // A crafting bench: a dark block with a lighter top, standing on the tile.
  // It is furniture and nothing more — what it can make lives in the recipes,
  // and whether you can reach it is decided grid-side by the level, the way a
  // portal's trigger is. One material pair for all of them, since a map with
  // two benches should not compile two shaders.
  const stationDefs = map.stations ?? [];
  let stationBody = null;
  let stationTop = null;

  const stations = stationDefs.map((station, index) => {
    const x = station.gx + 0.5;
    const z = station.gy + 0.5;
    const y = world.heightAt(x, z) * LEVEL_H;

    const group = new TransformNode(`station${index}`, scene);
    group.parent = root;
    group.position.set(x, y, z);
    group.metadata = { pick: { list: 'stations', index } };

    stationBody ??= (() => {
      const material = surface('station-body', scene, { color: 0x4a4038, roughness: 0.8 });
      owned.push(material);
      return material;
    })();
    stationTop ??= (() => {
      const material = surface('station-top', scene, { color: 0x8d8177, roughness: 0.6 });
      owned.push(material);
      return material;
    })();

    const body = MeshBuilder.CreateBox('bench', { width: 0.7, height: 0.5, depth: 0.7 }, scene);
    body.material = stationBody;
    body.position.y = 0.25;
    body.parent = group;
    body.receiveShadows = true;
    shadows.add(body);

    const top = MeshBuilder.CreateBox('anvil', { width: 0.85, height: 0.16, depth: 0.5 }, scene);
    top.material = stationTop;
    top.position.y = 0.58;
    top.parent = group;
    top.receiveShadows = true;
    shadows.add(top);

    return { def: station, group };
  });

  // --- objects -----------------------------------------------------------
  // Whatever the game's own asset folder holds, standing where the map put it.
  // Unlike everything else here these arrive asynchronously — a model is a file
  // over the network — so each one gets its node now and its geometry when it
  // lands. A map torn down first is what the runtime's own `alive` flag is for.
  const propRuntime = createPropRuntime(scene, propDefs, assetDefs, game, materialDefs);
  const placedProps = (map.props ?? [])
    .map((entry, index) => propRuntime.place(entry, index, world, root, shadows))
    .filter(Boolean);

  // --- chunks ------------------------------------------------------------
  // The rectangles a generated map is cut into: four thin bars laid on the
  // floor, one per side. An outline rather than a filled quad because you have
  // to be able to see — and click — everything standing inside it.
  //
  // Nothing in the game ever draws these: by the time a map has been assembled
  // its chunks have been consumed and the run carries none. They exist for the
  // editor, where a piece you cannot see the edges of is a piece you cannot
  // line a doorway up with.
  let chunkMaterial = null;
  const chunkOutlines = (map.chunks ?? []).map((chunk, index) => {
    const gx = Math.round(chunk.gx);
    const gy = Math.round(chunk.gy);
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
    group.metadata = { pick: { list: 'chunks', index } };

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
    marker.metadata = { pick: { list: 'doors', index } };
    return marker;
  });

  // --- placed effects ----------------------------------------------------

  // A map names an effect and a tile; the definition lives in the rules, the
  // same one an ability would name. Ambient by nature — a fire, a shine on a
  // chest — so they are attached rather than played, and stop when the map does.
  const vfxRuntime = createVfxRuntime(scene, vfxDefs ?? VFX);
  const vfx = (map.vfx ?? [])
    .map((entry) =>
      vfxRuntime.attach(
        entry.id,
        new Vector3(
          entry.gx + 0.5,
          world.heightAt(entry.gx + 0.5, entry.gy + 0.5) * LEVEL_H,
          entry.gy + 0.5,
        ),
      ),
    )
    .filter(Boolean);

  return {
    root,
    blocks: terrainLayer,
    vfx,
    doors: doorMarkers,
    walls: wallMesh,
    decals,
    shadows,
    torches,
    portals,
    stations,
    props: placedProps,
    chunks: chunkOutlines,
    lights,
    env,
    applyEnvironment,

    dispose() {
      vfxRuntime.dispose();
      propRuntime.dispose();
      terrainLayer.dispose();
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
