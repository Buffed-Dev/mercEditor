import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
// Side-effect only: this is what adds the thin-instance methods to Mesh. The
// asset panel builds a terrain layer without going through mapView, so it has
// to be imported here rather than relied on from there.
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Shadows } from './lights.ts';
import {
  surface,
  materialFrom,
  applyMaterial,
  materialKey,
  colorOf,
  type Surface,
} from './materials.ts';
import { keep } from './sceneCache.ts';
import { LEVEL_H } from '../data/dimensions.ts';
import { assetById, assetUrl } from '../data/assets.ts';
import { materialById } from '../data/materials.ts';
import { buildTemplates, shapeOf } from '../data/terrain/templates.ts';
import { topologyOf, subSides } from '../data/terrain/mask.ts';
import { normalizeRim, type RimRing } from '../data/terrain/profile.ts';
import { kindAt, levelAt, EMPTY, type TerrainGrid } from '../data/terrain/grid.ts';
import { TERRAINS, terrainsById, slotMaterial, type Terrain } from '../data/terrains.ts';

/**
 * The map's ground, as instanced blocks.
 *
 * A tile is one instance of a baked template mesh, and a tall tile is a stack
 * of them. Which template a tile gets is a pure function of the four cells
 * beside it (mask.ts) and the template itself is a pure function of the edge
 * profile (templates.ts), so nothing in this file decides what the ground looks
 * like — it decides where the blocks go and what they are painted with.
 *
 * ## Buckets
 *
 * Thin instances share one mesh, one geometry and one material, so a bucket is
 * everything that can differ: the topology (which template), the tier (top or
 * sub) and the terrain (which material). A real map lights up a dozen or two of
 * the possible buckets and the rest are never created.
 *
 * Each bucket owns its own `Mesh` even where two of them could share geometry.
 * That is not waste, it is required: `thinInstanceSetBuffer` installs the
 * matrix buffer on the *Geometry*, so two meshes sharing one would overwrite
 * each other's instances. A template is about a hundred vertices.
 *
 * ## refresh()
 *
 * The whole point of the design. An edit writes typed arrays and sets a flag;
 * once a frame this walks the grid and refills the matrix buffers. No mesh is
 * built, no material is made, no shader is compiled and no texture is uploaded
 * — those are the parts of a rebuild that cost, and they all happen at most
 * once per bucket for the life of the layer.
 *
 * ponytail: whole-buffer refill on any terrain edit. If a 64x64 refresh ever
 * measures over 2ms, key a per-cell slot table off the history rect (expanded
 * by one — a cell's blocks read its four neighbours) and rewrite those slots
 * alone. Note that ignoring diagonals means the neighbourhood really is four
 * cells, not the nine the old whole-mesh generator needed.
 */

type Content = {
  terrains?: readonly Terrain[];
  materials?: readonly { id?: string }[];
  assets?: readonly { id?: string }[];
  game?: string;
};

type World = {
  terrain: TerrainGrid;
  terrainIds: string[];
  map: { terrainRim?: readonly RimRing[] | null };
};

type Bucket = {
  mesh: Mesh;
  matrices: Float32Array;
  count: number;
};

