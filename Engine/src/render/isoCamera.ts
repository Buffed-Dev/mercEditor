import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector.js';

/**
 * The isometric viewpoint, in one place.
 *
 * The game and the map editor look down the same (1, 1, 1) diagonal, and
 * anything that has to face the camera needs it too.
 */

/** How far, and from which direction, the camera sits from what it watches. */
export const CAMERA_OFFSET = new Vector3(10, 10, 10);

/** World units visible vertically in play. The editor zooms; the game does not. */
export const DEFAULT_FRUSTUM = 8;

/**
 * Orientation for a flat thing that should face the viewer.
 *
 * The camera moves but never turns, so this is a constant. If the camera ever
 * gains rotation this becomes a lie and anything using it will skew.
 */
export const BILLBOARD = Quaternion.FromRotationMatrix(
  Matrix.LookAtRH(CAMERA_OFFSET, Vector3.Zero(), Vector3.Up()).invert(),
);

/**
 * Ground-plane directions matching the camera, so "up-screen" is one vector
 * rather than a pair of magic numbers in the input code.
 */
export const SCREEN_FORWARD = new Vector3(-1, 0, -1).normalize();
export const SCREEN_RIGHT = new Vector3(1, 0, -1).normalize();
