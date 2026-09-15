import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
// Side-effect only: this is what adds the thin-instance methods to Mesh. The
// asset panel builds a terrain layer without going through mapView, so it has
// to be imported here rather than relied on from there.
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
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
import { keep, keepModel } from './sceneCache.ts';
import { LEVEL_H } from '../data/dimensions.ts';
import { fileUrl, filePath } from '../data/assets.ts';
import { PROFILES, type EdgeProfile } from '../data/profiles.ts';
import { planSub, planTop, type Piece } from '../data/terrain/edges.ts';
import { materialById } from '../data/materials.ts';
import type { MaterialInput } from '../data/materials.ts';
import { createTerrainBlend } from './terrainBlend.ts';
import { createTerrainVariation } from './terrainVariation.ts';
import { PBRCustomMaterial } from '@babylonjs/materials/custom/pbrCustomMaterial.js';
import { buildTemplates, shapeOf } from '../data/terrain/templates.ts';
import { topologyOf, subSides } from '../data/terrain/mask.ts';
import { normalizeFoot, normalizeRim, type FootProfile, type RimRing } from '../data/terrain/profile.ts';
import { edgeOverride, kindAt, levelAt, EMPTY, type TerrainGrid } from '../data/terrain/grid.ts';
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
  terrains?: readonly Terrain[] | undefined;
  /** The edge profiles terrains and edge overrides name. The game's own when absent. */
  profiles?: readonly EdgeProfile[] | undefined;
  materials?: readonly MaterialInput[] | undefined;
  game?: string | undefined;
};

