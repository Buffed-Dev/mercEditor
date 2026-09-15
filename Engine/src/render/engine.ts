import { Engine } from '@babylonjs/core/Engines/engine.js';
// Babylon's modular build declares dynamic-texture methods in the engine type,
// but installs their runtime implementation through this side-effect module.
// The fullscreen GUI is a DynamicTexture and is created before trails or VFX
// get a chance to register it themselves, so Play must install it up front.
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js';
import { CAMERA_OFFSET, DEFAULT_FRUSTUM } from './isoCamera.ts';

/**
 * Babylon's Engine, the one Scene, the isometric camera and the render loop.
 *
 * There is exactly one Scene for the whole application. A level is a subtree of
 * that scene under its own root node, built when the map loads and disposed
 * when it unloads; the map editor mounts its own root the same way. That is
 * what a "level" means here — not a Babylon Scene of its own.
 *
 * Keeping one Scene is what lets the camera, the shadow configuration and the
 * post-processing pipeline be built once and never rebuilt: nothing has to be
 * re-pointed at a different scene when the map changes.
 *
 * Nothing in here knows what a level, a player or an item is. It owns the
 * device and the viewpoint, and hands both to whatever wants to draw.
 */

/**
 * Screen-space ambient occlusion: how enclosed a point is, which no shadow map
 * can answer. It is what makes a wall meet the floor with a seam and stops a
 * character in flat ambient light appearing to hover.
 *
 * `radius` is in world units and one tile is one unit, so this is "darkening
 * reaches about two thirds of a tile from a corner".
 *
 * How *strong* the darkening is is not here: it is a map's own business — an
 * open field wants less of it than a corridor — so it arrives with the level.
 */
const AO = {
  radius: 0.65,
  base: 0.1,
  samples: 16,
  expensiveBlur: true,
  bilateralSamples: 12,
  /** Multisampling, which a plain post-process chain would otherwise throw away. */
  textureSamples: 4,
};

/**
 * @param {HTMLElement} host the element the canvas fills. The map editor docks
 *   it between its panels, so this is not always the window.
 */
