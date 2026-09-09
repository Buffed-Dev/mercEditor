import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { unlit } from '../../src/render/materials.js';
import { createPropRuntime } from '../../src/render/props.js';
import { createTerrainLayer } from '../../src/render/terrainLayer.ts';
import { createGrid, idx } from '../../src/data/terrain/grid.ts';
import { DEFAULT_ENV } from '../../src/data/mapFormat.js';
import { LEVEL_H } from '../../src/render/dimensions.js';
import { assetFrames, normalizeAsset } from '../../src/data/assets.js';
import { normalizeProp } from '../../src/data/props.js';
import { normalizeTerrain } from '../../src/data/terrains.ts';

/**
 * The files a game brings with it, and the things built out of them.
 *
 * Each kind is drawn by the path that draws it for real: an object through the
 * game's own prop runtime, a block through the map's block layer. An asset has
 * no such path of its own, so it is drawn as the smallest thing that would show
 * it — a mesh becomes a nameless prop wearing nothing, a picture a plane.
 *
 * Lifted out of the old assets mode unchanged. Drawing these the game's way
 * rather than the tool's is the whole point: an object is placed by the origin
 * it was exported with, a block is measured and centred on its own bounds, and
 * a preview that split the difference disagreed with the map about the one
 * thing it was opened to check.
 */
