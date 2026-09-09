import { Effect } from '@babylonjs/core/Materials/effect.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CAMERA_OFFSET, SCREEN_RIGHT } from './isoCamera.ts';

/**
 * Fog rolling in off the edges of the map.
 *
 * Babylon's distance fog is nearly useless here: the camera is orthographic, so
 * every pixel is about as far from it as every other and linear fog only ever
 * tinted the whole picture evenly. What the map actually wants is a shoreline —
 * the island clear in the middle, the sea around it solid sky colour, and a
 * band between the two.
 *
 * So this is measured in the world, in tiles, not on the screen: how far in
 * from the edge the fog reaches, and how much of that reach is the soft part.
 * Walk toward a corner and the fog stays where the corner is.
 *
 * The camera never turns, so a pixel is a ray in a known constant direction and
 * where it meets the ground is three lines of algebra rather than a depth
 * buffer. That means the depth used is the *ground* under a pixel: a wall is
 * fogged by the tile its ray lands on, which is a tile or so past its own base.
 * At the scale of a fog band nobody can see it; a real depth pass is the fix if
 * that ever stops being true.
 */

/** Screen right, up and forward in world space — constants, since the camera never turns. */
const FORWARD = CAMERA_OFFSET.clone().normalize().scaleInPlace(-1);
const UP = Vector3.Cross(SCREEN_RIGHT, FORWARD);

Effect.ShadersStore.mercShoreFogPixelShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec3 tint;
uniform vec2 band;     // where the fog thins out and where it is gone, in tiles
uniform vec4 bounds;   // the island: minX, minZ, maxX, maxZ
uniform vec3 eye;      // camera position
uniform vec3 axisA;    // screen right, scaled to the full viewport width
uniform vec3 axisB;    // screen up, scaled to the full viewport height
uniform vec3 fwd;      // where the camera looks

void main(void) {
  // Where this pixel's ray meets the ground. Orthographic, so every ray runs
  // the same direction and only the start point moves.
  vec3 start = eye + axisA * (vUV.x - 0.5) + axisB * (vUV.y - 0.5);
  vec2 ground = start.xz + fwd.xz * (-start.y / fwd.y);

  // How far inside the island that is: negative out at sea, growing inland.
  vec2 inset = min(ground - bounds.xy, bounds.zw - ground);
  float depth = min(inset.x, inset.y);

  float t = 1.0 - smoothstep(band.x, band.y, depth);
  gl_FragColor = vec4(mix(texture2D(textureSampler, vUV).rgb, tint, t), 1.0);
}
`;

let pass = null;

/**
 * Whether the fog draws at all.
 *
 * The pass belongs to the camera and outlives every map, so it is switched
 * rather than removed — and the switch is a band nothing can be behind rather
 * than a branch in the shader, because a uniform is cheaper to change than a
 * pipeline is to rebuild. The VFX workspace turns it off: its stage stands
 * outside whatever shoreline the last map left behind, which would otherwise
 * paint the whole preview sky-coloured.
 */
let enabled = true;

export function setFogEnabled(on) {
  enabled = Boolean(on);
}

/**
 * Point the one fog pass at this map. Created on the first call and kept: it
 * belongs to the camera, which outlives every map.
 *
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {import('../game/world.ts').World} world the island being fogged
 * @param {import('@babylonjs/core/Maths/math.color.js').Color3} tint
 * @param {number} reach how many tiles in from the edge the fog gets, in tiles
 * @param {number} smooth how many of those are the fade rather than solid fog
 */
export function applyFog(scene, world, tint, reach, smooth) {
  if (!pass) {
    const uniforms = ['tint', 'band', 'bounds', 'eye', 'axisA', 'axisB', 'fwd'];
    pass = new PostProcess('shoreFog', 'mercShoreFog', uniforms, null, 1, scene.activeCamera);
  }

  // Tile (tx, ty) covers x from tx to tx + 1 and z from ty to ty + 1, so the
  // island's edges are the grid's own outer lines.
  const { cols, rows } = world;

  pass.onApply = (effect) => {
    const camera = scene.activeCamera;
    const width = camera.orthoRight - camera.orthoLeft;
    const height = camera.orthoTop - camera.orthoBottom;

    effect.setColor3('tint', tint);
    // A zero-wide smoothstep is undefined, and a hard ring of fog is not what
    // anyone reaches for this dial to get.
    if (enabled) effect.setFloat2('band', reach - Math.max(smooth, 0.001), reach);
    // Far behind everything, so `depth` is always past it and nothing fogs.
    else effect.setFloat2('band', -1e7, -1e6);
    effect.setFloat4('bounds', 0, 0, cols, rows);
    effect.setVector3('eye', camera.position);
    effect.setVector3('axisA', SCREEN_RIGHT.scale(width));
    effect.setVector3('axisB', UP.scale(height));
    effect.setVector3('fwd', FORWARD);
  };
}
