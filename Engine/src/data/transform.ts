import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/**
 * A placed thing's transform: where it stands, which way it turns, how big.
 *
 * Only terrain is tiles. Everything standing on it has a free position — `gx`
 * and `gy` are still the names, but a value of 2.37 is fine, and the game
 * floors them wherever it needs a tile — a height above the ground in `lift`,
 * a rotation about each axis, and a scale along each. All in the same terms a
 * scene node uses, so the renderer writes them straight in.
 *
 * `rot` is the turn about Y and keeps the name it always had; the other two
 * axes are `rotX` and `rotZ`. The default for every one of these is what a
 * file that never wrote it meant: no offset, no turn, scale of one.
 */
export type Transform = {
  gx: number;
  gy: number;
  lift?: number;
  rotX?: number;
  rot?: number;
  rotZ?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
};

const DEG = Math.PI / 180;

/** An angle in degrees, brought back into 0–359. */
export const wrapDeg = (deg: number): number => ((deg % 360) + 360) % 360;

/** Noise from trigonometry, cleared: a quarter turn lands on a whole tile. */
// `+ 0` turns a -0 back into 0, which deepEqual tells apart.
const tidy = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;

/** The Euler angles of a transform, as the scene node reads them. */
export const eulerOf = (t: Partial<Transform>): Vector3 =>
  new Vector3((t.rotX ?? 0) * DEG, (t.rot ?? 0) * DEG, (t.rotZ ?? 0) * DEG);

/** The scale of a transform, one along each axis. */
export const scaleOf = (t: Partial<Transform>): Vector3 =>
  new Vector3(t.scaleX ?? 1, t.scaleY ?? 1, t.scaleZ ?? 1);

/**
 * A child's transform, placed inside a parent's.
 *
 * What a prefab does to each of its children and what a quarter turn does to
 * what is in a chunk are the same operation: the child's own position is
 * scaled and turned by the parent, then moved by it, and the child's own turn
 * is composed with the parent's. Composed as quaternions rather than by adding
 * angles, because two turns about different axes do not add.
 *
 * Positions are centres: a thing at tile (gx, gy) stands at (gx + ½, gy + ½),
 * and that is the point the parent turns about its own origin.
 */
export function compose(parent: Partial<Transform>, child: Transform): Transform {
  const scale = scaleOf(parent);
  const turn = Quaternion.FromEulerVector(eulerOf(parent));
  const at = new Vector3((child.gx + 0.5) * scale.x, (child.lift ?? 0) * scale.y, (child.gy + 0.5) * scale.z);
  at.rotateByQuaternionToRef(turn, at);

  const out: Transform = {
    ...child,
    gx: tidy(at.x - 0.5 + (parent.gx ?? 0)),
    gy: tidy(at.z - 0.5 + (parent.gy ?? 0)),
  };
  const lift = tidy(at.y + (parent.lift ?? 0));
  if (lift || child.lift !== undefined) out.lift = lift;

  // Turned only if either side turns, so a thing that never wrote a rotation
  // does not come out carrying three zeros.
  if (parent.rotX || parent.rot || parent.rotZ || child.rotX || child.rot || child.rotZ) {
    const euler = turn.multiply(Quaternion.FromEulerVector(eulerOf(child))).toEulerAngles();
    out.rot = wrapDeg(tidy(euler.y / DEG));
    const rotX = wrapDeg(tidy(euler.x / DEG));
    const rotZ = wrapDeg(tidy(euler.z / DEG));
    if (rotX || child.rotX !== undefined) out.rotX = rotX;
    if (rotZ || child.rotZ !== undefined) out.rotZ = rotZ;
  }

  if (scale.x !== 1 || child.scaleX !== undefined) out.scaleX = tidy(scale.x * (child.scaleX ?? 1));
  if (scale.y !== 1 || child.scaleY !== undefined) out.scaleY = tidy(scale.y * (child.scaleY ?? 1));
  if (scale.z !== 1 || child.scaleZ !== undefined) out.scaleZ = tidy(scale.z * (child.scaleZ ?? 1));
  return out;
}

/**
 * The box a `w` × `h` footprint covers once it is turned and scaled about its
 * middle: where its corners land, as a rectangle around them, relative to
 * where the untouched box's corner was.
 */
export function boundsOf(
  parent: Partial<Transform>,
  w: number,
  h: number,
): { minX: number; minY: number; w: number; h: number } {
  const scale = scaleOf(parent);
  const turn = Quaternion.FromEulerVector(eulerOf(parent));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, z] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const at = new Vector3((x - w / 2) * scale.x, 0, (z - h / 2) * scale.z);
    at.rotateByQuaternionToRef(turn, at);
    minX = Math.min(minX, at.x + w / 2);
    maxX = Math.max(maxX, at.x + w / 2);
    minY = Math.min(minY, at.z + h / 2);
    maxY = Math.max(maxY, at.z + h / 2);
  }
  return { minX: tidy(minX), minY: tidy(minY), w: tidy(maxX - minX), h: tidy(maxY - minY) };
}
