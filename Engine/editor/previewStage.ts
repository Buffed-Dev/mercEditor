import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CAMERA_OFFSET } from '../src/render/isoCamera.ts';
import { skyEnvironment } from '../src/render/environment.ts';
import { DEFAULT_ENV } from '../src/data/mapFormat.ts';

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
 *   loop?: boolean,
 *   onMount?: (scene: unknown) => void,
 *   onUnmount?: () => void,
 * }} options `frustum` is how many world units the view is tall, `onMount`
 *   builds the stage and puts something on it, and `onUnmount` lets go of
 *   whatever that was. `loop` off draws only when `render()` is called, for a
 *   stage whose picture is taken rather than watched.
 */
export function createPreviewStage({
  frustum = 6,
  loop = true,
  onMount,
  onUnmount,
}: {
  frustum?: number;
  loop?: boolean;
  onMount?: (scene: Scene) => void;
  onUnmount?: () => void;
}) {
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let camera: TargetCamera | null = null;
  let watcher: ResizeObserver | null = null;
  let yaw = Math.atan2(CAMERA_OFFSET.x, CAMERA_OFFSET.z);
  let pitch = Math.asin(CAMERA_OFFSET.y / CAMERA_OFFSET.length());

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
  function fit(): void {
    if (!engine || !camera) return;
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
    mount(canvas: HTMLCanvasElement): void {
      if (engine) return;
      // `preserveDrawingBuffer`, or `toDataURL` on a stage that draws once
      // hands back an empty picture: the browser is free to clear the buffer
      // the moment the frame is presented, and does.
      engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: !loop }, true);
      const stage = new Scene(engine);
      scene = stage;
      stage.useRightHandedSystem = true;
      stage.clearColor = new Color4(0.04, 0.05, 0.07, 1);
      stage.skipPointerMovePicking = true;
      // The same thing a map gives its materials to reflect, so a metal tuned
      // here is the metal you get out there. Without it `surface` leaves the
      // environment at zero and every metallic preview is a black shape.
      stage.environmentTexture = skyEnvironment(stage, DEFAULT_ENV.sky, DEFAULT_ENV.soilColor);

      camera = new TargetCamera('previewIso', CAMERA_OFFSET.clone(), stage);
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

      if (loop) engine.runRenderLoop(() => stage.render());
      onMount?.(stage);
    },

    /**
     * Turn the camera around the middle of the stage, by a drag's pixels.
     * Starts from the game's own iso angle.
     */
    orbit(dx: number, dy: number): void {
      if (!camera) return;
      const radius = CAMERA_OFFSET.length();
      yaw -= dx * 0.01;
      pitch = Math.min(1.45, Math.max(0.1, pitch + dy * 0.01));
      camera.position.set(
        radius * Math.cos(pitch) * Math.sin(yaw),
        radius * Math.sin(pitch),
        radius * Math.cos(pitch) * Math.cos(yaw),
      );
      camera.setTarget(Vector3.Zero());
      if (!loop) scene?.render();
    },

    /** Draw one frame, for a stage with no loop of its own. */
    render(): void {
      scene?.render();
    },

    /** Give the device back. A browser has only so many of them. */
    unmount(): void {
      if (!engine) return;
      onUnmount?.();
      watcher?.disconnect();
      watcher = null;
      engine.dispose();
      engine = null;
      scene = null;
      camera = null;
    },
  };
}

/** A small scene of its own, for previewing one thing at a time. */
export type PreviewStage = ReturnType<typeof createPreviewStage>;
