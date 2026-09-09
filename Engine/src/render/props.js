import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
// Side-effect only: this is what teaches the loader above to read a .glb.
import '@babylonjs/loaders/glTF/index.js';
import { ASSETS, assetById, assetFrames, assetUrl } from '../data/assets.ts';
import { materialById, normalizeMaterial } from '../data/materials.ts';
import { PROPS, propById } from '../data/props.ts';
import { LEVEL_H } from '../data/dimensions.ts';
import { applyMaterial, colorOf, materialFrom, materialKey, surface } from './materials.ts';
import { keep, keepModel } from './sceneCache.ts';

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

/**
 * @param scene the one scene
 * @param {object[]} [propDefs] the game's objects. Left out, the built game's.
 * @param {object[]} [assetDefs] the game's assets, likewise.
 * @param {string} [game] which game folder to fetch files from. The editor
 *   names one because it is a tool over several; the game itself never does —
 *   its files came through the bundler and carry hashed names.
 */
export function createPropRuntime(scene, propDefs, assetDefs, game = '', materialDefs) {
  const props = propDefs ?? PROPS;
  const assets = assetDefs ?? ASSETS;

  const propOf = propDefs ? (id) => props.find((p) => p.id === id) ?? null : propById;
  const assetOf = assetDefs ? (id) => assets.find((a) => a.id === id) ?? null : assetById;

  /** The named surfaces, normalized so every field is there to read. */
  const materialOf = (id) => {
    const found = materialDefs ? materialDefs.find((one) => one.id === id) : materialById(id);
    return found ? normalizeMaterial(found) : null;
  };

  /** Which object wears which material, worked out once per map. */
  const materials = new Map();
  const owned = [];
  const placed = [];
  /** The sheets that are playing, and one observer stepping all of them. */
  const flipbooks = [];
  let clock = null;
  let alive = true;

  /**
   * Advance every sprite on the map, from one observer rather than a timer
   * each: a hundred torches should be one callback, and a sheet that kept
   * playing while the tab was in the background would come back having burned
   * through however many minutes of frames.
   */
  function startClock() {
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
  function model(asset, use) {
    const url = assetUrl(asset, game);
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
        const holder = new TransformNode(`asset:${asset.id}`, scene);
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
  function materialFor(def) {
    if (materials.has(def.id)) return materials.get(def.id);

    // A named surface wins outright: it carries its own picture, tint, tiling
    // and everything about how the light hits it, so the object's own texture
    // and tint below would be a second answer to the same question.
    const named = def.material ? materialOf(def.material) : null;
    if (named) {
      // Kept per scene like the model, and what the material *says* written on
      // afterwards: the shader is the expensive half and it does not change
      // with a tint, so tuning a material shows on the map without a reload.
      const textureUrl = (id) => {
        const picture = assetOf(id);
        return picture ? assetUrl(picture, game) : '';
      };
      const built = keep(scene, materialKey(named), () => materialFrom(named, scene, textureUrl));
      applyMaterial(named, built, scene, textureUrl);
      materials.set(def.id, built);
      return built;
    }

    const textureAsset = def.texture ? assetOf(def.texture) : null;
    const tinted = (def.tint ?? 0xffffff) !== 0xffffff;
    if (!textureAsset && !tinted) {
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

    const url = textureAsset ? assetUrl(textureAsset, game) : '';
    material.albedoTexture = null;
    if (url) {
      // invertY off, because this is worn over a model's own UVs and those came
      // out of a glTF, which puts v=0 at the *top* of the picture where
      // Babylon's own meshes put it at the bottom. Babylon's glTF loader
      // uploads the textures it builds itself the same way. Left at the default
      // the model samples the mirror image of the island it was unwrapped onto,
      // which on a texture with any blank space in it is blank — a grey box
      // wearing a wood texture and no error anywhere to say why.
      const texture = keep(scene, `texture:${url}`, () => new Texture(url, scene, false, false));
      texture.uScale = textureAsset.uScale ?? 1;
      texture.vScale = textureAsset.vScale ?? 1;
      texture.uOffset = textureAsset.uOffset ?? 0;
      texture.vOffset = textureAsset.vOffset ?? 0;
      material.albedoTexture = texture;
      if (textureAsset.transparent) {
        material.useAlphaFromAlbedoTexture = true;
        material.transparencyMode = 2; // ALPHABLEND
      }
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
  function sheetBody(def, sheet, node) {
    const url = assetUrl(sheet, game);
    if (!url) return null;

    const { columns, rows, first, count } = assetFrames(sheet);

    // One unit tall, and as wide as a cell is — which is not known until the
    // picture has loaded, so it starts square and is corrected below.
    const plane = MeshBuilder.CreatePlane(`prop:${def.id}`, { size: 1 }, scene);
    plane.parent = node;
    plane.position.y = 0.5;
    plane.isPickable = true;
    plane.metadata = node.metadata;
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

    const show = (at) => {
      const frame = first + (((at % count) + count) % count);
      texture.uOffset = (frame % columns) / columns;
      texture.vOffset = 1 - (Math.floor(frame / columns) + 1) / rows;
    };
    show(0);

    return { plane, show, count, fps: Math.max(0.5, sheet.fps ?? 12), loop: sheet.loop !== false };
  }

  /**
   * Stand one object on a tile.
   *
   * Returns straight away with an empty node in the right place: the map is
   * built synchronously and the caller has a list to fill in. The model drops
   * into that node when it arrives.
   */
  function place(entry, index, world, root, shadows) {
    const def = propOf(entry.id);
    if (!def) return null;

    const x = entry.gx + 0.5;
    const z = entry.gy + 0.5;
    const node = new TransformNode(`prop${index}`, scene);
    node.parent = root;
    // The ground it stands on, then the object's own lift, then this
    // placement's — which is what puts a crate on top of a crate rather than
    // inside it.
    node.position.set(x, world.heightAt(x, z) * LEVEL_H + (def.lift ?? 0) + (entry.lift ?? 0), z);
    node.rotation.y = ((def.rotY ?? 0) + (entry.rot ?? 0)) * DEG;
    node.scaling.setAll(def.scale ?? 1);
    // What the editor clicks on. Every mesh under here inherits it by walking
    // up, the same way a torch's parts do.
    node.metadata = { pick: { list: 'props', index } };

    const record = { def, node, entry };
    placed.push(record);

    // A model if it names one, a sprite sheet otherwise. Both is a model: the
    // mesh is the more specific answer, and drawing two bodies in one place is
    // worse than quietly preferring one.
    const asset = def.mesh ? assetOf(def.mesh) : null;
    if (!asset) {
      const sheet = def.sheet ? assetOf(def.sheet) : null;
      if (sheet?.kind === 'sheet') {
        const playing = sheetBody(def, sheet, node);
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

    model(asset, (holder) => {
      // Three ways to be too late: the runtime is gone, this placement was
      // dropped, or the model never loaded at all.
      if (!alive || node.isDisposed() || !holder) return;
      const body = holder.clone(`prop${index}:body`, node);
      if (!body) return;
      body.setEnabled(true);
      // The asset's own correction: which way up the model came out of whatever
      // made it, and how big one unit was there. On the copy rather than on the
      // model, because the model is shared between every map drawn in this
      // scene and the correction is a number the editor changes.
      body.scaling.setAll(asset.scale ?? 1);
      body.rotation.set(
        (asset.rotX ?? 0) * DEG,
        (asset.rotY ?? 0) * DEG,
        (asset.rotZ ?? 0) * DEG,
      );
      body.position.y = asset.lift ?? 0;

      const material = materialFor(def);
      for (const mesh of body.getChildMeshes()) {
        if (material) mesh.material = material;
        mesh.receiveShadows = true;
        mesh.metadata = { pick: { list: 'props', index } };
        if (def.shadow !== false) shadows?.add(mesh);
      }
      record.body = body;
    });

    return record;
  }

  return {
    place,
    get placed() {
      return placed;
    },
    dispose() {
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
      // Materials and textures are shared and are not scene-graph children, so
      // they are tracked rather than reached through the tree.
      for (const thing of owned) thing.dispose();
      owned.length = 0;
      materials.clear();
      placed.length = 0;
    },
  };
}