export function createAssetPreview() {
  let scene = null;
  let stage = null;
  let lamps = [];
  let runtime = null;
  let blockView = null;
  let showing = null;
  /** Steps a sprite sheet through its frames. */
  let ticker = 0;

  /** Everything the last preview made. Materials included, hence the sweep. */
  function clear() {
    if (ticker) {
      clearInterval(ticker);
      ticker = 0;
    }
    runtime?.dispose();
    runtime = null;
    blockView?.dispose();
    blockView = null;
    showing?.dispose(false, true);
    showing = null;
  }

  return {
    frustum: 5,

    get scene() {
      return scene;
    },

    mount(made) {
      scene = made;
      stage = new TransformNode('assetStage', scene);
      stage.position.copyFrom(new Vector3(0, 0, 0));

      // A pad to stand things on, so a model's feet have somewhere to be. The
      // ring is the tile: one unit across, which is the only scale reference a
      // model has here and the number every object is judged against.
      const pad = MeshBuilder.CreateDisc('assetPad', { radius: 2.4, tessellation: 48 }, scene);
      pad.material = unlit('assetPad', scene, { color: 0x161c28 });
      pad.rotation.x = Math.PI / 2;
      pad.position.y = 0.002;
      pad.isPickable = false;
      pad.parent = stage;

      const tile = MeshBuilder.CreateTorus(
        'assetTile',
        { diameter: 1, thickness: 0.014, tessellation: 64 },
        scene,
      );
      tile.material = unlit('assetTile', scene, { color: 0x3b4a63 });
      tile.position.y = 0.004;
      tile.isPickable = false;
      tile.parent = stage;

      // A model brings real materials with it, so with no light in the scene a
      // crate is a black crate. Two: a fill so nothing is unreadable, and a key
      // so its faces differ.
      const fill = new HemisphericLight('assetFill', new Vector3(0.2, 1, 0.1), scene);
      fill.intensity = 0.75;
      fill.groundColor = new Color3(0.18, 0.2, 0.26);
      const key = new DirectionalLight('assetKey', new Vector3(-0.6, -1, 0.55), scene);
      key.intensity = 1.5;
      lamps = [fill, key];
    },

    unmount() {
      clear();
      for (const lamp of lamps) lamp.dispose();
      lamps = [];
      stage?.dispose(false, true);
      stage = null;
      scene = null;
    },

    /**
     * Put a record on the stage.
     *
     * @param record the record itself
     * @param {{kind?: string, assets?: unknown[], materials?: unknown[], game?: string}} context
     *   `kind` is which list it came from — 'assets', 'props' or 'terrains' —
     *   and the rest is what the game's own draw paths need to build it.
     */
    draw(record, context = {}) {
      if (!scene || !stage) return;
      clear();
      if (!record) return;

      const { kind = 'assets', assets = [], materials = [], game = '' } = context;
      const urlOf = (entry) => (entry?.file ? `/Games/${game}/assets/${entry.file}` : '');

      if (kind === 'props') return showProp(normalizeProp(record));
      if (kind === 'terrains') return showBlock(normalizeTerrain(record));

      const asset = normalizeAsset(record);
      if (asset.kind === 'mesh') {
        return showProp({ ...normalizeProp({ id: '__preview' }), mesh: asset.id });
      }
      return showPicture(asset);

      /**
       * The game's own path: the same runtime, the same definitions, standing
       * on a floor of the same height the flat part of a map has.
       */
      function showProp(def) {
        const ground = { heightAt: () => 0 };
        runtime = createPropRuntime(scene, [def], assets, game, materials);
        runtime.place({ gx: -0.5, gy: -0.5, id: def.id }, 0, ground, stage, null);
      }

      /**
       * A block on a three-by-three plateau — the smallest arrangement that
       * wears all three lids at once: a middle away from the camera, a side
       * down each visible edge, and the corner where they meet. So the preview
       * answers "do my pieces line up" rather than only "what is this mesh".
       */
      function showBlock(terrain) {
        const grid = createGrid(3, 3);
        for (let gy = 0; gy < 3; gy += 1) {
          for (let gx = 0; gx < 3; gx += 1) grid.kind[idx(grid, gx, gy)] = 1;
        }

        const world = { terrain: grid, terrainIds: [terrain.id], map: {} };
        blockView = createTerrainLayer(scene, world, DEFAULT_ENV, {
          terrains: [terrain],
          assets,
          materials,
          game,
        });
        blockView.root.parent = stage;
        // A cell's top face is at zero and the cliff hangs below — which is what
        // makes a map's surface the plane you walk on — so left where it lands
        // the plateau would be inside the pad.
        blockView.root.position.set(-1.5, LEVEL_H, -1.5);
      }

      /** A texture or a sheet, on a plane standing up out of the pad. */
      function showPicture(entry) {
        const url = urlOf(entry);
        if (!url) return;

        const plane = MeshBuilder.CreatePlane('assetPicture', { size: 2 }, scene);
        plane.position.y = 1.05;
        plane.isPickable = false;
        plane.parent = stage;

        // Black, because an unlit material *adds* its emissive colour to its
        // emissive texture rather than multiplying — white here is a white
        // plane with the picture nowhere to be seen.
        const material = unlit('assetPicture', scene, { color: 0x000000 });
        const texture = new Texture(url, scene);
        material.emissiveTexture = texture;
        material.opacityTexture = entry.transparent || entry.kind === 'sheet' ? texture : null;
        material.backFaceCulling = false;
        plane.material = material;
        showing = plane;

        if (entry.kind !== 'sheet') {
          texture.uScale = entry.uScale ?? 1;
          texture.vScale = entry.vScale ?? 1;
          texture.uOffset = entry.uOffset ?? 0;
          texture.vOffset = entry.vOffset ?? 0;
          return;
        }

        // One cell of the grid, stepped in order. `invertY` is Babylon's default
        // and the row maths below assumes it: v counts up from the bottom, so
        // the top row is the last one, not the first.
        const { columns, rows, first, count } = assetFrames(entry);
        texture.uScale = 1 / columns;
        texture.vScale = 1 / rows;

        let frame = 0;
        const show = () => {
          const cell = first + (frame % count);
          texture.uOffset = (cell % columns) / columns;
          texture.vOffset = 1 - (Math.floor(cell / columns) + 1) / rows;
          frame += 1;
          if (!entry.loop && frame >= count) {
            clearInterval(ticker);
            ticker = 0;
          }
        };
        show();
        ticker = setInterval(show, 1000 / Math.max(0.5, entry.fps ?? 12));
      }
    },
  };
}
