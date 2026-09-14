import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { eulerOf, scaleOf } from '../data/transform.ts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
// Side-effect only: this is what adds the thin-instance methods to Mesh.
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
// Side-effect only: this is what teaches the loader above to read a .glb.
import '@babylonjs/loaders/glTF/index.js';
import { assetFrames, filePath, fileUrl } from '../data/assets.ts';
import {
  materialById,
  normalizeMaterial,
  type Material,
  type MaterialInput,
} from '../data/materials.ts';
import { PROPS, propById, type PlacedProp, type Prop } from '../data/props.ts';
import { LEVEL_H } from '../data/dimensions.ts';
import { applyMaterial, colorOf, materialFrom, materialKey, surface } from './materials.ts';
import { keep, keepModel } from './sceneCache.ts';
import { pickOf, tagPick } from './pick.ts';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Node } from '@babylonjs/core/node.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Surface } from './materials.ts';
import type { Heights, Shadows } from './lights.ts';

/** A sprite sheet being played on a plane. */
type Playing = {
  plane: Mesh;
  show: (at: number) => void;
  count: number;
  fps: number;
  loop: boolean;
};

/** One playing sheet, and how far through it is. */
type Flipbook = Playing & { at: number };

/** One prop standing on the map. */
export type Placement = {
  def: Prop;
  node: TransformNode;
  /** What its instances are drawn under, and what `standing` measures from. */
  root: TransformNode;
  entry: PlacedProp;
  /** Set when the prop is drawn as a sprite sheet rather than a model. */
  sheet?: Playing;
  /** Set once the model has finished loading, which may be after placement. */
  body?: Node;
};

/**
 * The objects a map stands on its tiles: a model from the game's assets folder,
 * turned the way the tile says.
 *
 * Loading is the whole difficulty. A map is built in one synchronous pass — the
 * ground, the walls and everything else exist by the time `buildMapView`
 * returns — but a model arrives over the network whenever it arrives. So a
 * placement gets its node immediately and its geometry later, and a map torn
 * down before its models land must not have them turn up afterwards and attach
 * to a scene that has moved on. That is what `alive` is for.
 *
 * One template per asset, cloned per placement. A map with forty barrels
 * fetches one barrel.
 */

const DEG = Math.PI / 180;

/** Where a placement that has been switched off is drawn: nowhere. */
const GONE = Matrix.Scaling(0, 0, 0);


/**
 * @param scene the one scene
 * @param {object[]} [propDefs] the game's objects. Left out, the built game's.
 * @param {string} [game] which game folder to fetch files from. The editor
 *   names one because it is a tool over several; the game itself never does —
 *   its files came through the bundler and carry hashed names.
 */
