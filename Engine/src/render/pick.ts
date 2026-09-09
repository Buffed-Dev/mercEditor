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

/** Reads a tag back off a node, or null if it does not carry one. */
export function pickOf(node: Node | null | undefined): PickTag | null {
  const metadata: unknown = node?.metadata;
  if (!metadata || typeof metadata !== 'object') return null;

  const pick = (metadata as { pick?: unknown }).pick;
  if (!pick || typeof pick !== 'object') return null;

  const tag = pick as { list?: unknown; index?: unknown; key?: unknown; instances?: unknown };
  if (typeof tag.list !== 'string') return null;

  return {
    list: tag.list,
    index: typeof tag.index === 'number' ? tag.index : undefined,
    key: typeof tag.key === 'string' ? tag.key : undefined,
    instances: Array.isArray(tag.instances)
      ? tag.instances.filter((entry): entry is number => typeof entry === 'number')
      : undefined,
  };
}