type World = {
  terrain: TerrainGrid;
  terrainIds: string[];
  map: { terrainRim?: readonly RimRing[] | null; terrainFoot?: Partial<FootProfile> | null };
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

/** Where one edge-profile piece stands. */
type CustomPlacement = {
  gx: number;
  gy: number;
  rot: number;
  level: number;
  lift: number;
};

/**
 * Every placement of one edge-profile model, for one terrain.
 *
 * Unlike `Bucket`, the geometry is not baked on demand — it is imported from
 * a file, which is asynchronous — so a bucket exists (and collects
 * placements) before its meshes do. `parts` is empty until the import lands,
 * at which point it is built once and only its instance buffer changes after
 * that, the same "build once, refill often" split `Bucket`/`upload` makes.
 */
type CustomBucket = {
  path: string;
  kind: number;
  /** Cleared and refilled every `fill()`, same as a `Bucket`'s `count`. */
  placements: CustomPlacement[];
  /**
   * One per mesh the model is made of. Built once, when it has loaded.
   *
   * `original` is what the mesh came wearing, from the glTF's own materials —
   * kept so a shape's material override can be taken off again and the mesh
   * goes back to it, rather than staying stuck on the last override forever.
   */
  parts: { mesh: Mesh; inside: Matrix; original: Mesh['material'] }[];
};

/** A paintable ground is a PBRCustomMaterial, which is a PBRMaterial. */
type Decals = { paintable(name: string, scene: unknown, options?: object): PBRMaterial } | null;

/** A quick editor flourish: simulation and picking already use the final grid. */
const POP_SECONDS = 0.5;
const POP_DEPTH = 0.2;

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
  let profileById = new Map((now.content.profiles ?? PROFILES).map((profile) => [profile.id, profile]));

  /**
   * Which profile one edge of one cell wears: its override, else its
   * terrain's default. Null — the generated rim — when neither names a profile
   * this map knows.
   */
  const profileOfEdge = (gx: number, gy: number, side: number): EdgeProfile | null => {
    const kind = kindAt(now.world.terrain, gx, gy);
    if (kind === EMPTY) return null;
    const id = edgeOverride(now.world.terrain, gx, gy, side) || terrainOf(kind)?.defaultSideProfile || '';
    return (id && profileById.get(id)) || null;
  };
  // Kind 1 is the map's first terrain, so this is offset by one throughout.
  // A map naming a terrain the rules no longer define keeps its cells and
  // draws them in the fallback colour rather than losing them.
  const terrainOf = (kind: number): Terrain | null => {
    const id = now.world.terrainIds[kind - 1];
    return (id ? byId.get(id) : null) ?? null;
  };

  const materialOf = (id: string) =>
    (now.content.materials ? now.content.materials.find((m) => m.id === id) : materialById(id)) ??
    null;
  // A path under assets/, not an asset id: a material names its pictures
  // relative to its own folder and resolves them before asking for a url.
  const urlOf = (path: string) => fileUrl(path, now.content.game);
  const blend = createTerrainBlend(scene, {
    grid: now.world.terrain,
    terrainIds: now.world.terrainIds,
    terrains: terrainDefs,
    materialOf,
    urlOf,
  });
  const variation = createTerrainVariation(materialOf);

  /** What the templates below were baked from, so a retarget can tell. */
  let rimSource: unknown = world.map?.terrainRim;
  let footSource: unknown = world.map?.terrainFoot;
  let templates = buildTemplates(
    normalizeRim(rimSource as readonly RimRing[] | null),
    LEVEL_H,
    normalizeFoot(footSource as Partial<FootProfile> | null),
  );
  const buckets = new Map<string, Bucket>();
  const materials = new Map<string, Surface>();
  /** Keyed `${path}|${kind}`: one terrain's authored mesh, once per file it names. */
  const customBuckets = new Map<string, CustomBucket>();

  /**
   * The grid as it was when these buckets were last filled.
   *
   * A copy, not a reference. The editor's grid is decoded once and written in
   * place ever after — the document, the world and this all hold the same two
   * typed arrays — so there is nothing to compare a later state *against*
   * unless it was kept. Two bytes a tile, which on the biggest map anyone will
   * hand-author is a few kilobytes.
   */
  let drawn: { cols: number; rows: number; kind: Uint8Array; level: Uint8Array; edges: string } | null = null;
  /** The edge overrides, comparably: painting an edge moves nothing else. */
  const edgesKey = (grid: TerrainGrid) =>
    grid.edges ? `${grid.edges.join('')}|${(grid.edgeIds ?? []).join(',')}` : '';
  /** Cell index -> seconds since its latest visual change. */
  const pops = new Map<number, number>();

  const popOffset = (at: number): number => {
    const elapsed = pops.get(at);
    if (elapsed === undefined) return 0;
    const t = Math.min(1, elapsed / POP_SECONDS);
    // Ease-out-back: rises quickly, passes the target by a hair, then settles.
    const u = t - 1;
    const eased = 1 + 2.70158 * u * u * u + 1.70158 * u * u;
    return (eased - 1) * POP_DEPTH;
  };

  /** Whether the ground has moved since the buffers were last filled. */
  function moved(grid: TerrainGrid): boolean {
    if (!drawn || drawn.cols !== grid.cols || drawn.rows !== grid.rows) return true;
    if (drawn.edges !== edgesKey(grid)) return true;
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
      const custom = tier === 'top';
      const key = `terrain:${tier}:${custom ? (now.decals ? 'decal' : 'custom') : 'plain'}:${tier === 'top' ? `kind:${terrain?.id ?? kind}:` : ''}${named ? materialKey(named) : `tint:${tint}`}`;
      const lit = keep(scene, key, () =>
        custom
          ? (now.decals
              ? now.decals.paintable(key, scene, { roughness: 0.9 })
              : Object.assign(new PBRCustomMaterial(key, scene), { roughness: 0.9 }))
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
    if (tier === 'top') {
      blend.configure(material as PBRCustomMaterial, kind);
      if (named?.id) variation.configure(material as PBRCustomMaterial, named.id);
    }
    return material;
  }

  // --- buckets ------------------------------------------------------------

  function bucketFor(at: number, tier: 'top' | 'sub', kind: number): Bucket {
    const key = `${at}|${tier}|${kind}`;
    const hit = buckets.get(key);
    if (hit) return hit;

    const data = tier === 'top'
      ? templates.top(at & 0xff, at >> 8)
      : templates.sub(at & 0b1111, at >> 4);
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

  function push(bucket: Bucket, gx: number, gy: number, top: number, lift = 0): void {
    if ((bucket.count + 1) * 16 > bucket.matrices.length) {
      const grown = new Float32Array(bucket.matrices.length * 2);
      grown.set(bucket.matrices);
      bucket.matrices = grown;
    }
    // A template's own walkable face is y = 0 and its wall hangs one level
    // below, so the instance is placed at the height of the face it presents.
    Matrix.Translation(gx + 0.5, top * LEVEL_H + lift, gy + 0.5).copyToArray(
      bucket.matrices,
      bucket.count * 16,
    );
    bucket.count += 1;
  }

  // --- edge-profile pieces ----------------------------------------------------

  /**
   * A shape's chosen material, kept and painted like any other named one.
   *
   * No blend, no decals, no variation — those are what makes a *generated*
   * top block paintable and read as one continuous surface with its
   * neighbours; an authored mesh is its own object and never asked to blend
   * into anything. This is the same plain path `materialFor` already takes
   * for a stack's `sub` material, just not tied to a tier.
   */
  function customMaterialFor(id: string): Surface | null {
    const named = id ? materialOf(id) : null;
    if (!named) return null;
    const material = keep(scene, `terrainBlock:${materialKey(named)}`, () =>
      materialFrom(named, scene, urlOf),
    );
    // Re-applied rather than assumed, same as every other named material here:
    // a picture or a colour edited in the library since has to land on it.
    applyMaterial(named, material, scene, urlOf);
    return material;
  }

  /**
   * Paint a custom bucket's meshes with its shape's chosen material, or put
   * back what they came wearing if the terrain no longer names one.
   *
   * Called once when a bucket's meshes are first built and again on every
   * `retarget()` — the override can change (a different material picked, or
   * cleared) without the grid itself moving, which is nothing `fill()` would
   * ever notice.
   */
  function paintCustomBucket(bucket: CustomBucket): void {
    // A profile is geometry only: its pieces wear the terrain's side material.
    const id = terrainOf(bucket.kind)?.sub ?? '';
    const material = id ? customMaterialFor(id) : null;
    for (const part of bucket.parts) {
      part.mesh.material = material ?? part.original;
      now.shadows?.add(part.mesh);
    }
  }

  /**
   * One tile's placement, as the matrix a thin instance needs.
   *
   * Rotated about the tile's own centre before it is moved there, same order
   * `Matrix.Translation` already reads by itself in `push` — turn first, then
   * carry to where it stands. `rot` is quarter turns, same units `shapeOf`
   * reports them in.
   */
  const placementMatrix = (p: CustomPlacement): Matrix =>
    Matrix.RotationY(p.rot * (Math.PI / 2)).multiply(
      Matrix.Translation(p.gx + 0.5, p.level * LEVEL_H + p.lift, p.gy + 0.5),
    );

  /**
   * The bucket for one terrain's one authored mesh, importing it on first ask.
   *
   * Keyed by shape as well as path and kind: two shapes on one terrain could
   * in principle name the same file, and each still wants its own material
   * override applied, so they cannot share one bucket's meshes.
   */
  function customBucketFor(path: string, kind: number): CustomBucket {
    const key = `${path}|${kind}`;
    const hit = customBuckets.get(key);
    if (hit) return hit;

    const bucket: CustomBucket = { path, kind, placements: [], parts: [] };
    customBuckets.set(key, bucket);

    const url = urlOf(path);
    if (url) {
      keepModel(
        scene,
        // Keyed by the file alone, like `props.ts`'s own `model()` — the same
        // mesh named by two terrains, or by two shapes of one terrain, is
        // imported once and cloned per use, not per kind.
        `terrainBlock:${url}`,
        async () => {
          const result = await ImportMeshAsync(url, scene);
          const holder = new TransformNode(`terrainBlock:${url}`, scene);
          for (const mesh of result.meshes) if (!mesh.parent) mesh.parent = holder;
          return holder;
        },
        (holder) => buildCustomParts(bucket, holder),
      );
    }
    return bucket;
  }

  /**
   * Clone every mesh the model is made of, once, and fill their buffers with
   * whatever placements the bucket already holds.
   *
   * `inside` is where a child mesh sits *inside* the imported model — read off
   * its world matrix while the holder itself sits at the origin, exactly the
   * technique `attachMany` in `props.ts` uses for the same reason: a thin
   * instance is a matrix and nothing else, so a model made of several meshes
   * can only be instanced by folding where each piece sits inside the model
   * into where the model stands on the map.
   */
  function buildCustomParts(bucket: CustomBucket, holder: TransformNode | null): void {
    // A model that failed to load or named nothing leaves the shape undrawn
    // rather than drawing garbage or throwing across a whole map refresh.
    if (!holder) return;
    holder.computeWorldMatrix(true);
    for (const child of holder.getChildMeshes()) {
      // A glTF arrives wrapped in a root node with no geometry of its own.
      if (!(child instanceof Mesh) || !child.getTotalVertices()) continue;
      const inside = child.computeWorldMatrix(true).clone();
      const mesh = child.clone(`terrainBlock:${bucket.path}:${child.name}`, root, true);
      if (!mesh) continue;
      // A clone shares its source's Geometry, and a thin-instance buffer lives
      // on the Geometry — so two buckets cloning one file (the same profile on
      // two terrains) would overwrite each other's instances, leaving one with
      // a count its buffer does not hold: missing sides and stray triangles.
      mesh.makeGeometryUnique();
      mesh.setEnabled(true);
      mesh.position.set(0, 0, 0);
      mesh.rotationQuaternion = null;
      mesh.rotation.set(0, 0, 0);
      mesh.scaling.set(1, 1, 1);
      mesh.receiveShadows = true;
      mesh.isPickable = true;
      mesh.thinInstanceEnablePicking = true;
      bucket.parts.push({ mesh, inside, original: mesh.material });
    }
    paintCustomBucket(bucket);
    uploadCustom(bucket);
  }

  /**
   * Rewrite a custom bucket's instance buffers from its current placements.
   *
   * Shadows are not re-registered here — that happens once when a part is
   * built and again on every `retarget()` (see `paintCustomBucket`), the same
   * two points `bucketFor`/`retarget()` register a procedural bucket's mesh.
   * A grid edit moves placements, not shadow generators.
   */
  function uploadCustom(bucket: CustomBucket): void {
    for (const { mesh, inside } of bucket.parts) {
      if (!bucket.placements.length) {
        mesh.setEnabled(false);
        continue;
      }
      mesh.setEnabled(true);
      const matrices = new Float32Array(bucket.placements.length * 16);
      bucket.placements.forEach((placement, i) => {
        inside.multiply(placementMatrix(placement)).copyToArray(matrices, i * 16);
      });
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
      mesh.thinInstanceRefreshBoundingInfo(false);
    }
  }

  /** Refill instance buffers, optionally carrying each edited column's pop. */
  function fill(): void {
    const grid = now.world.terrain;
    for (const bucket of buckets.values()) bucket.count = 0;
    for (const bucket of customBuckets.values()) bucket.placements.length = 0;

    for (let gy = 0; gy < grid.rows; gy += 1) {
      for (let gx = 0; gx < grid.cols; gx += 1) {
        const kind = kindAt(grid, gx, gy);
        if (kind === EMPTY) continue;
        const level = levelAt(grid, gx, gy);
        if (level === null) continue;
        const lift = popOffset(gy * grid.cols + gx);

        const topology = topologyOf(grid, gx, gy) ?? 0xff;
        const terrain = terrainOf(kind);
        const place = (pieces: readonly Piece[], at: number) => {
          for (const piece of pieces) {
            // A file id resolves through the asset table; anything else is a
            // path relative to the terrain's own folder, as before.
            const path = filePath(terrain?.path, piece.mesh);
            if (!path) continue;
            customBucketFor(path, kind).placements.push({ gx, gy, rot: piece.rot, level: at, lift });
          }
        };

        // A tile is either one whole profile piece or the generated block,
        // exactly as it was before profiles.
        const top = planTop(gx, gy, topology, profileOfEdge);
        if (top.profiled) {
          place(top.pieces, level);
        } else {
          const topFeet = topology & 0b1111 & ~subSides(grid, gx, gy, level - 1);
          push(bucketFor(topology | (topFeet << 8), 'top', kind), gx, gy, level, lift);
        }

        // Down the stack. The mask can only lose bits as it descends, so the
        // first fully buried segment is the last one worth drawing — every
        // block below it is enclosed on all four sides and would never be seen.
        for (let at = level - 1; at >= 0; at -= 1) {
          const mask = subSides(grid, gx, gy, at);
          if (!mask) break;
          const sub = planSub(gx, gy, mask, profileOfEdge);
          if (sub.profiled) {
            place(sub.pieces, at);
            continue;
          }
          const feet = mask & ~subSides(grid, gx, gy, at - 1);
          push(bucketFor(mask | (feet << 4), 'sub', kind), gx, gy, at, lift);
        }
      }
    }

    for (const bucket of buckets.values()) upload(bucket);
    for (const bucket of customBuckets.values()) uploadCustom(bucket);
  }

  /** Rebuild every instance buffer from the grid. Meshes and materials survive. */
  function refresh(): void {
    const grid = now.world.terrain;
    blend.updateGrid();
    if (drawn && drawn.cols === grid.cols && drawn.rows === grid.rows) {
      for (let i = 0; i < grid.kind.length; i += 1) {
        if ((drawn.kind[i] !== grid.kind[i] || drawn.level[i] !== grid.level[i]) && grid.kind[i] !== EMPTY) {
          pops.set(i, 0);
        }
      }
    }
    fill();
    drawn = {
      cols: grid.cols,
      rows: grid.rows,
      kind: Uint8Array.from(grid.kind),
      level: Uint8Array.from(grid.level),
      edges: edgesKey(grid),
    };
  }

  const popObserver = scene.onBeforeRenderObservable.add(() => {
    if (!pops.size || !root.isEnabled()) return;
    const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
    for (const [at, elapsed] of pops) {
      const next = elapsed + dt;
      if (next >= POP_SECONDS) pops.delete(at);
      else pops.set(at, next);
    }
    fill();
  });

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
  function setRim(
    rim: readonly RimRing[] | null | undefined,
    foot: Partial<FootProfile> | null | undefined = now.world.map?.terrainFoot,
  ): void {
    rimSource = rim;
    footSource = foot;
    templates = buildTemplates(normalizeRim(rim), LEVEL_H, normalizeFoot(foot));
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
    // A profile edited in the library, or a terrain given a different default,
    // changes which pieces go where without the grid moving at all.
    const profilesBefore = profilesKey;
    profileById = new Map((now.content.profiles ?? PROFILES).map((profile) => [profile.id, profile]));
    profilesKey = profileSignature();
    blend.retarget({
      grid: now.world.terrain,
      terrainIds: now.world.terrainIds,
      terrains: terrainDefs,
      materialOf,
      urlOf,
    });
    variation.retarget(materialOf);

    // Before either branch below, because both of them ask what a bucket wears
    // and the answer is what may have changed. `setRim` keeps this cache on
    // purpose -- it is dragged, and re-resolving a material per frame is what
    // that would cost -- so clearing it is this function's business, not its.
    materials.clear();

    // Nothing about a custom bucket depends on the rim, so it gets no branch
    // below -- only its material (which may have changed, or been cleared)
    // and the shadow generator, which is new every rebuild same as for a
    // `Bucket`. Both are `paintCustomBucket`'s job.
    for (const bucket of customBuckets.values()) paintCustomBucket(bucket);

    const rim = now.world.map?.terrainRim;
    const foot = now.world.map?.terrainFoot;
    if (rim !== rimSource || foot !== footSource) {
      // A different edge profile is different geometry, so the buckets go and
      // are built again -- painted from the cleared cache as they are made,
      // and registered with the new shadows. Everything else survives.
      setRim(rim, foot);
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
    if (moved(now.world.terrain) || profilesKey !== profilesBefore) refresh();
  }

  const profileSignature = () =>
    JSON.stringify([[...profileById.values()], terrainDefs.map((one) => one.defaultSideProfile)]);
  let profilesKey = profileSignature();
  refresh();

  return {
    root,
    refresh,
    setRim,
    retarget,
    get animating() {
      return pops.size > 0;
    },
    visualOffsetAt(gx: number, gy: number) {
      return popOffset(gy * now.world.terrain.cols + gx);
    },
    /** How many draw calls the ground currently costs. Read by the debug panel. */
    get drawCalls() {
      let live = 0;
      for (const bucket of buckets.values()) if (bucket.count) live += 1;
      for (const bucket of customBuckets.values()) {
        if (bucket.placements.length) live += bucket.parts.length;
      }
      return live;
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(popObserver);
      blend.dispose();
      for (const bucket of buckets.values()) bucket.mesh.dispose(false, false);
      buckets.clear();
      for (const bucket of customBuckets.values()) {
        for (const { mesh } of bucket.parts) mesh.dispose(false, false);
      }
      customBuckets.clear();
      root.dispose(false, false);
    },
  };
}

/** The ground of one map, as instanced blocks. */
export type TerrainLayer = ReturnType<typeof createTerrainLayer>;