export function createPropRuntime(
  scene: Scene,
  propDefs?: readonly Prop[] | null,
  game = '',
  materialDefs?: readonly MaterialInput[] | null,
) {
  const props = propDefs ?? PROPS;

  const propOf = propDefs
    ? (id: string): Prop | null => props.find((p) => p.id === id) ?? null
    : propById;

  /**
   * A file one of these records names, as a url.
   *
   * Names are relative to the record's own folder, so the record has to come
   * along to read one — which is the whole trade that makes a folder movable
   * without rewriting what is inside it.
   */
  const urlFor = (record: { path?: string }, named: string | undefined): string =>
    fileUrl(filePath(record.path, named), game);

  /** The named surfaces, normalized so every field is there to read. */
  const materialOf = (id: string): Material | null => {
    const found = materialDefs ? materialDefs.find((one) => one.id === id) : materialById(id);
    return found ? normalizeMaterial(found) : null;
  };

  /** Which object wears which material, worked out once per map. */
  const materials = new Map<string, Surface | null>();
  const owned: { dispose: () => void }[] = [];
  const placed: Placement[] = [];
  /** The same, by the index the map knows each one by. */
  const placedAt = new Map<number, Placement>();
  /** The sheets that are playing, and one observer stepping all of them. */
  const flipbooks: Flipbook[] = [];
  let clock: Observer<Scene> | null = null;
  let alive = true;

  /** Placements of one object, waiting to be drawn together. See `flush`. */
  type Waiting = {
    def: Prop;
    root: TransformNode;
    shadows: Shadows | null;
    of: { record: Placement; index: number }[];
  };
  const waiting = new Map<string, Waiting>();
  /** The single meshes standing in for many placements, to be disposed. */
  const instanced: Mesh[] = [];
  /**
   * Where one placement's matrix lives, for the ones drawn as instances.
   *
   * A thin instance has no node, so moving one means writing sixteen numbers
   * into the buffer its mesh was given. This is the index from "placement 12"
   * to those numbers — one entry per mesh the model is made of, because a model
   * of three meshes is three instanced meshes carrying one matrix each.
   *
   * Kept so the editor can slide an instanced object during a drag instead of
   * falling back to rebuilding the map sixty times a second. See `move`.
   */
  /** `inside` is where the mesh sits in its model; `real` is that, stood on the map. */
  type Slot = { mesh: Mesh; at: number; index: number; inside: Matrix; real: Matrix };
  const slots = new Map<number, Slot[]>();
  /**
   * Placements the editor has switched off.
   *
   * A thin instance has no node to disable, so one is hidden by writing a
   * matrix that collapses it to a point. Kept as intent rather than as a
   * property of the instance, because the panel can switch a placement off
   * before its model has arrived — and then the instance that turns up has to
   * turn up already hidden. See `attachMany`.
   */
  const off = new Set<number>();
  let queued = false;

  /**
   * Advance every sprite on the map, from one observer rather than a timer
   * each: a hundred torches should be one callback, and a sheet that kept
   * playing while the tab was in the background would come back having burned
   * through however many minutes of frames.
   */
  function startClock(): void {
    if (clock) return;
    clock = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      for (const book of flipbooks) {
        const was = Math.floor(book.at);
        book.at += dt * book.fps;
        // A clip that does not loop stops on its last frame rather than
        // vanishing: a one-shot sprite is usually a thing that has settled.
        if (!book.loop && book.at >= book.count) book.at = book.count - 1;
        const now = Math.floor(book.at);
        if (now !== was) book.show(now);
      }
    });
  }

  /**
   * The model for an asset, imported once per scene and kept between maps.
   *
   * Kept out of the scene's own tree and disabled, so it is never drawn and
   * never picked — it exists only to be cloned. It outlives this runtime,
   * because a map is rebuilt on every edit and a model re-read from disk each
   * time is a map that blinks away whenever you touch it.
   *
   * `use` is called straight away for a file that has already landed, which is
   * every rebuild after the first.
   */
  function model(def: Prop, use: (holder: TransformNode | null) => void): void {
    const url = urlFor(def, def.mesh);
    if (!url) {
      use(null);
      return;
    }
    keepModel(
      scene,
      // Keyed for objects rather than by the file alone: a block loads the same
      // model merged into one mesh and scaled to the grid, and this one is kept
      // whole. Same file, two different things to keep.
      `prop:${url}`,
      async () => {
        const result = await ImportMeshAsync(url, scene);
        const holder = new TransformNode(`asset:${def.id}`, scene);
        for (const mesh of result.meshes) {
          if (!mesh.parent) mesh.parent = holder;
        }
        return holder;
      },
      use,
    );
  }

  /**
   * The material a prop wears, or null to keep the model's own.
   *
   * Only built when the prop actually asks for something the model does not
   * already say — a texture, or a tint that is not white. Otherwise the glTF's
   * materials are left alone, which is the point of exporting them with it.
   */
  function materialFor(def: Prop): Surface | null {
    // `has` then `get` rather than `get` alone: null is a real answer here --
    // a prop with neither texture nor tint keeps whatever its model came with.
    if (materials.has(def.id)) return materials.get(def.id) ?? null;

    // A named surface wins outright: it carries its own picture, tint, tiling
    // and everything about how the light hits it, so the object's own texture
    // and tint below would be a second answer to the same question.
    const named = def.material ? materialOf(def.material) : null;
    if (named) {
      // Kept per scene like the model, and what the material *says* written on
      // afterwards: the shader is the expensive half and it does not change
      // with a tint, so tuning a material shows on the map without a reload.
      // A material names its pictures relative to its own folder, not the
      // object's: the same material is worn by objects filed anywhere.
      const textureUrl = (path: string): string => fileUrl(path, game);
      const built = keep(scene, materialKey(named), () => materialFrom(named, scene, textureUrl));
      applyMaterial(named, built, scene, textureUrl);
      materials.set(def.id, built);
      return built;
    }

    const textureUrl = urlFor(def, def.texture);
    const tinted = (def.tint ?? 0xffffff) !== 0xffffff;
    if (!textureUrl && !tinted) {
      materials.set(def.id, null);
      return null;
    }

    // Kept per scene, like the model: a material's shader has to be compiled
    // before anything wearing it can be drawn, and a map is rebuilt on every
    // edit. What the object says — its tint, its picture — is written on
    // afterwards, because those are editable and the shader does not change
    // with them.
    const material = keep(scene, `material:prop:${def.id}`, () =>
      surface(`prop:${def.id}`, scene, { roughness: 0.9 }),
    );
    material.albedoColor = colorOf(def.tint ?? 0xffffff);

    material.albedoTexture = null;
    if (textureUrl) {
      const url = textureUrl;
      // invertY off, because this is worn over a model's own UVs and those came
      // out of a glTF, which puts v=0 at the *top* of the picture where
      // Babylon's own meshes put it at the bottom. Babylon's glTF loader
      // uploads the textures it builds itself the same way. Left at the default
      // the model samples the mirror image of the island it was unwrapped onto,
      // which on a texture with any blank space in it is blank — a grey box
      // wearing a wood texture and no error anywhere to say why.
      const texture = keep(scene, `texture:${url}`, () => new Texture(url, scene, false, false));
      // Laid on as it was painted. Tiling, offset and alpha used to come off a
      // record about the file; they live on a *material* now, which is what
      // this branch is the shorthand alternative to — an object that needs any
      // of them names a material instead, and that is the whole reason a
      // material wins over this.
      material.albedoTexture = texture;
      // A tint multiplies the picture; white leaves it as it was painted.
      material.albedoColor = tinted ? colorOf(def.tint) : Color3.White();
    }

    materials.set(def.id, material);
    return material;
  }

  /**
   * A sprite sheet standing on the tile, playing.
   *
   * The animation is the texture's own window sliding over the sheet — one cell
   * wide and one cell tall, moved a cell at a time — rather than a texture per
   * frame. One upload, one material, and changing frame costs two numbers.
   *
   * Babylon's V runs *up* the picture while a sheet is read *down* it, which is
   * the subtlety here as it is in the visual effects. The texture is uploaded
   * the way up it was drawn, so V=1 is its top edge and a cell's row has to be
   * counted back from there — a single-row strip comes out right either way,
   * which is exactly why the mistake survives until somebody loads a 5x5.
   *
   * Unlike a model this is built at once: a picture needs no parsing, and the
   * plane can stand there and be re-proportioned when the file lands.
   */
  function sheetBody(def: Prop, node: TransformNode): Playing | null {
    const url = urlFor(def, def.sheet);
    if (!url) return null;

    // The six numbers that cut the picture into cells are read off the object
    // itself. They used to sit on a record about the file, which meant two
    // objects could not read one sheet differently; `Prop` carries them as
    // optional fields, so an object with none plays the whole picture as a
    // single frame.
    const { columns, rows, first, count } = assetFrames(def);

    // One unit tall, and as wide as a cell is — which is not known until the
    // picture has loaded, so it starts square and is corrected below.
    const plane = MeshBuilder.CreatePlane(`prop:${def.id}`, { size: 1 }, scene);
    plane.parent = node;
    plane.position.y = 0.5;
    plane.isPickable = true;
    // Carries the group's tag onto the plane, so a pick on the drawn quad
    // answers with the prop rather than with nothing.
    const tag = pickOf(node);
    if (tag) tagPick(plane, tag);
    // Around Y only: a sprite that stands up should keep standing as the view
    // turns, where BILLBOARDMODE_ALL would tip it back to face a raised camera.
    if (def.billboard !== false) plane.billboardMode = Mesh.BILLBOARDMODE_Y;

    const material = new StandardMaterial(`prop:${def.id}`, scene);
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    // A tint multiplies a lit surface; on an unlit one the emissive colour is
    // the multiplier the texture is read through, so white leaves it be.
    material.emissiveColor = colorOf(def.tint ?? 0xffffff);
    // A sprite is a cut-out, not a pane of glass: writing depth would let it
    // hide whatever stands behind it across the whole of its transparent half.
    material.disableDepthWrite = true;
    material.useAlphaFromDiffuseTexture = true;

    const texture = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    texture.hasAlpha = true;
    // Clamped, so a cell never bleeds the one beside it at its edge.
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.uScale = 1 / columns;
    texture.vScale = 1 / rows;
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    plane.material = material;
    plane.receiveShadows = false;

    // The cell's own proportions, once there is a picture to ask. A sheet of
    // tall frames stretched onto a square is the sort of wrong that looks like
    // bad art rather than like a bug.
    texture.onLoadObservable.addOnce(() => {
      if (plane.isDisposed()) return;
      const size = texture.getSize();
      if (!size.height) return;
      plane.scaling.x = size.width / columns / (size.height / rows);
    });

    owned.push(material, texture);

    const show = (at: number): void => {
      const frame = first + (((at % count) + count) % count);
      texture.uOffset = (frame % columns) / columns;
      texture.vOffset = 1 - (Math.floor(frame / columns) + 1) / rows;
    };
    show(0);

    return { plane, show, count, fps: Math.max(0.5, def.fps ?? 12), loop: def.loop !== false };
  }

  /**
   * Stand one object on a tile.
   *
   * Returns straight away with an empty node in the right place: the map is
   * built synchronously and the caller has a list to fill in. The model drops
   * into that node when it arrives.
   */
  function place(
    entry: PlacedProp,
    index: number,
    world: Heights,
    root: TransformNode,
    shadows?: Shadows | null,
  ): Placement | null {
    const def = propOf(entry.id ?? '');
    if (!def) return null;

    const node = new TransformNode(`prop${index}`, scene);
    node.parent = root;
    stand(node, def, entry, world);
    // What the editor clicks on. Every mesh under here inherits it by walking
    // up, the same way a torch's parts do.
    tagPick(node, { list: 'props', index });

    const record: Placement = { def, node, root, entry };
    placed.push(record);
    placedAt.set(index, record);

    // A model if it names one, a sprite sheet otherwise. Both is a model: the
    // mesh is the more specific answer, and drawing two bodies in one place is
    // worse than quietly preferring one.
    if (!def.mesh) {
      if (def.sheet) {
        const playing = sheetBody(def, node);
        if (playing) {
          record.sheet = playing;
          // No shadow: a sprite's would be that of a flat card turning to
          // follow the camera, which is worse than none.
          flipbooks.push({ ...playing, at: 0 });
          startClock();
        }
      }
      return record;
    }

    // Not built here. Everything placed in this pass is gathered first, so an
    // object standing on the map fifty times can be drawn once — see `flush`.
    const group = waiting.get(def.id) ?? { def, root, shadows: shadows ?? null, of: [] };
    group.of.push({ record, index });
    waiting.set(def.id, group);
    schedule();

    return record;
  }

  /**
   * Put a placement's node where the placement says.
   *
   * The ground it stands on, then the object's own lift, then this
   * placement's — which is what puts a crate on top of a crate rather than
   * inside it. The placement's own turn and scale go on top of the
   * definition's: the definition says how the thing stands, and these say how
   * this one does.
   */
  function stand(node: TransformNode, def: Prop, entry: PlacedProp, world: Heights): void {
    const x = entry.gx + 0.5;
    const z = entry.gy + 0.5;
    node.position.set(x, world.heightAt(x, z) * LEVEL_H + (def.lift ?? 0) + (entry.lift ?? 0), z);
    node.rotation.copyFrom(eulerOf(entry));
    node.rotation.y += (def.rotY ?? 0) * DEG;
    node.scaling.copyFrom(scaleOf(entry)).scaleInPlace(def.scale ?? 1);
  }

  /**
   * Every placement of one object, drawn as thin instances of a single mesh.
   *
   * All of them, however few. There used to be a threshold — below it each
   * placement got the model cloned into its own node — and the only thing that
   * bought was a node the editor could slide during a drag. An instance can be
   * slid now (see `move`), so the clone path bought nothing and cost a mesh per
   * placement: building a map was proportional to how much was standing on it
   * rather than to how many *kinds* of thing were.
   *
   * The model's own shape is baked into every instance rather than kept as a
   * parent node: a thin instance is a matrix and nothing else, so where a mesh
   * sits *inside* its model has to be folded into where the model stands on the
   * map. That is `inside.multiply(at)` below, and it is what lets a model made
   * of several meshes be instanced at all.
   *
   * The empty node each placement already has is left alone. It draws nothing
   * and costs nothing, it is what a sprite sheet hangs off, and it is what
   * says where this placement stands.
   */
  function attachMany(group: Waiting, holder: TransformNode): void {
    const { def, root, shadows } = group;
    const material = materialFor(def);
    const indices = group.of.map((one) => one.index);

    // Where each one stands, as a matrix. Read off the node rather than worked
    // out again, so there is one answer to where an object goes.
    const stood = group.of.map(({ record }) => standing(record.node, root));

    holder.computeWorldMatrix(true);
    for (const child of holder.getChildMeshes()) {
      // A glTF arrives wrapped in a `__root__` node that carries no geometry of
      // its own. Instancing it would be twelve copies of nothing, drawn and
      // picked against for no reason.
      if (!(child instanceof Mesh) || !child.getTotalVertices()) continue;
      // Where this mesh sits inside the model. The holder is at the origin and
      // untouched, so its children's world matrices *are* model space.
      const inside = child.computeWorldMatrix(true).clone();

      const mesh = child.clone(`props:${def.id}:${child.name}`, root, true);
      if (!mesh) continue;
      mesh.setEnabled(true);
      // Identity, because `inside` rides on every instance instead.
      mesh.position.set(0, 0, 0);
      mesh.rotationQuaternion = null;
      mesh.rotation.set(0, 0, 0);
      mesh.scaling.set(1, 1, 1);
      if (material) mesh.material = material;
      mesh.receiveShadows = true;

      // Where each instance really stands, kept so it can be moved and put
      // back after being switched off. The buffer itself may say otherwise:
      // a placement the panel has hidden goes in collapsed.
      const here: Slot[] = stood.map((at, i) => ({
        mesh,
        at: i,
        index: indices[i],
        inside,
        real: inside.multiply(at),
      }));

      const matrices = new Float32Array(stood.length * 16);
      for (const slot of here) shown(slot).copyToArray(matrices, slot.at * 16);
      // Updatable, said outright: Babylon's default is a static buffer, and a
      // static buffer quietly ignores `thinInstanceSetMatrixAt` -- see `restand`.
      mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
      mesh.thinInstanceEnablePicking = true;

      // One mesh standing in for many, so a pick says which instance it hit and
      // this says which placement that instance is. The shape walls used.
      tagPick(mesh, { list: 'props', instances: indices });
      if (def.shadow !== false) shadows?.add(mesh);
      instanced.push(mesh);

      // Which instance belongs to which placement. See `move` and `show`.
      for (const slot of here) {
        const held = slots.get(slot.index);
        if (held) held.push(slot);
        else slots.set(slot.index, [slot]);
      }
    }
  }

  /** Where an instance is drawn: nowhere at all, if it has been switched off. */
  const shown = (slot: Slot): Matrix => (off.has(slot.index) ? GONE : slot.real);

  /**
   * Where a placement's node stands, as the matrix an instance wears.
   *
   * Relative to the root the instances hang off rather than read straight off
   * the node, because a node need not be the root's own child: a part of an
   * actor hangs off another part — a helmet off a head — and stands wherever
   * that part puts it.
   */
  const standing = (node: TransformNode, root: TransformNode): Matrix =>
    node.computeWorldMatrix(true).multiply(Matrix.Invert(root.computeWorldMatrix(true)));

  /**
   * Stand one placement again, where the placement now says.
   *
   * What the editor calls while a thing is being dragged, turned or scaled,
   * so the change shows without the map being built again: the node is put
   * where the placement says and every instance drawn for it wears the whole
   * matrix again. The whole matrix rather than a slide, because a turn or a
   * scale changes every number in it.
   *
   * @returns false when this placement is not drawn.
   */
  function restand(index: number, entry: PlacedProp, world: Heights): boolean {
    const record = placedAt.get(index);
    if (!record) return false;
    record.entry = entry;
    stand(record.node, record.def, entry, world);
    const here = slots.get(index);
    if (!here?.length) return true;
    const at = standing(record.node, record.root);
    for (const slot of here) {
      slot.real = slot.inside.multiply(at);
      stamp(slot);
    }
    return true;
  }

  /** Put one instance's matrix into the buffer its mesh is reading. */
  function stamp(slot: Slot): void {
    // Cloned, because Babylon keeps the object it is handed as its own answer
    // to where that instance is — a shared one would make every instance it
    // was ever used for report the last place it went.
    slot.mesh.thinInstanceSetMatrixAt(slot.at, shown(slot).clone());
  }

  /**
   * Slide one placement, without rebuilding anything.
   *
   * The offset goes straight onto the matrix's translation. Babylon composes
   * row-vector-first, so the last row *is* where the instance stands and adding
   * to it is exactly a translation after everything else — which matters,
   * because the matrix already has the mesh's place inside its model baked into
   * it and re-deriving that here would be a second answer to `attachMany`.
   *
   * @returns false when this placement is not drawn — a sprite sheet, which
   *   hangs off its own node, or a model that has not landed yet.
   */
  function move(index: number, dx: number, dy: number, dz: number): boolean {
    const here = slots.get(index);
    if (!here?.length) return false;
    for (const slot of here) {
      slot.real.addTranslationFromFloats(dx, dy, dz);
      stamp(slot);
    }
    return true;
  }

  /**
   * Draw one placement, or stop drawing it.
   *
   * A thin instance cannot be disabled — there is no node — so it is collapsed
   * to a point instead. Remembered whether or not it is drawn yet: the panel
   * can switch something off while its model is still on the way, and the
   * instance that arrives afterwards has to arrive already switched off.
   */
  function show(index: number, on: boolean): void {
    if (on === !off.has(index)) return;
    if (on) off.delete(index);
    else off.add(index);
    for (const slot of slots.get(index) ?? []) stamp(slot);
  }

  /**
   * Draw everything placed since the last time.
   *
   * Batched rather than drawn as it is placed, because whether an object is
   * worth instancing is a question about *all* of them and a caller places them
   * one at a time.
   *
   * A caller that places a batch should call `draw` when it has finished. The
   * microtask below is the safety net for one that forgets, and it used to be
   * the only way this ran — which cost a frame every time, because a render
   * loop calls the update and the render from inside one task and microtasks
   * do not get a turn between them. Every object on the map was missing from
   * the first frame after every rebuild: on a drag, which rebuilt on every
   * pointer move, that was every frame, and it read as the whole map blinking.
   */
  function flush(): void {
    queued = false;
    if (!alive) return;
    const groups = [...waiting.values()];
    waiting.clear();

    for (const group of groups) {
      const live = group.of.filter(({ record }) => !record.node.isDisposed());
      if (!live.length) continue;
      model(group.def, (holder) => {
        if (!alive || !holder) return;
        attachMany({ ...group, of: live }, holder);
      });
    }
  }

  function schedule(): void {
    if (queued) return;
    queued = true;
    queueMicrotask(flush);
  }

  return {
    place,
    /** Draw what has been placed. Call it once a batch is done. */
    draw: flush,
    move,
    restand,
    show,
    get placed() {
      return placed;
    },
    dispose(): void {
      alive = false;
      // Before the meshes: an observer left on the scene would step textures
      // that are being disposed underneath it.
      if (clock) scene.onBeforeRenderObservable.remove(clock);
      clock = null;
      flipbooks.length = 0;
      // The placements as well as the templates. A map would take these down
      // with its own root anyway, but the editor's stage outlives the runtime
      // on it — without this, every object you looked at stayed on the pad.
      for (const record of placed) record.node.dispose(false, false);
      // Parented to the map's root, which usually takes them — but the editor's
      // stage outlives a runtime on it, the same reason the nodes above go.
      for (const mesh of instanced) mesh.dispose();
      instanced.length = 0;
      slots.clear();
      off.clear();
      waiting.clear();
      // Materials and textures are shared and are not scene-graph children, so
      // they are tracked rather than reached through the tree.
      for (const thing of owned) thing.dispose();
      owned.length = 0;
      materials.clear();
      placed.length = 0;
    },
  };
}

/** Every prop on the current map, and the meshes drawn for them. */
export type PropRuntime = ReturnType<typeof createPropRuntime>;