export function createRenderer(host: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  host.appendChild(canvas);

  const engine = new Engine(canvas, true, { stencil: false }, true);

  const scene = new Scene(engine);
  // Right-handed, matching the coordinate convention the gameplay code already
  // uses: gx maps to x, gy maps to z, y is up, and a heading is atan2(dx, dz).
  // Babylon supports both; picking the one the simulation already speaks means
  // no axis is flipped anywhere between the grid and the screen.
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0, 0, 0, 1);
  // Nothing in this game needs a pointer-move pick every frame; the two places
  // that pick do it explicitly. Off, this is a per-frame ray saved.
  scene.skipPointerMovePicking = true;
  scene.skipPointerDownPicking = true;
  scene.skipPointerUpPicking = true;

  // The camera never turns: it sits at a fixed offset from whatever it looks
  // at, which is what makes the projection isometric and billboarding a
  // constant rather than a per-frame recomputation.
  const target = new Vector3(0, 0, 0);
  const camera = new TargetCamera('iso', CAMERA_OFFSET.clone(), scene);
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = 0.1;
  camera.maxZ = 200;
  camera.setTarget(target);

  let frustum = DEFAULT_FRUSTUM;

  function resize() {
    engine.resize();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    camera.orthoLeft = (-frustum * aspect) / 2;
    camera.orthoRight = (frustum * aspect) / 2;
    camera.orthoTop = frustum / 2;
    camera.orthoBottom = -frustum / 2;
  }

  window.addEventListener('resize', resize);
  // The editor docks the canvas into a hole whose size changes when a panel
  // folds away, which the window never hears about — so watch the host itself.
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const ao = new SSAO2RenderingPipeline('ao', scene, { ssaoRatio: 1, blurRatio: 1 }, [camera]);
  // Assigned field by field rather than through `Object.assign`, which will
  // happily carry a misspelled setting into a pipeline that ignores it.
  ao.radius = AO.radius;
  ao.base = AO.base;
  ao.samples = AO.samples;
  ao.expensiveBlur = AO.expensiveBlur;
  ao.bilateralSamples = AO.bilateralSamples;
  ao.textureSamples = AO.textureSamples;

  return {
    engine,
    scene,
    camera,
    canvas,

    /** How many world units are visible vertically. The editor drives the zoom. */
    setFrustum(next: number): void {
      frustum = next;
      resize();
    },

    /**
     * Settles when everything currently in the scene can actually be drawn.
     *
     * A material is not drawn at all until its shader has compiled, so a map
     * shown the instant it is built comes up in pieces — the parts using a
     * shader something else already compiled first, the rest a moment later.
     * Waiting behind the transition's black screen is what makes a map arrive
     * whole.
     */
    whenReady(): Promise<void> {
      // Render targets included: the shadow maps have shaders of their own, and
      // a map whose casters are still compiling comes up without its shadows.
      return scene.whenReadyAsync(true);
    },

    /**
     * How much of the scene is drawable, 0..1.
     *
     * The same question `whenReady` asks, counted instead of awaited: a mesh is
     * ready when its material and shaders are, so the fraction of them that are
     * is honest progress rather than a bar on a timer. Asking is also what
     * *starts* a compile, so polling this brings the wait forward instead of
     * only watching it.
     */
    progress(): number {
      const meshes = scene.meshes;
      if (!meshes.length) return 1;
      let ready = 0;
      for (const mesh of meshes) if (mesh.isReady(true)) ready++;
      return ready / meshes.length;
    },

    /**
     * How hard contact darkening reads, from the map being drawn.
     *
     * The pipeline belongs to the renderer rather than to any one map — it is
     * built once and outlives every level — so a map cannot set this the way it
     * sets its own sky. Whoever loads the map passes it on.
     */
    setAmbientOcclusion(strength: number | undefined): void {
      ao.totalStrength = Math.max(0, strength ?? 0);
    },

    /** Move the viewpoint, keeping the isometric offset. */
    lookAt(x: number, y: number, z: number): void {
      target.set(x, y, z);
      camera.position.copyFrom(target).addInPlace(CAMERA_OFFSET);
      camera.setTarget(target);
    },

    /**
     * Start the loop. Babylon owns it, so there is one animation frame in the
     * whole application and one source of delta time.
     *
     * `step` is called before the scene draws and is given seconds, clamped so
     * a stalled tab cannot tunnel the player through a wall on its first frame
     * back. A throw is reported and the loop carries on: an exception used to
     * end the game outright, leaving the window frozen on its last picture with
     * nothing on screen to say why.
     */
    run(
      // `void` as well as boolean: only a step that means to skip the frame
      // says so, and the rest return nothing.
      step: (dt: number) => boolean | void,
      // `unknown` because this only forwards it. Under `strict` a caught value
      // is unknown, and pretending otherwise here would be a guess.
      onError?: (error: unknown) => void,
    ): void {
      let last = performance.now();
      engine.runRenderLoop(() => {
        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        try {
          if (step(dt) !== false) scene.render();
        } catch (error) {
          onError?.(error);
        }
      });
    },

    /**
     * Give back the canvas, the loop and the GPU resources behind them.
     *
     * The game never needs this — it owns the page for as long as it is open.
     * The editor mounts the viewport as one component among others and can take
     * it away again, and a renderer left running after that would keep drawing
     * into a canvas nobody can see, holding a WebGL context the browser only
     * grants a handful of.
     */
    dispose(): void {
      engine.stopRenderLoop();
      observer.disconnect();
      window.removeEventListener('resize', resize);
      ao.dispose();
      scene.dispose();
      engine.dispose();
      canvas.remove();
    },
  };
}

/** A canvas, a scene, and the loop that draws it. */
export type Renderer = ReturnType<typeof createRenderer>;
