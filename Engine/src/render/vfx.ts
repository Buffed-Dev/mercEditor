import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { colorOf } from './materials.ts';
import {
  SLASH_FALLBACK,
  VFX,
  curveAt,
  modifierOf,
  modifiersOf,
  normalizeVfx,
  sheetFrames,
  type Vfx,
  type VfxEmitter,
  type VfxInput,
  type VfxModifier,
  type VfxParticle,
  type VfxSheet,
} from '../data/vfx.ts';
import type { ICanvasRenderingContext } from '@babylonjs/core/Engines/ICanvas.js';
import type { IParticleEmitterType } from '@babylonjs/core/Particles/EmitterTypes/IParticleEmitterType.js';
import type { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Particle } from '@babylonjs/core/Particles/particle.js';
import type { Scene } from '@babylonjs/core/scene.js';

/** Where an effect is played: a fixed point, or something that carries it. */
export type VfxAnchor = Vector3 | TransformNode;

/** What the blow an effect belongs to tells it about itself. */
export type VfxShape = { aim?: number; arc?: number; range?: number };

/**
 * A running effect, whichever of the two machines is behind it.
 *
 * Particles and sprite sheets are built and torn down completely differently,
 * but a caller only ever wants to carry one about, stop it and throw it away.
 * `system` and `node` are here because the editor's preview reaches for them;
 * one of the two is always null.
 */
export type VfxHandle = {
  system: ParticleSystem | null;
  node: TransformNode | Mesh | null;
  readonly alive: boolean;
  follow: (where: Vector3) => void;
  stop: () => void;
  dispose: () => void;
};

/** How an effect is played. */
export type SpawnOptions = { shape?: VfxShape | null; looping?: boolean; forever?: boolean };

/**
 * Per-scene and per-system state that used to be stashed on the Babylon
 * objects themselves as `__mercVfxSprites`, `__mercVfxGrading` and
 * `__mercBurst`.
 *
 * WeakMaps rather than properties: the lifetime is identical -- an entry goes
 * when its scene or system does -- and a scene is no longer quietly carrying
 * fields that Babylon knows nothing about.
 */
const sprites = new WeakMap<Scene, Map<string, Texture>>();
const gradings = new WeakMap<Scene, ImageProcessingConfiguration>();
const bursts = new WeakMap<ParticleSystem, number>();

/**
 * Turning a VFX definition into a running particle system.
 *
 * Babylon's ParticleSystem is the whole engine here — this file is the mapping
 * from the settings a person tunes onto the properties it exposes, and nothing
 * else. Everything an effect does not ask for costs nothing: a modifier that
 * was never added is a branch that is never taken and a per-frame pass that is
 * never installed.
 *
 * Two ways to use one. `attach` starts a system that lives as long as whatever
 * it is on — a fire on a map, a glow on a chest — and is disposed with it.
 * `play` is a one-shot: it emits, stops, and is swept up once the last particle
 * has died.
 *
 * Every system is disposed with `dispose(false)`, and that false matters: the
 * sprites are shared by every effect in the scene that uses the same one, and
 * Babylon's default is for a system to take its texture down with it. One flash
 * landing would otherwise leave every effect afterwards drawing nothing.
 */

const DEG = Math.PI / 180;

// ------------------------------------------------------------ the sprite

/**
 * One particle, painted on a canvas.
 *
 * Every sprite is white on transparent, because the colour comes from the
 * system: an effect's colour multiplies whatever is in here, so one drawing
 * serves an orange spark and a blue one. Which is also why they are drawn at
 * all — a handful of shapes are cheaper to paint than to ship, and there is no
 * request to wait for before the first frame.
 */
