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
import { fileUrl } from '../data/assets.ts';
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
  /** What it is a bucket *of*, so it can be repainted without parsing its key. */
  at: number;
  tier: 'top' | 'sub';
  kind: number;
};

/** A paintable ground is a PBRCustomMaterial, which is a PBRMaterial. */
type Decals = { paintable(name: string, scene: unknown, options?: object): PBRMaterial } | null;

/**
 * Everything the layer draws *against*, as opposed to what it draws.
 *
 * Held in one place and swappable, because the layer now outlives the view
 * around it — see `retarget`. Every one of these is a different object after a
 * rebuild even when the ground has not moved an inch: the world is made afresh,
 * the lights and their shadow generators are new, and so is the decal registry.
 */
type Against = {
  world: World;
  env: { soilColor: number; floorColor: number };
  content: Content;
  shadows: Shadows | null;
  decals: Decals;
};

export function createTerrainLayer(
  scene: import('@babylonjs/core/scene.js').Scene,
  world: World,
  env: { soilColor: number; floorColor: number },
  content: Content = {},
  shadows: Shadows | null = null,
  decals: Decals = null,
) {
  const root = new TransformNode('terrain', scene);

  let now: Against = { world, env, content, shadows, decals };

  let terrainDefs = now.content.terrains?.length ? now.content.terrains : TERRAINS;
  let byId = terrainsById(terrainDefs);
  // Kind 1 is the map's first terrain, so this is offset by one throughout.
  // A map naming a terrain the rules no longer define keeps its cells and
  // draws them in the fallback colour rather than losing them.
  const terrainOf = (kind: number): Terrain | null =>
    byId.get(now.world.terrainIds[kind - 1]) ?? null;

  const materialOf = (id: string) =>
    (now.content.materials ? now.content.materials.find((m) => m.id === id) : materialById(id)) ??
    null;
  // A path under assets/, not an asset id: a material names its pictures
  // relative to its own folder and resolves them before asking for a url.
  const urlOf = (path: string) => fileUrl(path, now.content.game);

  /** What the templates below were baked from, so a retarget can tell. */
  let rimSource: unknown = world.map?.terrainRim;
  let templates = buildTemplates(normalizeRim(rimSource as readonly RimRing[] | null), LEVEL_H);
  const buckets = new Map<string, Bucket>();
  const materials = new Map<string, Surface>();

  /**
   * The grid as it was when these buckets were last filled.
   *
   * A copy, not a reference. The editor's grid is decoded once and written in
   * place ever after — the document, the world and this all hold the same two
   * typed arrays — so there is nothing to compare a later state *against*
   * unless it was kept. Two bytes a tile, which on the biggest map anyone will
   * hand-author is a few kilobytes.
   */
  let drawn: { cols: number; rows: number; kind: Uint8Array; level: Uint8Array } | null = null;

  /** Whether the ground has moved since the buffers were last filled. */
  function moved(grid: TerrainGrid): boolean {
    if (!drawn || drawn.cols !== grid.cols || drawn.rows !== grid.rows) return true;
    for (let i = 0; i < grid.kind.length; i += 1) {
      if (drawn.kind[i] !== grid.kind[i] || drawn.level[i] !== grid.level[i]) return true;
    }
    return false;
  }

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
    const tint = terrain?.tint ?? (tier === 'top' ? now.env.floorColor : now.env.soilColor);

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
      //
      // Kept by the scene rather than built per layer. A material's shader has
      // to compile before anything wearing it is drawn *at all*, so a top face
      // rebuilt on every edit is a floor that vanishes for as long as that
      // compile takes -- which is what made the ground blink under the brush.
      // The ground's own material has been kept for exactly this reason for as
      // long as it has existed (see `decals.material`); this is that same
      // bargain for the blocks standing on it.
      //
      // Keyed by what the material is made *of*, never by `kind`: a kind is an
      // index into this map's terrain list and the cache outlives the map, so
      // keying on it would hand the next map the material this one built for
      // whichever terrain it happened to list third.
      // `paintable` is in the key because it picks the material's *class*, and
      // the cache cannot hand a plain PBRMaterial to a caller that asked for a
      // paintable one. Today the only layer built without decals is the asset
      // preview, which has a Scene of its own -- but the cache is what makes
      // that a coincidence rather than a rule, so it is written down here.
      const paintable = tier === 'top' && now.decals;
      const key = `terrain:${tier}:${paintable ? 'decal' : 'plain'}:${named ? materialKey(named) : `tint:${tint}`}`;
      const lit = keep(scene, key, () =>
        paintable
          ? paintable.paintable(key, scene, { roughness: 0.9 })
          : surface(key, scene, { color: tint, roughness: 0.9 }),
      );
      // Re-applied rather than assumed, exactly as the `sub` arm above does:
      // the cache hands back what the first caller built, and a colour or a
      // picture edited in the library since then still has to land on it.
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
    if (tier === 'top') now.shadows?.add(mesh);

    const bucket: Bucket = { mesh, matrices: new Float32Array(16 * 64), count: 0, at, tier, kind };
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
    const grid = now.world.terrain;
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
    drawn = {
      cols: grid.cols,
      rows: grid.rows,
      kind: Uint8Array.from(grid.kind),
      level: Uint8Array.from(grid.level),
    };
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
    rimSource = rim;
    templates = buildTemplates(normalizeRim(rim), LEVEL_H);
    for (const bucket of buckets.values()) bucket.mesh.dispose(false, false);
    buckets.clear();
    refresh();
  }

  /**
   * Point the layer at a new world, and keep the ground it already has.
   *
   * The map view around this is thrown away and built again on every click —
   * placing something, erasing it, undoing — and rebuilding the ground with it
   * was three quarters of what that cost: thirty-odd meshes and their vertex
   * buffers made again to draw a grid that had not changed. Nothing about the
   * ground depends on where a crate is standing, so it stays.
   *
   * What *is* new every time is everything it is drawn against, and each one
   * has a way of going wrong quietly:
   *
   * - the **world** is a fresh object round the same grid, and the closure held
   *   the old one — so a layer that kept it would redraw the map you had before
   *   the edit;
   * - the **shadow generators** went with the old lights, and a caster is
   *   registered on a generator rather than flagged on a mesh — so without
   *   re-registering, the ground silently stops casting;
   * - the **materials** are worked out once per bucket, when the bucket is
   *   made. A terrain repainted in the library changes nothing about the grid,
   *   so nothing would ask again. That is the trap, and it is why every bucket
   *   is repainted here rather than only the ones the grid touched.
   *
   * The rim is the one thing that changes the geometry, so it is compared and
   * the templates rebaked only when it actually moved.
   */
  function retarget(next: Against): void {
    now = next;
    terrainDefs = now.content.terrains?.length ? now.content.terrains : TERRAINS;
    byId = terrainsById(terrainDefs);

    // Before either branch below, because both of them ask what a bucket wears
    // and the answer is what may have changed. `setRim` keeps this cache on
    // purpose -- it is dragged, and re-resolving a material per frame is what
    // that would cost -- so clearing it is this function's business, not its.
    materials.clear();

    const rim = now.world.map?.terrainRim;
    if (rim !== rimSource) {
      // A different edge profile is different geometry, so the buckets go and
      // are built again -- painted from the cleared cache as they are made,
      // and registered with the new shadows. Everything else survives.
      setRim(rim);
      return;
    }

    // Worked out again from the tables as they are now, and put back on the
    // meshes that are already wearing the old answer.
    for (const bucket of buckets.values()) {
      bucket.mesh.material = materialFor(bucket.kind, bucket.tier, shapeOf(bucket.at).rot);
      if (bucket.tier === 'top') now.shadows?.add(bucket.mesh);
    }

    // And only walk the grid if the ground actually moved. Most rebuilds are a
    // click on something standing *on* it, and refilling every buffer to draw
    // the same blocks in the same places is the bulk of what this used to cost.
    // Compared against a copy rather than against the world we had before,
    // because in the editor they are the same two arrays -- see `drawn`.
    if (moved(now.world.terrain)) refresh();
  }

  refresh();

  return {
    root,
    refresh,
    setRim,
    retarget,
    /** How many draw calls the ground currently costs. Read by the debug panel. */
    get drawCalls() {
      let live = 0;
      for (const bucket of buckets.values()) if (bucket.count) live += 1;
      return live;
    },
    dispose() {
      for (const bucket of buckets.values()) bucket.mesh.dispose(false, false);
      buckets.clear();
      root.dispose(false, false);
    },
  };
}

/** The ground of one map, as instanced blocks. */
export type TerrainLayer = ReturnType<typeof createTerrainLayer>;
