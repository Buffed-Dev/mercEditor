/**
 * Loading a picture, and saying so when it does not arrive.
 *
 * Babylon takes a URL and gives back a `Texture` immediately; whether the file
 * behind it exists is decided later, on the network. A file that is not there
 * leaves the texture blank and the object wearing it grey — which looks exactly
 * like a material somebody has not finished setting up, and reads as one for as
 * long as it takes to think of opening the network tab.
 *
 * The loss is never fatal — a missing picture is a thing drawn without it, and
 * the game carries on — so this warns rather than throws. What it adds is the
 * one thing the console could not tell you: *who asked for it*. `wood.png 404`
 * is a fact about the network; "the material Wood names wood.png, which is not
 * there" is a fact about the game folder, and only the caller knows it.
 */

import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { logger } from '../util/log.ts';

const log = logger('textures');

export type TextureOptions = {
  /** Babylon's `noMipmap`. Default false: mipmaps unless a caller says not. */
  noMipmap?: boolean | undefined;
  /**
   * Babylon's `invertY`. Default false, which is right for anything worn over
   * a glTF's own UVs — see the note at the call site in props.ts.
   */
  invertY?: boolean | undefined;
  samplingMode?: number | undefined;
  /** What named this file — a record id, usually. Reported if it fails. */
  by?: string | undefined;
};

/** A texture that says whose it was when the file behind it does not load. */
export function loadTexture(url: string, scene: Scene, options: TextureOptions = {}): Texture {
  const { noMipmap = false, invertY = false, samplingMode, by } = options;
  return new Texture(url, scene, noMipmap, invertY, samplingMode, null, (why) => {
    log.warn(`could not load ${url}`, { url, ...(by ? { by } : {}), ...(why ? { why } : {}) });
  });
}
