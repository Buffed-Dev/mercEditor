/**
 * The expensive things a map is drawn with, built once per scene and kept
 * across the maps that use them.
 *
 * A map is torn down and built again on every edit — every brush stroke in the
 * editor is a whole new view — and that is what made the map blink. Three
 * things cost more than the rest of a build put together, and all three were
 * being thrown away and remade every stroke:
 *
 * - a **model**, which is read off disk and parsed;
 * - a **material**, whose shader has to be compiled before anything wearing it
 *   can be drawn at all;
 * - a **texture**, which has to be decoded and uploaded to the card.
 *
 * None of them depend on the map. A block type's model is its model whatever
 * the grid says, so they outlive the view that asked for them and a rebuild
 * gets them back for free. That is what `decals.material` has always done for
 * the ground's material, and for the same reason: "compiled once for the life
 * of the application rather than once per map".
 *
 * Per scene rather than global: all three belong to the scene they were made
 * in, and handing one to a different scene draws nothing. Held weakly, so
 * closing a scene does not keep them alive.
 */

import type { Node } from '@babylonjs/core/node.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { AssetError, detail, message } from '../util/errors.ts';
import { logger } from '../util/log.ts';

const log = logger('models');

/**
 * One cached thing, and how far along it is.
 *
 * `node` is `unknown` because a scene's cache holds whatever was asked for --
 * a texture here, a material there, a loaded model somewhere else. That is
 * also why `keep` casts on the way out: a lookup keyed by a string cannot
 * carry the type of what was put in, and the caller is the one that knows.
 */
type Entry = { done: boolean; node: unknown; pending: Promise<unknown> | null };

const caches = new WeakMap<Scene, Map<string, Entry>>();

function cacheFor(scene: Scene): Map<string, Entry> {
  let cache = caches.get(scene);
  if (!cache) {
    cache = new Map();
    caches.set(scene, cache);
  }
  return cache;
}

/**
 * A thing built once per scene and key, and kept.
 *
 * For what can be made on the spot — a material, a texture. A model has to be
 * loaded, so it has `keepModel` below.
 *
 * @param scene the scene it belongs to
 * @param {string} key what identifies it, unique across every kind of thing
 *   kept here
 * @param {() => any} make builds it. Called at most once per key.
 */
export function keep<T>(scene: Scene, key: string, make: () => T): T {
  const cache = cacheFor(scene);
  const found = cache.get(key);
  if (found) return found.node as T;
  const node = make();
  cache.set(key, { done: true, node, pending: null });
  return node;
}

/**
 * Build a model once, and use it now or when it lands.
 *
 * @param scene the scene it is imported into
 * @param key what identifies the model — the url it came from, plus anything
 *   else baked into the geometry
 * @param make imports it. Called at most once per key.
 * @param use given the model, or null if it failed to load. Called
 *   synchronously when the model is already there.
 */
export function keepModel<T extends Node>(
  scene: Scene,
  key: string,
  make: () => T | null | Promise<T | null>,
  use: (node: T | null) => void,
): void {
  const cache = cacheFor(scene);
  const found = cache.get(key);
  if (found) {
    if (found.done) use(found.node as T | null);
    else found.pending?.then((node) => use(node as T | null));
    return;
  }

  const record: Entry = { done: false, node: null, pending: null };
  record.pending = Promise.resolve()
    .then(make)
    .then((node): T | null => {
      // Parked out of the tree and switched off: a template exists to be
      // cloned, and one that was drawn would be a model standing at the origin
      // of every map from now on.
      if (node) {
        node.parent = null;
        node.setEnabled(false);
      }
      record.node = node ?? null;
      record.done = true;
      return node ?? null;
    })
    .catch((error: unknown) => {
      // Never rethrown: a model that will not load is a thing drawn without it
      // — `use` is called with null and every caller has a fallback — and a
      // rejected promise here would take the rebuild down with it.
      log.warn(`could not load ${key}`, detail(new AssetError(message(error), { cause: error })));
      record.done = true;
      return null;
    });
  cache.set(key, record);
  record.pending.then((node) => use(node as T | null));
}
