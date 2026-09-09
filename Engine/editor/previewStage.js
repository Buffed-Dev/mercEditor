import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CAMERA_OFFSET } from '../src/render/isoCamera.js';

/**
 * A canvas of one's own, for the previews that open over the map.
 *
 * A second engine rather than a corner of the map's. The previews used to
 * borrow the one scene, which meant hiding the map to look at a crate and
 * pointing the camera back afterwards — a whole dance to answer "what does this
 * look like". Two canvases is a graphics device the browser was always willing
 * to give, and the map carries on drawing behind the modal.
 *
 * The same conventions the game's scene is built with, so a model that stands
 * up correctly here stands up correctly on a map: right-handed, orthographic,
 * looking down the same fixed diagonal.
 *
 * One options object, not three arguments:
 *
 * @param {{
 *   frustum?: number,
 *   onMount?: (scene: unknown) => void,
 *   onUnmount?: () => void,
 * }} options `frustum` is how many world units the view is tall, `onMount`
 *   builds the stage and puts something on it, and `onUnmount` lets go of
 *   whatever that was.
 */
export function createPreviewStage({ frustum = 6, onMount, onUnmount }) {
  let engine = null;
  let scene = null;
  let camera = null;
  let watcher = null;

  /**
   * Square the ortho box to the canvas, so nothing is stretched — and fit
   * `frustum` units across the *narrow* side, so nothing is cropped either.
   *
   * Sizing by height alone was fine while every preview lived in a modal that
   * was wider than it was tall. Docked into a panel it is the other way round,
   * and a three-by-three plateau ran off both sides of the view it was opened
   * to be judged in. Taking the smaller dimension means `frustum` is what you
   * are promised to see, whichever shape the panel is.
   */
  function fit() {
    if (!engine) return;
    engine.resize();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const width = aspect >= 1 ? frustum * aspect : frustum;
    const height = aspect >= 1 ? frustum : frustum / aspect;
    camera.orthoLeft = -width / 2;
    camera.orthoRight = width / 2;
    camera.orthoTop = height / 2;
    camera.orthoBottom = -height / 2;
  }

  return {
    mount(canvas) {
      if (engine) return;
      engine = new Engine(canvas, true, { stencil: false }, true);
      scene = new Scene(engine);
      scene.useRightHandedSystem = true;
      scene.clearColor = new Color4(0.04, 0.05, 0.07, 1);
      scene.skipPointerMovePicking = true;

      camera = new TargetCamera('previewIso', CAMERA_OFFSET.clone(), scene);
      camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
      camera.minZ = 0.1;
      camera.maxZ = 200;
      camera.setTarget(Vector3.Zero());
      fit();

      // The modal is a fraction of the window, so its canvas changes size with
      // the window and with nothing else — which is exactly what an observer on
      // it says, and what a window listener would only approximate.
      watcher = new ResizeObserver(fit);
      watcher.observe(canvas);

      engine.runRenderLoop(() => scene.render());
      onMount?.(scene);
    },

    /** Give the device back. A browser has only so many of them. */
    unmount() {
      if (!engine) return;
      onUnmount?.();
      watcher.disconnect();
      watcher = null;
      engine.dispose();
      engine = null;
      scene = null;
      camera = null;
    },
  };
}
