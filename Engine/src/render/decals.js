import { PBRCustomMaterial } from '@babylonjs/materials/custom/pbrCustomMaterial.js';
import { colorOf } from './materials.ts';
import { angleBetween } from '../game/abilities.ts';

/**
 * Shapes painted onto the ground by the ground itself.
 *
 * Nothing is projected onto the world. The world is asked whether it is inside
 * the shape: every material that opts in carries a few extra lines of shader
 * that test each fragment's world position against the list of decals and
 * blend. That makes the result exact at any resolution, costs no CPU per frame
 * and no geometry at all, and answers two questions a projected mesh has to
 * guess at:
 *
 * - vertical faces are skipped because their normal does not point up, so a
 *   shape can never hang down the side of a platform;
 * - walls are not painted because the wall material never opts in.
 *
 * There is deliberately no height limit. `coneHits` tests distance and angle on
 * the grid and ignores height entirely, so a shape that stopped at a ledge
 * would be under-drawing an area that really is about to be tested. What is
 * painted is what will be hit.
 */

/**
 * How many decals can be on screen at once.
 *
 * A fixed size because the shader needs a constant loop bound. Eight is more
 * than the game can currently produce — one telegraph per caster mid-wind-up —
 * and raising it costs uniforms, not draw calls.
 */
export const MAX_DECALS = 8;

/**
 * The shape test, in JavaScript.
 *
 * This is the same predicate as `coneHits` with a target of no width, and the
 * GLSL below is a line-for-line port of it. That relationship is the whole
 * point of the file: what is drawn and what is hit cannot disagree, because
 * they are the same rule — checked against `coneHits` over a grid of sample
 * points in the tests.
 */
export function decalCovers(decal, x, z) {
  const dx = x - decal.gx;
  const dz = z - decal.gy;
  const distance = Math.hypot(dx, dz);
  if (distance > decal.range) return false;
  // Standing on the caster has no direction, exactly as in the hit test.
  if (distance <= 1e-6) return true;
  if (decal.halfArc >= Math.PI) return true;
  return Math.abs(angleBetween(decal.aim, Math.atan2(dx, dz))) <= decal.halfArc;
}

/**
 * The blend, run per fragment just before the colour is written out.
 *
 * `decalShape` is (x, z, range, halfArc) and `decalStyle` is (aim, edge width,
 * fill alpha, edge alpha) — packed into vec4s because uniform slots are the
 * scarce thing here, not arithmetic.
 *
 * `finalColor` is the fragment Babylon is about to write out, and `normalW`
 * and `vPositionW` are the world normal and position it has already computed,
 * which is why there is nothing to inject into the vertex stage.
 *
 * Everything is a signed distance to the shape's boundary, positive inside:
 * `range - d` for the rim and, for a wedge, the arc length to the straight
 * edge. Taking the smaller of the two gives one number describing the whole
 * boundary, which is what lets the border be a real width in tiles and the edge
 * be antialiased against its own screen-space gradient — sharper than geometry,
 * and identical at any zoom.
 */
const blend = (max) => /* glsl */ `

// Cloud shadows, before the decals so a telegraph stays legible on top of one.
//
// Only surfaces you could stand on, the same test the shapes below use — the
// walls are drawn with an ordinary material and never see this, so a shadow
// that climbed one would be a shadow with nowhere to land.
if ( cloudSettings.x > 0.0 && normalW.y > 0.5 ) {
  vec2 across = vPositionW.xz * cloudSettings.y;
  float cover = mercCloudNoise( across + cloudDrift );
  cover = mix( cover, mercCloudNoise( across * 2.17 - cloudDrift * 1.6 ), 0.4 );

  // A wide, soft band: a cloud has an edge, but not one you could point at.
  float shade = smoothstep( 0.42, 0.72, cover ) * cloudSettings.x;
  finalColor.rgb *= 1.0 - shade;
}

for ( int i = 0; i < ${max}; i ++ ) {
  if ( i >= decalCount ) break;

  vec4 shape = decalShape[ i ];
  vec4 style = decalStyle[ i ];

  vec2 offset = vPositionW.xz - shape.xy;
  float dist = length( offset );

  // atan( x, z ) here is atan2( dx, dy ) there: the same heading convention
  // every actor in the game uses.
  float swing = style.x - atan( offset.x, offset.y );
  swing = abs( swing - 6.283185307179586 * floor( ( swing + 3.141592653589793 ) / 6.283185307179586 ) );

  float radial = shape.z - dist;
  // A full circle has no straight edge to measure to.
  float angular = shape.w >= 3.141592653589793 ? radial : ( shape.w - swing ) * dist;
  float signedDistance = min( radial, angular );

  float gradient = max( fwidth( signedDistance ), 1e-5 );
  float inside = smoothstep( 0.0, gradient, signedDistance );
  float border = 1.0 - smoothstep( style.y, style.y + gradient, signedDistance );

  // Only surfaces you could stand on. This is what keeps a shape off the side
  // of a platform without knowing anything about platforms.
  float shapeAlpha = mix( style.z, style.w, border ) * inside * step( 0.5, normalW.y );
  finalColor.rgb = mix( finalColor.rgb, decalColor[ i ], clamp( shapeAlpha, 0.0, 1.0 ) );
}
`;

