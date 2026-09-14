import type { Node } from '@babylonjs/core/node.js';

/**
 * What a node in the scene says about which map entry it stands for.
 *
 * The editor picks with a ray and gets back a mesh; this is how the mesh
 * answers "which portal are you?". Written by whatever builds the scene --
 * ./mapView.ts and ./props.ts -- and read by the editor.
 *
 * One of `index`, `key` or `instances`: an ordinary group is one entry, a
 * named spawn is addressed by its name, and
 * the walls are a single instanced mesh standing in for many, whose picks are
 * resolved to one of them by instance id.
 */
export type PickTag = {
  list: string;
  index?: number;
  key?: string;
  instances?: number[];
};

/**
 * Tag a node so a pick can name it.
 *
 * Babylon declares `Node.metadata` as `any`, which means every read of it
 * hands back `any` and quietly turns off type checking from there on -- a leak
 * no `no-explicit-any` rule can see, because no `any` is ever written. Routing
 * both ends through this file is what closes it: `any` exists on this one
 * line, and nowhere the tag is actually used.
 */
export function tagPick<T extends Node>(node: T, tag: PickTag): T {
  node.metadata = { pick: tag };
  return node;
}

/**
 * Reads a tag back off a node, or null if it does not carry one.
 *
 * The tag itself is handed back rather than a copy of it. Everything that
 * writes one goes through `tagPick` above, so a well-formed tag is the only
 * kind there is -- and this is asked of every node under the map whenever the
 * view is rebuilt or a drag is set up, which is a lot of objects to make and
 * throw away in order to say what the node already said.
 *
 * Checked rather than trusted, because `metadata` is Babylon's and anything may
 * have put anything in it.
 */
export function pickOf(node: Node | null | undefined): PickTag | null {
  const metadata: unknown = node?.metadata;
  if (!metadata || typeof metadata !== 'object') return null;

  const pick = (metadata as { pick?: unknown }).pick;
  if (!pick || typeof pick !== 'object') return null;
  if (typeof (pick as { list?: unknown }).list !== 'string') return null;

  return pick as PickTag;
}
