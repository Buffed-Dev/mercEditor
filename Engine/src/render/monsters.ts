import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
// Side-effect only: this is what adds `createInstance` to Mesh.
import '@babylonjs/core/Meshes/instancedMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Actor } from '../game/actor.ts';
import type { Prefab } from '../data/prefabs.ts';
import type { PlacedProp, Prop } from '../data/props.ts';
import type { MaterialInput } from '../data/materials.ts';
import type { Heights, Shadows } from './lights.ts';
import { LEVEL_H } from '../data/dimensions.ts';
import { BILLBOARD } from './isoCamera.ts';
import { surface, unlit } from './materials.ts';
import { createPropRuntime, type PropRuntime } from './props.ts';
import { BODY_LENGTH, BODY_RADIUS, riseToward } from './player.ts';

/** The two bars that make up one actor's health readout. */
type Bar = { group: TransformNode; fill: InstancedMesh };

/** One actor on screen. */
type View = {
  actor: Actor;
  group: TransformNode;
  /** The parts, when the body is a prefab; null for the stand-in capsule. */
  parts: PropRuntime | null;
  bar: Bar | null;
  barY: number;
  /** The height the body is drawn at, which trails the one it stands at. */
  shown: number | null;
};

/** Health bar geometry, in world units. */
const BAR_WIDTH = 0.62;
const BAR_HEIGHT = 0.085;
const BAR_CLEARANCE = 0.22; // gap between the top of the head and the bar

/** No dependencies, no world: a part stands at its own height inside the body. */
const FLAT: Heights = { heightAt: () => 0 };

/**
 * Bodies for the actors game/ is simulating — the player and everything else.
 *
 * An actor's body is its prefab: each part is placed through the same prop
 * runtime the map uses, under one node the actor's position drives, so a body
 * is whatever the library says it is and moves as one thing. A part naming a
 * `parent` hangs off the part with that `slot` instead of the root, which is
 * what makes a helmet turn with a head.
 *
 * ponytail: one prop runtime per actor, so forty grunts are forty clones of
 * each part rather than one instanced mesh. Batch per prefab id if it shows.
 */