/**
 * The one material every map's ground is drawn with, per scene.
 *
 * Deliberately not one per map. `PBRCustomMaterial` registers its shader under a
 * fresh name for every instance, and the compiled-effect cache is keyed by that
 * name — so a material rebuilt with each map recompiles a large PBR shader every
 * time, half a second of it, while the walls and props (ordinary materials, so
 * cached) appear immediately. That is what made the floor arrive after
 * everything else on the far side of a portal.
 *
 * Nothing about it varies by map anyway: the albedo is white and the colour of
 * the ground lives in its vertex colours. The only thing that changes is which
 * registry it reads, which is what `source` is for.
 */
const shared = new WeakMap();

/**
 * The registry. One per map: the shapes it holds are flushed into the uniforms
 * of the ground material, so writing a decal once updates the ground, the ramps
 * and anything else drawn with it.
 */
export function createDecals(max = MAX_DECALS) {
  const shapeData = new Float32Array(max * 4);
  const styleData = new Float32Array(max * 4);
  const colorData = new Float32Array(max * 3);
  let count = 0;

  const active = [];

  /**
   * The map's weather. Here rather than in a file of its own because this is
   * already "what the ground paints on itself", and cloud shadows are the same
   * kind of thing as a telegraph: a shape tested against the world position,
   * costing no geometry and no CPU.
   */
  let clouds = { strength: 0, grain: 1 / 14, speed: 0, dx: 0, dy: 0 };
  const drift = { x: 0, y: 0 };

  /** The scene-wide slot this registry writes into while its map is on screen. */
  let slot = null;

  const packed = () => {
    // Read off the clock rather than accumulated, so the sky does not lurch
    // when a frame is slow and does not stop while the tab is in the
    // background — it is weather, and weather is not simulated here.
    const seconds = performance.now() / 1000;
    drift.x = clouds.dx * clouds.speed * seconds * clouds.grain;
    drift.y = clouds.dy * clouds.speed * seconds * clouds.grain;
    return { count, shape: shapeData, style: styleData, color: colorData, clouds: { ...clouds, drift } };
  };

  /**
   * A PBR material with the decal and cloud test compiled into it.
   *
   * Lifted out of `material` so that blocks can have one each. Babylon picks
   * the shader from the material, so opting in *is* being built here — which
   * is why the wall material, an ordinary PBRMaterial, can never have a
   * telegraph smear up it: there is no test in its shader to get wrong.
   */
  function build(name, scene, { color = 0xffffff, roughness = 0.9, metallic = 0 } = {}) {
    const material = new PBRCustomMaterial(name, scene);
    material.albedoColor = colorOf(color);
    material.roughness = roughness;
    material.metallic = metallic;
    material.environmentIntensity = 0;

    material.AddUniform('cloudSettings', 'vec2');
    material.AddUniform('cloudDrift', 'vec2');
    material.AddUniform('decalCount', 'int');
    material.AddUniform(`decalShape[${max}]`, 'vec4');
    material.AddUniform(`decalStyle[${max}]`, 'vec4');
    material.AddUniform(`decalColor[${max}]`, 'vec3');

    material.Fragment_Definitions(`
/**
 * Value noise, and enough of it to look like weather.
 *
 * Two octaves rather than five: this is a soft shadow crossing a field, and
 * the detail a third octave adds is detail nobody can see through a blur that
 * wide. The second is offset and drifts at its own rate, which is what stops
 * the pattern reading as one shape sliding across the map.
 */
float mercCloudHash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}

float mercCloudNoise( vec2 p ) {
  vec2 cell = floor( p );
  vec2 part = fract( p );
  // Smoothstep between the corners, so the cell grid never shows as creases.
  vec2 blend = part * part * ( 3.0 - 2.0 * part );
  return mix(
mix( mercCloudHash( cell ), mercCloudHash( cell + vec2( 1.0, 0.0 ) ), blend.x ),
mix( mercCloudHash( cell + vec2( 0.0, 1.0 ) ), mercCloudHash( cell + vec2( 1.0, 1.0 ) ), blend.x ),
blend.y
  );
}
`);
    // After lighting and fog, so a telegraph stays legible in a dark room
    // and at the far edge of the map — which is exactly when it matters
    // most.
    material.Fragment_Before_FragColor(blend(max));
    return material;
  }

  /** Feed one material the registry's arrays, every time it is drawn. */
  function bindTo(material, source) {
    material.onBindObservable.add(() => {
      const effect = material.getEffect();
      const from = source();
      if (!effect || !from) return;
      effect.setFloat2('cloudSettings', from.clouds.strength, from.clouds.grain);
      effect.setFloat2('cloudDrift', from.clouds.drift.x, from.clouds.drift.y);
      effect.setInt('decalCount', from.count);
      effect.setArray4('decalShape', from.shape);
      effect.setArray4('decalStyle', from.style);
      effect.setArray3('decalColor', from.color);
    });
  }

  return {
    get count() {
      return active.length;
    },

    /** Everything currently being drawn, in the order it will be written. */
    get active() {
      return active;
    },

    /**
     * Exactly what the shader will read on the next draw.
     *
     * The arrays are live and shared with the ground material, so this is the
     * registry's actual output rather than a copy of it — which is the only
     * reason it is worth looking at.
     */
    get packed() {
      return packed();
    },

    /**
     * The material a paintable surface is drawn with, and this registry as the
     * list it reads.
     *
     * A material rather than a patch applied to one: Babylon picks the shader
     * from the material's class, so opting in is a matter of which material a
     * mesh was given. The wall material is deliberately an ordinary PBRMaterial,
     * which is why a telegraph can never smear itself up a wall — there is no
     * test in the shader to get wrong.
     *
     * Built once per scene and handed out again after that, so its shader is
     * compiled once for the life of the application rather than once per map.
     * The settings of the first caller are the ones that stick; every map asks
     * for the same ones.
     */
    material(name, scene, { color = 0xffffff, roughness = 0.9, metallic = 0 } = {}) {
      slot = shared.get(scene);

      if (!slot) {
        const material = build(name, scene, { color, roughness, metallic });
        slot = { material, source: null };

        bindTo(material, () => slot.source?.());

        shared.set(scene, slot);
      }

      slot.source = packed;
      return slot.material;
    },

    /**
     * Another paintable surface, with its own colour and texture.
     *
     * The ground material above is one per scene because there is one ground.
     * Blocks are not: a map is built out of several kinds, each with its own
     * look, and every one of them is ground you can be standing on when a
     * telegraph is drawn under you. So they get a material each, all reading
     * the same registry — which is what the shader was always written for, and
     * why opting in is a property of the material rather than of the mesh.
     *
     * Owned by the caller: it is built per map and disposed with it, unlike the
     * ground's, which outlives every map.
     */
    paintable(name, scene, { color = 0xffffff, roughness = 0.9, metallic = 0 } = {}) {
      // The scene's slot has to exist first: it is what the bound uniforms are
      // read out of, and the ground is not guaranteed to have asked yet.
      if (!shared.get(scene)) this.material(`${name}:ground`, scene);
      const here = shared.get(scene);

      const material = build(name, scene, { color, roughness, metallic });
      bindTo(material, () => here.source?.());
      return material;
    },

    /**
     * Become the list the ground reads.
     *
     * The material outlives every map, so coming back to one — stepping out of
     * the editor, say — has to point it at this registry again, or the ground
     * would still be painting the shapes of a map that is no longer on screen.
     */
    use() {
      if (slot) slot.source = packed;
    },

    /**
     * The cloud shadows crossing this map.
     *
     * `scale` is how many tiles across one cloud is, so it is written in the
     * same units as everything else on a map rather than as a frequency; the
     * shader wants its reciprocal, which is the one place that conversion
     * happens. A strength of 0 switches the whole thing off in the shader, so a
     * map without weather pays for a compare and nothing else.
     */
    setClouds({ strength = 0, scale = 14, speed = 0, angle = 45 } = {}) {
      const heading = (angle * Math.PI) / 180;
      clouds = {
        strength: Math.max(0, strength),
        grain: 1 / Math.max(0.5, scale),
        speed,
        dx: Math.sin(heading),
        dy: Math.cos(heading),
      };
    },

    /**
     * Start drawing a shape. The returned object is live: move it, recolour it
     * and change its alpha in place, and the next `sync` picks it up.
     */
    add({ gx = 0, gy = 0, aim = 0, range = 1, halfArc = Math.PI, edge = 0.09 }) {
      const decal = {
        gx,
        gy,
        aim,
        range,
        halfArc,
        edge,
        alpha: 0,
        edgeAlpha: 0,
        // Plain floats rather than a Babylon colour: this goes straight into a
        // Float32Array, and debug.js fades between two of them by hand.
        color: { r: 1, g: 1, b: 1 },
      };
      active.push(decal);
      return decal;
    },

    remove(decal) {
      const at = active.indexOf(decal);
      if (at >= 0) active.splice(at, 1);
      return at >= 0;
    },

    clear() {
      active.length = 0;
      count = 0;
    },

    /**
     * Flush the list into the uniform arrays. Called once a frame, after
     * everything that owns a decal has had its turn to move one.
     *
     * Anything past the limit is dropped rather than queued: a decal the shader
     * cannot draw this frame is one nobody will miss, and silently shifting
     * which shapes are visible would be worse than the cap.
     */
    sync() {
      count = Math.min(active.length, max);
      for (let i = 0; i < count; i++) {
        const decal = active[i];
        shapeData.set([decal.gx, decal.gy, decal.range, decal.halfArc], i * 4);
        styleData.set([decal.aim, decal.edge, decal.alpha, decal.edgeAlpha], i * 4);
        colorData.set([decal.color.r, decal.color.g, decal.color.b], i * 3);
      }
      return count;
    },
  };
}
