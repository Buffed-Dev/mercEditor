/**
 * The area an ability is about to test, drawn while it winds up.
 *
 * The melee cone is the case worth seeing: `coneHits` decides who was struck
 * from a range and an arc that live in data, and until you can see that wedge
 * on the floor, a swing that misses is indistinguishable from a swing that hit
 * for zero.
 *
 * It reads as a countdown rather than a report. A translucent red area appears
 * the moment the cast starts and thickens as the wind-up runs out, so the shape
 * says *how long you have* to be somewhere else; landing it flashes the area
 * white, which then fades away.
 *
 * Nothing here draws anything any more. A telegraph is a handful of numbers
 * handed to decals.js, and the ground paints itself — which is why this file no
 * longer has an opinion about ramps, ledges, tessellation or ambient occlusion.
 * It owns the timing; the shape and where it lands are the terrain's business.
 */

/**
 * Opacity across a wind-up: where the ramp starts, and where it ends.
 *
 * The floor is not zero. Alpha is close to linear in coverage, so the bottom of
 * the range is perceptually dead — a red at 0.05 over a lit floor is nothing at
 * all. Starting the ramp at a value you can actually see, and getting there
 * over FADE_IN rather than instantly, is what makes the appearance read as a
 * fade rather than a shape that was suddenly there.
 */
import type { Decal, Decals } from './decals.ts';

/** A colour a shape is mixed between. */
type Rgb = { r: number; g: number; b: number };

/** The two things these views ask of the decal registry. */
export type DecalSink = Pick<Decals, 'add' | 'remove'>;

/** Where a telegraph is in its life. */
type Phase = 'charging' | 'fading';

type Shape = { decal: Decal; phase: Phase; age: number; duration: number };

/** What a caller holds onto so it can move, fire or drop its telegraph. */
export type Telegraph = {
  place: (gx: number, gy: number, aim: number) => void;
  fire: () => void;
  cancel: () => void;
  done: boolean;
};

const CHARGE_FROM = 0;
const CHARGE_TO = 0.5;

/** How long the shape takes to come up from nothing to CHARGE_FROM. */
const FADE_IN = 0.14;

/** The border sits above the fill, until both are solid. */
const EDGE_RATIO = 1.5;

/** How long the area takes to disappear once the ability has landed. */
const FADE = 0.5;
/** And how much of that it spends going from white back to red. */
const WHITE_HOLD = 0.12;

// Plain floats: a decal's colour goes straight into a uniform array, and the
// fade below is a lerp between these two by hand. Nothing here needs a colour
// class, and the registry deliberately does not hand out one.
const AREA_COLOR: Rgb = { r: 0.788, g: 0.071, b: 0.071 }; // #c91212
const FLASH_COLOR: Rgb = { r: 1, g: 1, b: 1 };

/** Write `a` blended `t` of the way toward `b` into `target`, in place. */
function mixInto(target: Rgb, a: Rgb, b: Rgb, t: number): void {
  target.r = a.r + (b.r - a.r) * t;
  target.g = a.g + (b.g - a.g) * t;
  target.b = a.b + (b.b - a.b) * t;
}

/**
 * How thick the border is, in tiles.
 *
 * A real width now, measured on the ground and evaluated per pixel, rather than
 * a ribbon of triangles standing in for a line that WebGL would have drawn one
 * pixel wide whatever it was asked for. It looks the same at any range and any
 * zoom, and it costs nothing to change.
 */
const EDGE_WIDTH = 0.09;

/**
 * @param {ReturnType<import('./decals.ts').createDecals>} decals the registry
 *   the terrain materials read from. Telegraphs are written into it and drawn
 *   by the ground; nothing is added to the scene.
 */