export function createActorViews(
  scene: Scene,
  root: TransformNode,
  shadows: Shadows,
  deps: { props?: readonly Prop[] | null; game?: string; materials?: readonly MaterialInput[] | null } = {},
) {
  const owned: Mesh[] = [];

  /**
   * A quad whose origin is baked to its left edge, so scaling x fills from the
   * left rather than from the middle.
   *
   * Two of them, because a Babylon instance always draws with its source's
   * material and the track and the fill are different colours. Each is a
   * template: hidden itself, drawn once per actor as an instance.
   */
  function barSource(name: string, color: number): Mesh {
    const mesh = MeshBuilder.CreatePlane(name, { width: 1, height: 1 }, scene);
    mesh.bakeTransformIntoVertices(Matrix.Translation(0.5, 0, 0));
    const material = unlit(name, scene, { color });
    // Two triangles apiece, and a bar the player cannot read because it happens
    // to face away is worse than the cost of drawing both sides.
    material.backFaceCulling = false;
    mesh.material = material;
    mesh.setEnabled(false);
    owned.push(mesh);
    return mesh;
  }

  const trackSource = barSource('bar-track', 0x11151d);
  const fillSource = barSource('bar-fill', 0xd4574a);

  /** A track with a fill in front of it, already turned to face the camera. */
  function makeBar(): Bar {
    const group = new TransformNode('healthbar', scene);
    group.parent = root;
    group.rotationQuaternion = BILLBOARD.clone();

    const track = trackSource.createInstance('track');
    track.scaling.set(BAR_WIDTH, BAR_HEIGHT, 1);
    track.position.x = -BAR_WIDTH / 2;
    track.parent = group;

    const fill = fillSource.createInstance('fill');
    fill.scaling.set(BAR_WIDTH, BAR_HEIGHT, 1);
    fill.position.set(-BAR_WIDTH / 2, 0, 0.01); // just in front, to avoid z-fighting
    fill.parent = group;

    return { group, fill };
  }

  /**
   * ponytail: a capsule with a nub on the front, for a prefab with no parts —
   * there are no body models in the game yet. Goes when the prefabs get some.
   */
  let capsule: Mesh | null = null;
  const CAPSULE_HEIGHT = BODY_RADIUS * 2 + BODY_LENGTH;
  function standIn(): Mesh {
    if (!capsule) {
      capsule = MeshBuilder.CreateCapsule('body', { radius: BODY_RADIUS, height: CAPSULE_HEIGHT }, scene);
      capsule.material = surface('body', scene, { color: 0xa8c06d, roughness: 0.6, metallic: 0.05 });
      const visor = MeshBuilder.CreateBox('visor', { width: 0.26, height: 0.12, depth: 0.12 }, scene);
      visor.material = surface('visor', scene, { color: 0x1f2532, roughness: 0.4 });
      visor.position.set(0, BODY_LENGTH / 2 + BODY_RADIUS - 0.02, BODY_RADIUS * 0.85);
      visor.parent = capsule;
      capsule.setEnabled(false);
      owned.push(capsule, visor);
    }
    return capsule;
  }

  const views: View[] = [];

  function dropView(view: View): void {
    view.parts?.dispose();
    view.group.dispose(false, false);
    view.bar?.group.dispose(false, false);
  }

  return {
    /**
     * Give an actor a body. `prefab` is what it is made of; null, or one with
     * no parts, gets the stand-in. `bar` says whether its health is shown.
     */
    add(actor: Actor, prefab: Prefab | null, bar: boolean): void {
      const group = new TransformNode(`actor:${actor.archetype}`, scene);
      group.parent = root;

      let parts: PropRuntime | null = null;
      let height = CAPSULE_HEIGHT;
      if (prefab?.props.length) {
        parts = createPropRuntime(scene, deps.props, deps.game, deps.materials);
        // Parts stand about the prefab's middle, so the actor's position is
        // its centre rather than its corner. Ground is the group's business.
        const placed = prefab.props.map((child, index) =>
          parts!.place(
            { ...child, gx: child.gx - prefab.w / 2, gy: child.gy - prefab.h / 2 } as PlacedProp,
            index,
            FLAT,
            group,
            shadows,
          ),
        );
        prefab.props.forEach((child, index) => {
          const on = child.parent ? prefab.props.findIndex((one) => one.slot === child.parent) : -1;
          const node = placed[index]?.node;
          const over = on >= 0 ? placed[on]?.node : null;
          if (node && over && over !== node) node.parent = over;
        });
        parts.draw();
        height = Math.max(prefab.w, prefab.h);
      } else {
        const body = standIn().createInstance('body');
        body.position.y = CAPSULE_HEIGHT / 2;
        body.parent = group;
        shadows.add(body);
      }

      views.push({
        actor,
        group,
        parts,
        bar: bar ? makeBar() : null,
        barY: height + BAR_CLEARANCE,
        shown: null,
      });
    },

    /** Put each body where its actor now is, on top of the surface. */
    sync(world: { standAt: (gx: number, gy: number) => number }, dt = 0): void {
      for (const view of views) {
        const { actor, group, bar, barY } = view;
        const { gx, gy } = actor.pos;
        // Climbing a step rather than hopping it; at once when first placed.
        const target = world.standAt(gx, gy);
        view.shown = view.shown === null ? target : riseToward(view.shown, target, dt);
        const ground = view.shown * LEVEL_H;

        group.position.set(gx, ground, gy);
        group.rotation.y = actor.facing;

        if (!bar) continue;
        // The bar is not a child of the group: the group yaws to face the
        // actor's heading, and the bar has to keep facing the camera.
        bar.group.position.set(gx, ground + barY, gy);

        const attrs = actor.attrs;
        const max = attrs.value('health');
        const fraction = max > 0 ? Math.max(0, attrs.current('health') / max) : 0;
        bar.fill.scaling.x = BAR_WIDTH * fraction;
        // A zero-width mesh still renders a sliver, so hide it outright.
        bar.fill.setEnabled(fraction > 0);
      }
    },

    /** Drop one actor's body — it died. */
    remove(actor: Actor): boolean {
      const index = views.findIndex((view) => view.actor === actor);
      if (index < 0) return false;
      const [view] = views.splice(index, 1);
      if (view) dropView(view);
      return true;
    },

    dispose(): void {
      for (const view of views) dropView(view);
      // Templates, and their materials with them: nothing else is using either.
      for (const template of owned) template.dispose(false, true);
      capsule = null;
      views.length = 0;
    },
  };
}

/** Every actor currently drawn. */
export type ActorViews = ReturnType<typeof createActorViews>;