function draw(shape: string, ctx: ICanvasRenderingContext, size: number): void {
  const half = size / 2;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';

  const radial = (stops: readonly [number, number][]): void => {
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    for (const [at, alpha] of stops) gradient.addColorStop(at, `rgba(255,255,255,${alpha})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  };

  switch (shape) {
    case 'square':
      // Short of the edge, so a rotated particle is not clipped by its own
      // texture's corners.
      ctx.fillRect(size * 0.16, size * 0.16, size * 0.68, size * 0.68);
      return;

    case 'ring':
      ctx.lineWidth = size * 0.12;
      ctx.beginPath();
      ctx.arc(half, half, half * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      return;

    case 'star': {
      // Four points, each a fifth of the radius at its waist — the shape a
      // spark reads as, rather than the five-pointed one a sheriff does.
      const spikes = 4;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i * Math.PI) / spikes - Math.PI / 2;
        const at = half * (i % 2 ? 0.22 : 0.94);
        ctx[i ? 'lineTo' : 'moveTo'](half + Math.cos(angle) * at, half + Math.sin(angle) * at);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }

    // Solid to nearly its edge: a hard little pellet rather than a glow.
    case 'spark':
      radial([
        [0.82, 1],
        [1, 0],
      ]);
      return;

    // A small hard centre and a long tail. Roughly an inverse-square falloff:
    // most of the brightness spent in the first fifth of the radius and the
    // rest halo, which is how a bright thing actually looks.
    case 'glow':
      radial([
        [0, 1],
        [0.06, 1],
        [0.15, 0.55],
        [0.3, 0.22],
        [0.5, 0.07],
        [0.75, 0.02],
        [1, 0],
      ]);
      return;

    // Soft dot, and the streak that is the same dot drawn stretched.
    default:
      radial([
        [0, 1],
        [0.35, 0.72],
        [1, 0],
      ]);
  }
}

/**
 * The texture an effect draws with, made once per scene and shared by
 * everything that asks for the same one. Keyed by the picture when there is one
 * and by the shape name when there is not.
 */
function sprite(scene: Scene, particle: VfxParticle): Texture {
  const key = particle.shape === 'sprite' && particle.image ? particle.image : `shape:${particle.shape}`;
  let cache = sprites.get(scene);
  if (!cache) {
    cache = new Map<string, Texture>();
    sprites.set(scene, cache);
  }
  const held = cache.get(key);
  // A texture can outlive its GPU side — a scene torn down and rebuilt, say —
  // and a dead one draws nothing at all, silently.
  if (held && held.isReady()) return held;

  let texture: Texture;
  if (particle.shape === 'sprite' && particle.image) {
    // The fourth argument is `invertY`, and it is true — Babylon's own default
    // — so a picture arrives the way up it was drawn.
    texture = new Texture(particle.image, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  } else {
    // 128 rather than 64: the glow shape is mostly a long smooth falloff, and
    // at half this the halo bands visibly once a particle is drawn large.
    const size = 128;
    // Held as a DynamicTexture rather than through `texture`, which is the
    // wider type: only this one has a canvas to draw the shape onto.
    const drawn = new DynamicTexture(`vfx:${particle.shape}`, size, scene, false);
    draw(particle.shape, drawn.getContext(), size);
    drawn.update();
    texture = drawn;
  }
  texture.hasAlpha = true;

  cache.set(key, texture);
  return texture;
}

/**
 * Image processing that does nothing, for the effects drawn at the colour they
 * were authored in. A system binds the scene's configuration by default, so a
 * map with tone mapping on grades every effect in it; handing it one of its own
 * at the defaults is how it opts out.
 */
function plainGrading(scene: Scene): ImageProcessingConfiguration {
  let found = gradings.get(scene);
  if (!found) {
    found = new ImageProcessingConfiguration();
    gradings.set(scene, found);
  }
  return found;
}

// ------------------------------------------------------------- the shape

/** Where particles are born, and which way they set off. */
function useEmitterShape(system: ParticleSystem, emitter: VfxEmitter): IParticleEmitterType {
  const radius = Math.max(emitter.radius, 0.001);
  const jitter = emitter.spread / 180;

  switch (emitter.shape) {
    case 'sphere':
      return system.createSphereEmitter(radius);
    case 'hemisphere':
      return system.createHemisphericEmitter(radius);
    case 'box': {
      const half = new Vector3(emitter.sizeX / 2, emitter.sizeZ / 2, emitter.sizeY / 2);
      // Babylon's box emitter throws along a direction range rather than
      // outward, so the spread is what opens that range up.
      const wide = Math.max(0.001, jitter);
      return system.createBoxEmitter(
        new Vector3(-wide, 1, -wide),
        new Vector3(wide, 1, wide),
        half.scale(-1),
        half,
      );
    }
    case 'cylinder':
      return system.createCylinderEmitter(radius, Math.max(emitter.height, 0.001), 1, jitter);
    // The flat two: a cylinder a fiftieth of a tile tall, filled to its middle
    // or only its rim.
    case 'disc':
      return system.createCylinderEmitter(radius, 0.02, 1, jitter);
    case 'ring':
      return system.createCylinderEmitter(radius, 0.02, 0, jitter);
    case 'point':
      return system.createConeEmitter(0.001, Math.max(emitter.spread, 1) * DEG);
    default:
      return system.createConeEmitter(radius, emitter.spread * DEG);
  }
}

// ----------------------------------------------------------- over time

/**
 * The size, opacity and colour ramps, as Babylon gradients.
 *
 * Gradients rather than a per-frame pass because Babylon already walks them for
 * free, and because they are the only way to say "over this particle's own
 * life" — every particle is at a different point in the same ramp, which is
 * exactly what the modifier means.
 *
 * A curve is sampled into a handful of stops rather than sent as a formula.
 * Eight is enough that none of these shapes shows a corner and few enough that
 * the walk stays cheap.
 */
const CURVE_STOPS = 8;

/**
 * What a missing colour or ramp end reads as.
 *
 * `defaultModifier` fills every field a modifier's kind declares, so these
 * only stand in for a record that was hand-written without them: white and
 * unity, which together mean "leave it as it is".
 */
const WHITE = 0xffffff;
const UNCHANGED = 1;

function rampGradients(
  system: ParticleSystem,
  particle: VfxParticle,
  overTime: VfxModifier | null,
): void {
  const born = colorOf(particle.color);
  const gain = particle.glow > 0 ? particle.glow : 1;

  const scaleFrom = overTime?.scaleFrom ?? 1;
  const scaleTo = overTime?.scaleTo ?? 1;
  const fadeFrom = overTime?.fadeFrom ?? 1;
  const fadeTo = overTime?.fadeTo ?? 1;
  const colorFrom = overTime ? colorOf(overTime.colorFrom ?? WHITE) : born;
  const colorTo = overTime ? colorOf(overTime.colorTo ?? WHITE) : born;

  for (let i = 0; i < CURVE_STOPS; i++) {
    const at = i / (CURVE_STOPS - 1);

    const scale = scaleFrom + (scaleTo - scaleFrom) * curveAt(overTime?.scaleCurve, at);
    system.addSizeGradient(at, Math.max(0, particle.size * scale));

    const alpha = fadeFrom + (fadeTo - fadeFrom) * curveAt(overTime?.fadeCurve, at);
    const tint = overTime
      ? Color3.Lerp(colorFrom, colorTo, curveAt(overTime.colorCurve, at))
      : born;
    system.addColorGradient(at, tint.scale(gain).toColor4(Math.max(0, alpha) * particle.opacity));
  }
}

// ------------------------------------------------------------- sprite sheet

/**
 * The mesh a sheet is played on.
 *
 * Every one is drawn from both sides. A flipbook is a picture rather than a
 * solid, and half of a picture missing because you happen to be behind it is
 * never what anyone wanted — least of all on a cone or a cylinder, where you
 * are looking through the near face at the far one on purpose.
 */
function sheetMesh(scene: Scene, sheet: VfxSheet): Mesh {
  switch (sheet.shape) {
    case 'disc':
      return MeshBuilder.CreateDisc('vfxSheet', { radius: sheet.radius, tessellation: 48 }, scene);
    case 'cone':
      return MeshBuilder.CreateCylinder(
        'vfxSheet',
        { diameterTop: 0, diameterBottom: sheet.radius * 2, height: sheet.height, tessellation: 32 },
        scene,
      );
    case 'cylinder':
      return MeshBuilder.CreateCylinder(
        'vfxSheet',
        { diameter: sheet.radius * 2, height: sheet.height, tessellation: 32 },
        scene,
      );
    case 'sphere':
      return MeshBuilder.CreateSphere('vfxSheet', { diameter: sheet.radius * 2, segments: 24 }, scene);
    case 'box':
      return MeshBuilder.CreateBox(
        'vfxSheet',
        { width: sheet.width, height: sheet.height, depth: sheet.depth },
        scene,
      );
    default:
      return MeshBuilder.CreatePlane('vfxSheet', { width: sheet.width, height: sheet.height }, scene);
  }
}

/**
 * A spritesheet playing on a shape.
 *
 * The animation is the texture's own window sliding over the sheet — one cell
 * wide and one cell tall, moved a cell at a time — rather than a texture per
 * frame. One upload, one material, and changing frame costs two numbers.
 *
 * Babylon's V runs *up* the picture while a sheet is read *down* it, which is
 * the whole subtlety of this file. The texture is uploaded the way up it was
 * drawn (invertY, Babylon's default), so V=1 is its top edge — and the row a
 * cell sits in has to be counted back from there, or a grid plays its rows
 * bottom-first. A single-row strip comes out the same either way, which is
 * exactly why that mistake survives until somebody loads a 5x5.
 */
function buildSheet(scene: Scene, def: Vfx, anchor: VfxAnchor) {
  const sheet = def.sheet;
  const { columns, rows, first, count } = sheetFrames(sheet);

  const mesh = sheetMesh(scene, sheet);
  mesh.isPickable = false;
  if (anchor instanceof Vector3) mesh.position.copyFrom(anchor);
  else mesh.parent = anchor;

  // How it is turned. A billboard is Babylon's own; the other two are a
  // rotation, because a shape laid flat should stay flat as the view moves.
  if (sheet.facing === 'camera') mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  else if (sheet.facing === 'ground') mesh.rotation.x = Math.PI / 2;

  const material = new StandardMaterial(`vfxSheet:${def.id}`, scene);
  material.disableLighting = true;
  material.backFaceCulling = false;
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveColor = colorOf(sheet.color);
  material.alpha = sheet.opacity;
  // Added to the frame or laid over it, the same choice a particle's glow is.
  material.alphaMode = sheet.glow ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE;
  // See materials.ts: applyFog belongs to a mesh, so this only ever set a
  // field nothing reads. fogEnabled is the one that gates it.
  material.fogEnabled = false;
  // A flipbook is light, not a surface. Left writing depth it hides whatever is
  // behind it and takes a bite out of the contact shading — the plane reads as
  // a pane of glass laid over the scene, which is exactly what it is not.
  material.disableDepthWrite = true;
  mesh.receiveShadows = false;
  if (sheet.raw) material.imageProcessingConfiguration = plainGrading(scene);

  // Held here rather than read back off `material.emissiveTexture`, which
  // Babylon types as a BaseTexture -- and the offsets a flipbook writes live
  // on Texture. One fewer property read per frame, too.
  let sheetTexture: Texture | null = null;
  if (sheet.image) {
    const texture = new Texture(sheet.image, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    sheetTexture = texture;
    texture.hasAlpha = true;
    // Clamped, so a cell never bleeds the one beside it at its edge.
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.uScale = 1 / columns;
    texture.vScale = 1 / rows;
    material.emissiveTexture = texture;
    material.opacityTexture = texture;
  }
  mesh.material = material;

  const showFrame = (at: number): void => {
    const texture = sheetTexture;
    if (!texture) return;
    // Wrapped inside the range and then counted from its start, so a clip that
    // begins part way down a sheet loops on itself rather than on the sheet.
    const frame = first + (((at % count) + count) % count);
    texture.uOffset = (frame % columns) / columns;
    texture.vOffset = 1 - (Math.floor(frame / columns) + 1) / rows;
  };
  showFrame(0);

  return { mesh, material, count, showFrame };
}

// ------------------------------------------------------------ movements

/**
 * The middle of the effect, in world space, whether it is pinned to a place or
 * riding on something that moves.
 */
function originOf(system: ParticleSystem, into: Vector3): Vector3 {
  const emitter = system.emitter;
  if (!emitter) return into.setAll(0);
  // `instanceof` rather than probing for getAbsolutePosition: an emitter is a
  // point or a node, and this is already how the rest of the file asks.
  return emitter instanceof Vector3
    ? into.copyFrom(emitter)
    : into.copyFrom(emitter.getAbsolutePosition());
}

/**
 * A particle carrying how far off the swing's edge it was born.
 *
 * A WeakMap would be the tidy answer everywhere else in this file, but this is
 * written once per particle and read once per particle per frame, on a system
 * that recycles them -- so the field goes on the particle, and the cast is
 * confined to the two lines that touch it.
 */
type BladeParticle = Particle & { _mercBlade?: number };

/**
 * Put a slash's particles on the blade the moment they are born.
 *
 * Babylon creates new particles *after* it runs `updateFunction`, so anything
 * born this frame is drawn once at the emitter before the sweep has seen it.
 * One frame is 16ms, which sounds like nothing until you notice that at three
 * hundred a second it is a permanent handful of sparks at the caster's feet
 * while the blade swings a range away.
 *
 * So the emitter's own start position is wrapped rather than corrected after
 * the fact. What it decides still matters — how far from the middle it put the
 * particle becomes how far off the blade it sits, which makes the emitter's
 * radius the blade's thickness — but the angle and the distance are the swing's.
 */
function bladeBirth(
  system: ParticleSystem,
  spread: number,
  slash: VfxModifier,
  aim: number,
  half: number,
  reach: number,
): void {
  const type = system.particleEmitterType;
  const inner = type.startPositionFunction.bind(type);
  // Age zero is the near edge of the swing, wherever that is.
  const start = aim - (slash.flip ? -1 : 1) * half;

  type.startPositionFunction = (
    worldMatrix: Matrix,
    out: Vector3,
    particle: Particle,
    isLocal: boolean,
  ) => {
    inner(worldMatrix, out, particle, isLocal);

    // The emitter's own place, which is the middle to swing around. A local
    // position is already relative to it.
    const ox = isLocal ? 0 : worldMatrix.m[12];
    const oz = isLocal ? 0 : worldMatrix.m[14];

    const off = Math.hypot(out.x - ox, out.z - oz) - spread * 0.5;
    (particle as BladeParticle)._mercBlade = off;

    const away = Math.max(0, reach + off);
    out.x = ox + Math.sin(start) * away;
    out.z = oz + Math.cos(start) * away;
  };
}

/**
 * Stack a section's movements onto a system, as one pass per frame after
 * Babylon's own.
 *
 * Wrapped around `updateFunction` rather than replacing it: the default does
 * ageing, recycling, the gradients and the ordinary direction-and-gravity step,
 * and all of that is wanted. These only nudge what it produced.
 *
 * `position` is where the particle is and `direction` is how fast it is going,
 * so a movement that writes the first moves it and one that writes the second
 * bends its path — which is the difference between Circular and Arc.
 */
function applyMovements(
  scene: Scene,
  system: ParticleSystem,
  movements: readonly VfxModifier[],
  emitter: VfxEmitter,
  shape: VfxShape | null,
): void {
  if (!movements.length) return;

  const base = system.updateFunction;
  const origin = new Vector3();

  // What a swing is, for the movement of that name. Fixed for the life of the
  // system: an ability's arc is decided when it goes off, not while it lands.
  const aim = shape?.aim ?? SLASH_FALLBACK.aim;
  const half = ((shape?.arc ?? SLASH_FALLBACK.arc) * DEG) / 2;
  // How far out the blade is drawn: the edge of the cone, because that is how
  // far the blow it belongs to actually reaches.
  const reach = shape?.range ?? Math.max(emitter.radius, 0.5);

  const slash = movements.find((move) => move.type === 'slash');
  if (slash) bladeBirth(system, emitter.radius, slash, aim, half, reach);

  system.updateFunction = (particles: Particle[]) => {
    base(particles);

    // Real seconds. Babylon's own step is scaled by `updateSpeed`, which is a
    // dial for how fast a system runs; a movement authored in tiles per second
    // should mean tiles per second.
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05);
    if (dt <= 0) return;

    originOf(system, origin);

    for (const movement of movements) {
      const turn = (movement.turn ?? 0) * DEG * dt;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);

      for (const particle of particles) {
        const at = particle.position;

        switch (movement.type) {
          case 'slash': {
            // Absolute rather than incremental: a particle's place in the swing
            // is its place in its own life, so the blade arrives at the far
            // edge exactly as it dies however the frames fell.
            const along = particle.lifeTime > 0 ? particle.age / particle.lifeTime : 1;
            const side = movement.flip ? -1 : 1;
            const angle = aim + side * (along * 2 - 1) * half;

            // How far off the blade this one sits, written when it was born.
            // Never re-measured: this writes the position it reads, so taking
            // it again would compound and the blade would march outward.
            const away = Math.max(0, reach + ((particle as BladeParticle)._mercBlade ?? 0));
            at.x = origin.x + Math.sin(angle) * away;
            at.z = origin.z + Math.cos(angle) * away;
            break;
          }

          case 'curve': {
            const { x, z } = particle.direction;
            particle.direction.x = x * cos - z * sin;
            particle.direction.z = x * sin + z * cos;
            break;
          }

          case 'drift': {
            const heading = (movement.heading ?? 0) * DEG;
            const push = (movement.force ?? 0) * dt;
            particle.direction.x += Math.sin(heading) * push;
            particle.direction.z += Math.cos(heading) * push;
            break;
          }

          case 'attract': {
            const dx = origin.x - at.x;
            const dy = origin.y - at.y;
            const dz = origin.z - at.z;
            const away = Math.hypot(dx, dy, dz);
            // On top of the middle there is no direction to be pulled in.
            if (away < 1e-4) break;
            const pull = ((movement.force ?? 0) * dt) / away;
            particle.direction.x += dx * pull;
            particle.direction.y += dy * pull;
            particle.direction.z += dz * pull;
            break;
          }

          // Circular, and the cylindrical one that is it plus a climb.
          default: {
            let dx = at.x - origin.x;
            let dz = at.z - origin.z;

            if (movement.type === 'spiral') {
              at.y += (movement.rise ?? 0) * dt;
              const out = Math.hypot(dx, dz);
              if (out > 1e-4) {
                const wider = (out + (movement.widen ?? 0) * dt) / out;
                dx *= wider;
                dz *= wider;
              }
            }

            at.x = origin.x + dx * cos - dz * sin;
            at.z = origin.z + dx * sin + dz * cos;
          }
        }
      }
    }
  };
}

/**
 * The emitter's own movement and its ramps, which move the whole system rather
 * than anything in it.
 *
 * A node, because that is what Babylon follows: a system whose emitter is a
 * point cannot be moved without moving every particle already thrown from it,
 * and particles are meant to be left behind.
 */
function driveEmitter(
  scene: Scene,
  host: TransformNode,
  part: VfxEmitter | VfxSheet,
): (() => void) | null {
  const moves = modifiersOf(part, 'movement');
  const overTime = modifierOf(part, 'overTime');
  // A transform is not in this list on purpose: it is set once when the node is
  // made and never changes, so there is nothing for a per-frame pass to do.
  if (!moves.length && !overTime) return null;

  const home = host.position.clone();
  const born = performance.now() / 1000;
  const period = part.duration || 1;

  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05);
    const along = ((performance.now() / 1000 - born) / period) % 1;

    for (const move of moves) {
      const turn = (move.turn ?? 0) * DEG * dt;
      const dx = host.position.x - home.x;
      const dz = host.position.z - home.z;

      switch (move.type) {
        case 'drift': {
          const heading = (move.heading ?? 0) * DEG;
          host.position.x += Math.sin(heading) * (move.force ?? 0) * dt;
          host.position.z += Math.cos(heading) * (move.force ?? 0) * dt;
          break;
        }
        case 'attract':
          host.position.x -= dx * Math.min(1, (move.force ?? 0) * dt);
          host.position.z -= dz * Math.min(1, (move.force ?? 0) * dt);
          break;
        default: {
          if (move.type === 'spiral') host.position.y += (move.rise ?? 0) * dt;
          const cos = Math.cos(turn);
          const sin = Math.sin(turn);
          host.position.x = home.x + dx * cos - dz * sin;
          host.position.z = home.z + dx * sin + dz * cos;
        }
      }
    }

    if (overTime) {
      const scale =
        (overTime.scaleFrom ?? UNCHANGED) +
        ((overTime.scaleTo ?? UNCHANGED) - (overTime.scaleFrom ?? UNCHANGED)) *
          curveAt(overTime.scaleCurve, along);
      host.scaling.setAll(Math.max(0, scale));
    }
  });

  return () => scene.onBeforeRenderObservable.remove(observer);
}

// ------------------------------------------------------------- assembly

/**
 * The node an effect hangs off.
 *
 * A transform or an emitter movement needs something to move that is not the
 * particles themselves — moving a system's emitter point does not drag the
 * particles already thrown from it, which is exactly right, and is why those
 * effects get a node. One with neither is pinned straight to a point and costs
 * nothing at all.
 */
function anchorFor(
  scene: Scene,
  def: Vfx,
  at: VfxAnchor,
  part: VfxEmitter | VfxSheet,
  aim = 0,
): { anchor: VfxAnchor; host: TransformNode | null; offset: Vector3 } {
  const transform = modifierOf(part, 'transform');
  const needsNode =
    modifiersOf(part, 'movement').length > 0 || modifierOf(part, 'overTime') || transform || aim;
  if (!needsNode) return { anchor: at, host: null, offset: Vector3.Zero() };

  const host = new TransformNode(`vfx:${def.id}`, scene);
  // Turned to face the way whatever threw it was facing, so a directional
  // effect points along the blow rather than along the world. Babylon's Y
  // rotation sends local +Z to (sin, cos), which is the same heading the game
  // measures everywhere else, so the aim goes in as it stands.
  host.rotation.y = aim;

  const offset = Vector3.Zero();
  if (transform) {
    // Turned with it. "A tile forward" should mean forward along the aim, not
    // forward along the map — the whole point of aiming it.
    const cos = Math.cos(aim);
    const sin = Math.sin(aim);
    const posX = transform.posX ?? 0;
    const posY = transform.posY ?? 0;
    const posZ = transform.posZ ?? 0;
    offset.set(posX * cos + posZ * sin, posY, posZ * cos - posX * sin);
    host.rotation.set(
      (transform.rotX ?? 0) * DEG,
      aim + (transform.rotY ?? 0) * DEG,
      (transform.rotZ ?? 0) * DEG,
    );
    host.scaling.set(
      transform.scaleX ?? UNCHANGED,
      transform.scaleY ?? UNCHANGED,
      transform.scaleZ ?? UNCHANGED,
    );
  }

  // A node anchor is read for where it stands right now. `copyFrom` used to
  // be handed the node itself, which has no x/y/z -- so attaching an effect
  // that needed a host of its own put it at NaN and it was never seen.
  host.position.copyFrom(at instanceof Vector3 ? at : at.absolutePosition).addInPlace(offset);
  // Handed back rather than left implicit in the position, because following
  // something means moving the anchor — and an offset that only existed as
  // part of the first position is an offset the first move throws away.
  return { anchor: host, host, offset };
}

/**
 * Start an effect somewhere: the whole of it, modifiers included.
 *
 * The one way an effect is ever spawned, whichever kind it is, so the editor's
 * stage and the game are running the same thing. They have diverged twice
 * already — the preview skipped the map's grading once and the emitter's own
 * modifiers the next time — and the fix is the same both times: one path,
 * rather than two that agree until they do not.
 *
 * @returns a handle: whether it is still going, where to follow, and how to
 *   stop and let go. The two kinds have almost nothing in common underneath, so
 *   this is what everything above them talks to instead.
 */
export function spawnVfx(
  scene: Scene,
  raw: VfxInput,
  at: VfxAnchor,
  { shape = null, looping = false, forever = false }: SpawnOptions = {},
): VfxHandle {
  const def = normalizeVfx(raw);
  return def.kind === 'sheet'
    ? spawnSheet(scene, def, at, { shape, looping, forever })
    : spawnParticles(scene, def, at, { shape, looping, forever });
}

function spawnParticles(
  scene: Scene,
  def: Vfx,
  at: VfxAnchor,
  { shape, looping, forever }: SpawnOptions,
): VfxHandle {
  // Only a point is lifted. An effect hung on something that moves is already
  // wherever that thing put it, and raising it as well would float it.
  const lift = at instanceof Vector3 ? new Vector3(0, def.emitter.lift, 0) : Vector3.Zero();
  const where = at instanceof Vector3 ? at.add(lift) : at;
  const { anchor, host, offset } = anchorFor(scene, def, where, def.emitter, shape?.aim ?? 0);
  // Everything between where it was told to be and where it actually sits.
  const carry = lift.add(offset);

  const system = buildVfx(scene, def, anchor, shape);
  // A definition that emits forever is cut down to a single life when it is
  // thrown once: "forever" is what an effect standing on a map means, and a
  // flash that never stopped would be a leak per swing.
  system.targetStopDuration = forever
    ? 0
    : looping
      ? def.emitter.duration
      : def.emitter.duration || def.particle.life;
  system.start();
  const burst = bursts.get(system);
  if (burst) system.manualEmitCount = burst;

  const stop = host ? driveEmitter(scene, host, def.emitter) : null;

  return {
    system,
    node: host,
    // "isStarted" stays true after stop() and goes false once the last particle
    // has died, which is exactly when there is nothing left to keep.
    get alive() {
      return system.isStarted();
    },
    /**
     * Move it to a new place, keeping everything that put it where it was: its
     * lift, and its transform's own offset. Following something means the
     * effect goes with it, not that it forgets where it was standing.
     */
    follow(where: Vector3): void {
      const to = where.add(carry);
      if (host) host.position.copyFrom(to);
      else system.emitter = to;
    },
    stop(): void {
      system.stop();
    },
    dispose(): void {
      stop?.();
      // False, so the sprite every effect shares survives.
      system.dispose(false);
      host?.dispose();
    },
  };
}

/**
 * A sheet: one mesh, one material, and a clock walking the cells.
 *
 * It ends when the picture has been played, unless it loops or was given a
 * length — which is the same rule the particle kind follows, said in the units
 * a flipbook has. A looping one thrown by an ability still stops, because
 * otherwise every swing would leave a fire burning where it landed.
 */
function spawnSheet(
  scene: Scene,
  def: Vfx,
  at: VfxAnchor,
  { shape, looping, forever }: SpawnOptions,
): VfxHandle {
  const sheet = def.sheet;
  const lift = at instanceof Vector3 ? new Vector3(0, sheet.lift, 0) : Vector3.Zero();
  const where = at instanceof Vector3 ? at.add(lift) : at;
  const { anchor, host, offset } = anchorFor(scene, def, where, sheet, shape?.aim ?? 0);
  const carry = lift.add(offset);

  const { mesh, material, count, showFrame } = buildSheet(scene, def, anchor ?? at);
  const run = count / Math.max(0.5, sheet.fps);
  const lasts = forever ? 0 : sheet.duration || (sheet.loop && looping ? 0 : run);

  const born = performance.now() / 1000;
  let alive = true;

  const observer = scene.onBeforeRenderObservable.add(() => {
    const age = performance.now() / 1000 - born;
    const frame = Math.floor(age * sheet.fps);

    if (!sheet.loop && frame >= count) {
      // Held on its last cell rather than snapping back to its first, which is
      // what "played once" looks like to anyone watching.
      showFrame(count - 1);
    } else {
      showFrame(frame);
    }

    if (lasts > 0 && age >= lasts) alive = false;
    else if (lasts === 0 && !sheet.loop && frame >= count) alive = false;

    // The over-time ramp, over the same window the animation runs in.
    const overTime = modifierOf(sheet, 'overTime');
    if (overTime) {
      const along = lasts > 0 ? Math.min(1, age / lasts) : (age / Math.max(run, 0.001)) % 1;
      const scaleFrom = overTime.scaleFrom ?? UNCHANGED;
      const scaleTo = overTime.scaleTo ?? UNCHANGED;
      const scale = scaleFrom + (scaleTo - scaleFrom) * curveAt(overTime.scaleCurve, along);
      mesh.scaling.setAll(Math.max(0, scale));
      const fadeFrom = overTime.fadeFrom ?? UNCHANGED;
      const fadeTo = overTime.fadeTo ?? UNCHANGED;
      const fade = fadeFrom + (fadeTo - fadeFrom) * curveAt(overTime.fadeCurve, along);
      material.alpha = Math.max(0, fade) * sheet.opacity;
      material.emissiveColor = Color3.Lerp(
        colorOf(overTime.colorFrom ?? WHITE),
        colorOf(overTime.colorTo ?? WHITE),
        curveAt(overTime.colorCurve, along),
      );
    }
  });

  const stop = host ? driveEmitter(scene, host, sheet) : null;

  return {
    system: null,
    node: host ?? mesh,
    get alive() {
      return alive;
    },
    follow(where: Vector3): void {
      (host ?? mesh).position.copyFrom(where.add(carry));
    },
    stop(): void {
      alive = false;
    },
    dispose(): void {
      scene.onBeforeRenderObservable.remove(observer);
      stop?.();
      material.dispose(false, false);
      mesh.dispose(false, false);
      host?.dispose();
    },
  };
}

/**
 * Build a system from a definition, aimed at `emitter` — a Vector3 for a fixed
 * place, or a node for something that moves. Not started: `spawnVfx` is what
 * starts one, and what gives it everything its modifiers ask for.
 *
 * @param shape what the ability doing this decided — its aim, its arc and its
 *   range. Only the slash movement reads it, and only it needs to.
 */
export function buildVfx(
  scene: Scene,
  raw: VfxInput,
  anchor: VfxAnchor,
  shape: VfxShape | null = null,
): ParticleSystem {
  const def = normalizeVfx(raw);
  const { emitter, particle } = def;

  const rate = emitter.mode === 'burst' ? 0 : emitter.count;
  const burst = emitter.mode === 'burst' ? emitter.count : 0;
  const capacity = Math.max(8, Math.ceil(rate * particle.life) + burst);
  const system = new ParticleSystem(`vfx:${def.id}`, capacity, scene);

  system.particleTexture = sprite(scene, particle);
  // Babylon declares this as `AbstractMesh | Vector3`, but all a system ever
  // asks its emitter for is a world matrix, and the hosts `anchorFor` builds
  // are plain TransformNodes. The narrowing is in the declaration, not the
  // runtime -- this is the one place that has to say so.
  system.emitter = anchor as AbstractMesh | Vector3;
  // Stretched along the way it is going, which needs a direction rather than a
  // square facing the camera. Everything else is an ordinary billboard.
  if (particle.shape === 'streak') system.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
  if (particle.raw) system.imageProcessingConfiguration = plainGrading(scene);

  // Above zero it is added to the frame; at zero it is ordinary transparency.
  system.blendMode =
    particle.glow > 0 ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;

  system.minLifeTime = particle.life * 0.7;
  system.maxLifeTime = particle.life;
  system.emitRate = rate;

  rampGradients(system, particle, modifierOf(particle, 'overTime'));

  system.minEmitPower = particle.speed * 0.6;
  system.maxEmitPower = particle.speed;
  system.gravity = new Vector3(0, particle.gravity, 0);

  // Per-particle variation, all as a share of what was authored. Size rides on
  // Babylon's own scale, which multiplies the size ramp rather than replacing
  // it — so particles differ without any of them losing their curve.
  const random = modifierOf(particle, 'randomize');
  if (random) {
    const size = (random.varySize ?? 0) / 100;
    system.minScaleX = system.minScaleY = Math.max(0, 1 - size);
    system.maxScaleX = system.maxScaleY = 1 + size;
    const spread = ((random.varyPosition ?? 0) / 100) * Math.max(emitter.radius, 0.1);
    if (spread > 0) {
      system.minEmitBox = new Vector3(-spread, -spread, -spread);
      system.maxEmitBox = new Vector3(spread, spread, spread);
    }
  }

  const spin = modifierOf(particle, 'spin');
  const wobble = ((random?.varyRotation ?? 0) / 100) * 180;
  system.minAngularSpeed = -(spin?.spin ?? 0) * DEG;
  system.maxAngularSpeed = (spin?.spin ?? 0) * DEG;
  system.minInitialRotation = -((spin?.spinStart ?? 0) + wobble) * DEG;
  system.maxInitialRotation = ((spin?.spinStart ?? 0) + wobble) * DEG;

  useEmitterShape(system, emitter);

  // After the emitter, not before: `createConeEmitter` and its siblings replace
  // `particleEmitterType` outright, and a slash reaches into whatever is there
  // to place its particles as they are born.
  applyMovements(scene, system, modifiersOf(particle, 'movement'), emitter, shape);

  bursts.set(system, burst);
  return system;
}

/**
 * Every effect this game knows, ready to be spawned.
 *
 * @param defs the vfx rule list — the editor passes its unsaved one.
 */
/**
 * How many particles a burst effect releases at once, if it is one.
 *
 * The count lives in a WeakMap keyed by the system rather than on the system
 * itself; the editor's preview replays a burst without rebuilding it, and this
 * is how it asks.
 */
export const burstOf = (system: ParticleSystem): number | undefined => bursts.get(system);

export function createVfxRuntime(scene: Scene, defs: readonly VfxInput[] = VFX) {
  const byId = new Map<string, VfxInput>(defs.map((def) => [def.id ?? '', def]));
  const running = new Set<VfxHandle>();

  const track = (handle: VfxHandle): VfxHandle => {
    running.add(handle);
    return handle;
  };

  /**
   * Sweep up the ones that have finished. Babylon's own `disposeOnStop` would
   * do this for a particle system, except that it disposes the shared sprite
   * along with it — and a sheet has no such thing to lean on at all.
   */
  const sweep = scene.onAfterRenderObservable.add(() => {
    for (const handle of [...running]) {
      if (handle.alive) continue;
      handle.dispose();
      running.delete(handle);
    }
  });

  return {
    has: (id: string): boolean => byId.has(id),

    /** Throw one at a place, once. Null for an id nothing defines. */
    play(
      id: string,
      x: number,
      y: number,
      z: number,
      shape: VfxShape | null = null,
    ): VfxHandle | null {
      const def = byId.get(id);
      return def ? track(spawnVfx(scene, def, new Vector3(x, y, z), { shape })) : null;
    },

    /** Start one that stays. `emitter` is a Vector3 or a node to follow. */
    attach(id: string, emitter: VfxAnchor, shape: VfxShape | null = null): VfxHandle | null {
      const def = byId.get(id);
      return def ? track(spawnVfx(scene, def, emitter, { shape, looping: true })) : null;
    },

    dispose(): void {
      scene.onAfterRenderObservable.remove(sweep);
      for (const handle of [...running]) handle.dispose();
      running.clear();
    },
  };
}

/** Every effect currently playing in one scene. */
export type VfxRuntime = ReturnType<typeof createVfxRuntime>;