export function createTerrainLayer(
  scene: import('@babylonjs/core/scene.js').Scene,
  world: World,
  env: { soilColor: number; floorColor: number },
  content: Content = {},
  shadows: Shadows | null = null,
  // A paintable ground is a PBRCustomMaterial, which is a PBRMaterial: saying
  // so is what lets the tint below be written without asking first.
  decals: {
    paintable(name: string, scene: unknown, options?: object): PBRMaterial;
  } | null = null,
) {
  const root = new TransformNode('terrain', scene);
  const owned: { dispose(): void }[] = [];

  const terrainDefs = content.terrains?.length ? content.terrains : TERRAINS;
  const byId = terrainsById(terrainDefs);
  // Kind 1 is the map's first terrain, so this is offset by one throughout.
  // A map naming a terrain the rules no longer define keeps its cells and
  // draws them in the fallback colour rather than losing them.
  const terrainOf = (kind: number): Terrain | null => byId.get(world.terrainIds[kind - 1]) ?? null;

  const assetOf = (id: string) =>
    (content.assets ? content.assets.find((a) => a.id === id) : assetById(id)) ?? null;
  const materialOf = (id: string) =>
    (content.materials ? content.materials.find((m) => m.id === id) : materialById(id)) ?? null;
  const urlOf = (id: string) => {
    const asset = assetOf(id);
    return asset ? assetUrl(asset, content.game) : '';
  };

  let templates = buildTemplates(normalizeRim(world.map?.terrainRim), LEVEL_H);
  const buckets = new Map<string, Bucket>();
  const materials = new Map<string, Surface>();

  // --- materials ----------------------------------------------------------

  /**
   * What one bucket is painted with.
   *
   * A top block goes through the decal registry or an ability's telegraph
   * cannot be drawn on it — opting in is a property of the material's class,
   * not of the mesh. A stack block deliberately gets an ordinary one, which is
   * what stops a telegraph smearing itself down a wall.
   */
  function materialFor(kind: number, tier: 'top' | 'sub', rot: number) {
    const terrain = terrainOf(kind);
    const id = slotMaterial(terrain, tier, rot);
    const cacheKey = `${tier}:${id}:${kind}`;
    const hit = materials.get(cacheKey);
    if (hit) return hit;

    const named = id ? materialOf(id) : null;
    const tint = terrain?.tint ?? (tier === 'top' ? env.floorColor : env.soilColor);

    let material: Surface;
    if (tier === 'sub' && named) {
      // Stack blocks are the one place a plain shared material is right, so
      // they go through the scene cache and are not owned here.
      material = keep(scene, materialKey(named), () => materialFrom(named, scene, urlOf));
      applyMaterial(named, material, scene, urlOf);
    } else {
      // Both arms are lit materials -- `paintable` builds a PBRCustomMaterial
      // and `surface` a PBRMaterial -- so the tint has somewhere to go without
      // asking first whether this one has an albedo.
      const lit =
        tier === 'top' && decals
          ? decals.paintable(`terrain:${cacheKey}`, scene, { roughness: 0.9 })
          : surface(`terrain:${cacheKey}`, scene, { color: tint, roughness: 0.9 });
      owned.push(lit);
      if (named) applyMaterial({ ...named, unlit: false }, lit, scene, urlOf);
      else lit.albedoColor = colorOf(tint);
      material = lit;
    }

    materials.set(cacheKey, material);
    return material;
  }

  // --- buckets ------------------------------------------------------------

  function bucketFor(at: number, tier: 'top' | 'sub', kind: number): Bucket {
    const key = `${at}|${tier}|${kind}`;
    const hit = buckets.get(key);
    if (hit) return hit;

    const data = tier === 'top' ? templates.top(at) : templates.sub(at);
    const mesh = new Mesh(`terrain:${key}`, scene);
    mesh.parent = root;
    const vertexData = new VertexData();
    vertexData.positions = data.positions;
    vertexData.normals = data.normals;
    vertexData.uvs = data.uvs;
    vertexData.indices = data.indices;
    vertexData.applyToMesh(mesh, false);

    mesh.material = materialFor(kind, tier, shapeOf(at).rot);
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    // Without this a pick reports the mesh but not which instance, and the
    // editor's "which tile is under the pointer" answers from the base
    // geometry sitting at the origin.
    mesh.thinInstanceEnablePicking = true;
    if (tier === 'top') shadows?.add(mesh);

    const bucket: Bucket = { mesh, matrices: new Float32Array(16 * 64), count: 0 };
    buckets.set(key, bucket);
    return bucket;
  }

  function push(bucket: Bucket, gx: number, gy: number, top: number): void {
    if ((bucket.count + 1) * 16 > bucket.matrices.length) {
      const grown = new Float32Array(bucket.matrices.length * 2);
      grown.set(bucket.matrices);
      bucket.matrices = grown;
    }
    // A template's own walkable face is y = 0 and its wall hangs one level
    // below, so the instance is placed at the height of the face it presents.
    Matrix.Translation(gx + 0.5, top * LEVEL_H, gy + 0.5).copyToArray(
      bucket.matrices,
      bucket.count * 16,
    );
    bucket.count += 1;
  }

  /** Rebuild every instance buffer from the grid. Meshes and materials survive. */
  function refresh(): void {
    const grid = world.terrain;
    for (const bucket of buckets.values()) bucket.count = 0;

    for (let gy = 0; gy < grid.rows; gy += 1) {
      for (let gx = 0; gx < grid.cols; gx += 1) {
        const kind = kindAt(grid, gx, gy);
        if (kind === EMPTY) continue;
        const level = levelAt(grid, gx, gy);
        if (level === null) continue;

        push(bucketFor(topologyOf(grid, gx, gy) ?? 0xff, 'top', kind), gx, gy, level);

        // Down the stack. The mask can only lose bits as it descends, so the
        // first fully buried segment is the last one worth drawing — every
        // block below it is enclosed on all four sides and would never be seen.
        for (let at = level - 1; at >= 0; at -= 1) {
          const mask = subSides(grid, gx, gy, at);
          if (!mask) break;
          push(bucketFor(mask, 'sub', kind), gx, gy, at);
        }
      }
    }

    for (const bucket of buckets.values()) upload(bucket);
  }

  function upload(bucket: Bucket): void {
    const { mesh } = bucket;
    if (!bucket.count) {
      mesh.setEnabled(false);
      return;
    }
    mesh.setEnabled(true);
    mesh.thinInstanceSetBuffer('matrix', bucket.matrices, 16, false);
    mesh.thinInstanceCount = bucket.count;
    // Otherwise the mesh is culled by the bounds of its base geometry, which
    // sits at the origin — the map vanishes the moment cell 0,0 leaves frame.
    mesh.thinInstanceRefreshBoundingInfo(false);
  }

  /**
   * A new edge profile: rebake the templates and build the buckets again.
   *
   * The meshes go rather than having new vertex data poured into them. A thin
   * instance buffer lives on the *Geometry*, so replacing a mesh's geometry
   * throws its instances away — which showed up as the map vanishing the moment
   * either rim slider moved. Rebuilding is a few dozen hundred-vertex meshes.
   *
   * The material cache is deliberately kept across this, so dragging a slider
   * does not recompile a shader per frame. That is the whole reason this is not
   * just a full rebuild of the layer.
   */
  function setRim(rim: readonly RimRing[] | null | undefined): void {
    templates = buildTemplates(normalizeRim(rim), LEVEL_H);
    for (const bucket of buckets.values()) bucket.mesh.dispose(false, false);
    buckets.clear();
    refresh();
  }

  refresh();

  return {
    root,
    refresh,
    setRim,
    /** How many draw calls the ground currently costs. Read by the debug panel. */
    get drawCalls() {
      let live = 0;
      for (const bucket of buckets.values()) if (bucket.count) live += 1;
      return live;
    },
    dispose() {
      for (const bucket of buckets.values()) bucket.mesh.dispose(false, false);
      buckets.clear();
      for (const thing of owned) thing.dispose();
      root.dispose(false, false);
    },
  };
}

/** The ground of one map, as instanced blocks. */
export type TerrainLayer = ReturnType<typeof createTerrainLayer>;
