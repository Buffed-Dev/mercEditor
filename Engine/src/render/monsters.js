import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
// Side-effect only: this is what adds `createInstance` to Mesh.
import '@babylonjs/core/Meshes/instancedMesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { MONSTER_KINDS } from '../game/monsters.js';
import { LEVEL_H } from '../data/dimensions.ts';
import { BILLBOARD } from './isoCamera.js';
import { colorOf, surface, unlit } from './materials.js';

/** Health bar geometry, in world units. */
const BAR_WIDTH = 0.62;
const BAR_HEIGHT = 0.085;
const BAR_CLEARANCE = 0.22; // gap between the top of the head and the bar

const CHASING_EYE = 0xff4d4d;
const CALM_EYE = 0xffd166;

/**
 * Meshes for the monsters game/monsters.js is simulating: a capsule the colour
 * of its kind, with the same nub-on-the-front trick the player uses so its
 * facing is readable, and an eye-glow that brightens while it is chasing.
 *
 * One source mesh per kind, and every monster of that kind is a Babylon
 * instance of it — so a room full of grunts is one draw call rather than one
 * each. The eyes cannot be instanced: their colour is animated per monster.
 */
export function createMonsterViews(scene, root, shadows, monsters) {
  const shared = new Map();
  const owned = [];

  /**
   * A quad whose origin is baked to its left edge, so scaling x fills from the
   * left rather than from the middle.
   *
   * Two of them, because a Babylon instance always draws with its source's
   * material and the track and the fill are different colours. Each is a
   * template: hidden itself, drawn once per monster as an instance.
   */
  function barSource(name, color) {
    const mesh = MeshBuilder.CreatePlane(name, { width: 1, height: 1 }, scene);
    mesh.bakeTransformIntoVertices(Matrix.Translation(0.5, 0, 0));
    mesh.material = unlit(name, scene, { color });
    // Two triangles apiece, and a bar the player cannot read because it happens
    // to face away is worse than the cost of drawing both sides.
    mesh.material.backFaceCulling = false;
    mesh.setEnabled(false);
    owned.push(mesh);
    return mesh;
  }

  const trackSource = barSource('bar-track', 0x11151d);
  const fillSource = barSource('bar-fill', 0xd4574a);

  /** A track with a fill in front of it, already turned to face the camera. */
  function makeBar() {
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

  function assetsFor(kind) {
    if (!shared.has(kind)) {
      const spec = MONSTER_KINDS[kind] ?? MONSTER_KINDS.grunt;
      const height = 0.5 * spec.scale + spec.radius * 0.9 * 2;

      // A prop is a pot: wider at the belly than at the lip, and squat enough
      // that it reads as furniture rather than as something short and alive.
      // Everything else about it — where it stands, that it can be hit, that it
      // has health — is the same, which is why only the mesh differs.
      const body = spec.prop
        ? MeshBuilder.CreateCylinder(
            `body-${kind}`,
            {
              height,
              diameterTop: spec.radius * 1.1,
              diameterBottom: spec.radius * 1.5,
              tessellation: 10,
            },
            scene,
          )
        : MeshBuilder.CreateCapsule(
            `body-${kind}`,
            { radius: spec.radius * 0.9, height },
            scene,
          );
      body.material = surface(`monster-${kind}`, scene, { color: spec.color, roughness: 0.75 });
      body.receiveShadows = true;
      body.setEnabled(false);
      shadows.add(body);
      owned.push(body);

      shared.set(kind, { spec, body, half: height / 2 });
    }
    return shared.get(kind);
  }

  /**
   * Free one monster's own meshes. Never recursive over materials: the body is
   * an instance, and disposing an instance's material would take the whole kind
   * with it. Only the eye material belongs to this monster alone.
   */
  function dropView(view) {
    view.group.dispose(false, false);
    view.bar?.group.dispose(false, false);
    view.eyeMaterial?.dispose();
  }

  const views = monsters.map((monster) => {
    const { spec, body, half } = assetsFor(monster.kind);
    const group = new TransformNode(`monster-${monster.kind}`, scene);
    group.parent = root;

    const capsule = body.createInstance('body');
    capsule.position.y = half;
    capsule.parent = group;

    // A prop gets neither of the two things that say "this is looking at you":
    // an eye that brightens when it notices you, and a bar counting down its
    // life. A pot is broken, not fought, and a health bar over one would
    // promise a fight that is not coming.
    const eyeMaterial = spec.prop ? null : unlit('eye', scene, { color: CALM_EYE });
    if (eyeMaterial) {
      const eyes = MeshBuilder.CreateSphere('eyes', { diameter: 0.14, segments: 6 }, scene);
      eyes.material = eyeMaterial;
      eyes.position.set(0, half * 1.5, spec.radius * 0.85);
      eyes.parent = group;
    }

    const bar = spec.prop ? null : makeBar();
    // Above the head: the capsule's full height, plus a gap.
    const barY = half * 2 + BAR_CLEARANCE;

    return { monster, group, eyeMaterial, bar, barY };
  });

  return {
    views,

    /** Put each mesh where its monster now is, on top of the surface. */
    sync(world) {
      for (const { monster, group, eyeMaterial, bar, barY } of views) {
        const { gx, gy } = monster.pos;
        const ground = world.heightAt(gx, gy) * LEVEL_H;

        group.position.set(gx, ground, gy);
        group.rotation.y = monster.facing;
        if (eyeMaterial) {
          eyeMaterial.emissiveColor = colorOf(monster.chasing ? CHASING_EYE : CALM_EYE);
        }

        // A prop has neither eye nor bar; there is nothing left to move.
        if (!bar) continue;

        // The bar is not a child of the group: the group yaws to face the
        // monster's heading, and the bar has to keep facing the camera.
        bar.group.position.set(gx, ground + barY, gy);

        const attrs = monster.actor.attrs;
        const max = attrs.value('health');
        const fraction = max > 0 ? Math.max(0, attrs.current('health') / max) : 0;
        bar.fill.scaling.x = BAR_WIDTH * fraction;
        // A zero-width mesh still renders a sliver, so hide it outright.
        bar.fill.setEnabled(fraction > 0);
      }
    },

    /**
     * Drop one monster's meshes — it died. The shared source mesh and its
     * material stay: the rest of its kind is still using them.
     */
    remove(monster) {
      const index = views.findIndex((view) => view.monster === monster);
      if (index < 0) return false;
      const [view] = views.splice(index, 1);
      dropView(view);
      return true;
    },

    /**
     * Shared meshes outlive any one monster, so they are freed here rather than
     * with the map they happened to be standing on.
     */
    dispose() {
      for (const view of views) dropView(view);
      // Templates, and their materials with them: nothing else is using either.
      for (const template of owned) template.dispose(false, true);
      shared.clear();
      views.length = 0;
    },
  };
}