export function createDebugViews(decals: DecalSink) {
  const shapes: Shape[] = [];
  let enabled = true;

  /** The border is always the stronger of the two, until both are solid. */
  function setOpacity(shape: Shape, value: number): void {
    shape.decal.alpha = value;
    shape.decal.edgeAlpha = Math.min(1, value * EDGE_RATIO);
  }

  function drop(shape: Shape): void {
    decals.remove(shape.decal);
    const at = shapes.indexOf(shape);
    if (at >= 0) shapes.splice(at, 1);
  }

  return {
    get enabled() {
      return enabled;
    },

    /** How many shapes are on screen. */
    get count() {
      return shapes.length;
    },

    setEnabled(on: boolean): void {
      enabled = on;
      if (!on) {
        for (const shape of shapes) decals.remove(shape.decal);
        shapes.length = 0;
      }
    },

    /**
     * Show the area an ability is winding up to test.
     *
     * `castTime` is how long the charge has to run; zero means there is no
     * wind-up, so the shape starts solid and the caller fires it immediately.
     *
     * @returns a handle, or null when debug shapes are off
     */
    telegraph({
      gx,
      gy,
      aim,
      range,
      arc,
      castTime = 0,
    }: {
      gx: number;
      gy: number;
      aim: number;
      range: number;
      arc?: number;
      castTime?: number;
    }): Telegraph | null {
      if (!enabled) return null;

      const decal = decals.add({
        gx,
        gy,
        aim,
        range,
        // The hit test works in half-arcs and so does the shader; degrees are
        // the authoring unit, converted once, here.
        halfArc: ((arc ?? 360) * Math.PI) / 360,
        edge: EDGE_WIDTH,
      });
      Object.assign(decal.color, AREA_COLOR);

      const shape: Shape = { decal, phase: 'charging', age: 0, duration: castTime };
      // Starts at nothing when there is a wind-up to fade in across, and solid
      // when there is not — an instant ability is fired in the same frame.
      setOpacity(shape, castTime > 0 ? 0 : CHARGE_TO);
      shapes.push(shape);

      const handle: Telegraph = {
        /**
         * Follow the caster. A wind-up does not pin an actor in place, and the
         * hit test runs from wherever it ends up — so a telegraph left behind
         * at the starting position would be showing the wrong wedge.
         */
        place(nextGx: number, nextGy: number, nextAim: number): void {
          if (handle.done) return;
          decal.gx = nextGx;
          decal.gy = nextGy;
          decal.aim = nextAim;
        },

        /** The wind-up finished and the ability landed. */
        fire(): void {
          if (handle.done) return;
          shape.phase = 'fading';
          shape.age = 0;
          setOpacity(shape, 1);
          // White now, not on the next frame: a flash that waits for the next
          // update is a flash that can be missed entirely on a slow one.
          Object.assign(decal.color, FLASH_COLOR);
          handle.done = true;
        },

        /** The wind-up was dropped. Nothing happened, so nothing is shown. */
        cancel(): void {
          if (handle.done) return;
          drop(shape);
          handle.done = true;
        },

        done: false,
      };

      return handle;
    },

    update(dt: number): void {
      for (let i = shapes.length - 1; i >= 0; i--) {
        const shape = shapes[i]!;
        shape.age += dt;

        if (shape.phase === 'charging') {
          // Ramps to solid across the wind-up, then holds there: a cast that
          // runs long should look ready, not keep getting louder.
          const t = shape.duration > 0 ? Math.min(1, shape.age / shape.duration) : 1;
          const ramp = CHARGE_FROM + (CHARGE_TO - CHARGE_FROM) * t;
          // Multiplied by the arrival, so the shape comes up from nothing
          // instead of switching on at the bottom of the ramp.
          const arrived = Math.min(1, shape.age / FADE_IN);
          setOpacity(shape, ramp * arrived);
          continue;
        }

        if (shape.age >= FADE) {
          drop(shape);
          continue;
        }

        // White at the moment it lands, easing back to red well before it has
        // faded — a shape that stayed white for the whole half second would
        // read as a lingering glow rather than a hit.
        const left = 1 - shape.age / FADE;
        setOpacity(shape, left);

        const white = Math.max(0, 1 - shape.age / WHITE_HOLD);
        mixInto(shape.decal.color, AREA_COLOR, FLASH_COLOR, white);
      }
    },

    dispose(): void {
      for (const shape of shapes) decals.remove(shape.decal);
      shapes.length = 0;
    },
  };
}

/** The telegraphs currently on screen. */
export type DebugViews = ReturnType<typeof createDebugViews>;
