import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture.js';
import { keep } from './sceneCache.ts';
import type { Scene } from '@babylonjs/core/scene.js';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';

/**
 * Something for a metal to reflect.
 *
 * A physically-based material is mostly a description of what a surface does to
 * the light *around* it, and around it there was nothing: no environment
 * texture, so `environmentIntensity` was pinned at zero and every metal in the
 * game came out near-black. The roughness and metallic dials were knobs that
 * visibly did nothing, which is worse than not having them.
 *
 * Built rather than shipped. The usual answer is a baked .env cube, which is a
 * megabyte of somebody else's afternoon light — and this game has its own
 * weather already: a map says what colour its sky is and what colour its soil
 * is, and those two are the whole of what a surface outdoors can see. So the
 * environment is six small gradients drawn from the map's own colours, which
 * costs nothing to ship, changes when the map's weather does, and cannot be
 * out of key with the scene the way a stock HDR would be.
 *
 * Small on purpose. This is a wash of colour rather than a scene: at sixteen
 * pixels a face there is nothing to see in a reflection but the sky above the
 * horizon and the ground below it, which is exactly what is wanted, and it is
 * what makes computing the irradiance from it cheap.
 */

const FACE = 16;

/** `0x9fd4ef` -> `#9fd4ef`, which is what a canvas wants. */
const css = (hex: number): string => `#${(hex >>> 0).toString(16).padStart(6, '0')}`;

/**
 * One face as a data URL.
 *
 * `up` is how much of the face is sky: all of it for the top, none for the
 * bottom, and a horizon across the middle for the four sides.
 */
function face(sky: number, ground: number, kind: 'up' | 'down' | 'side'): string {
  const canvas = document.createElement('canvas');
  canvas.width = FACE;
  canvas.height = FACE;
  const context = canvas.getContext('2d');
  if (!context) return '';

  if (kind !== 'side') {
    context.fillStyle = css(kind === 'up' ? sky : ground);
    context.fillRect(0, 0, FACE, FACE);
    return canvas.toDataURL();
  }

  // A soft horizon rather than a hard line: a hard one shows up in a rough
  // reflection as a band, which reads as a seam in the surface.
  const gradient = context.createLinearGradient(0, 0, 0, FACE);
  gradient.addColorStop(0, css(sky));
  gradient.addColorStop(0.42, css(sky));
  gradient.addColorStop(0.58, css(ground));
  gradient.addColorStop(1, css(ground));
  context.fillStyle = gradient;
  context.fillRect(0, 0, FACE, FACE);
  return canvas.toDataURL();
}

/**
 * The environment for a scene, kept per scene and per pair of colours.
 *
 * @param scene the scene it belongs to
 * @param sky what the sky is, as a map writes it
 * @param ground what the ground is
 */
export function skyEnvironment(scene: Scene, sky: number, ground: number): BaseTexture | null {
  // No document is no canvas: a test run has neither, and a scene without an
  // environment is what the game had until now rather than a failure.
  if (typeof document === 'undefined') return null;

  return keep(scene, `environment:${sky}:${ground}`, () => {
    const side = face(sky, ground, 'side');
    // Babylon's order: +X, +Y, +Z, -X, -Y, -Z. Up is sky, down is ground, and
    // the four around the outside carry the horizon.
    const texture = CubeTexture.CreateFromImages(
      [side, face(sky, ground, 'up'), side, side, face(sky, ground, 'down'), side],
      scene,
    );
    // Drawn on a canvas, so the numbers in it are sRGB rather than linear.
    texture.gammaSpace = true;
    return texture;
  });
}
