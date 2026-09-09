import { EFFECTS, effectMap } from '../data/effects.ts';
import { runExecution } from './executions/index.js';

/**
 * The effect runtime: applies effects to actors, ticks the periodic ones, and
 * strips the temporary ones when they expire.
 *
 * Everything here turns on one distinction, spelled out in data/effects.js:
 * an effect either *executes* (instant and periodic — a permanent change to the
 * underlying value, nothing to undo) or *modifies* (duration and infinite with
 * no interval — removable modifiers that never touch the base). Mixing the two
 * is how buffs end up either immortal or refunded twice.
 */

// Timers are floating point, so a tick that should land exactly on the boundary
// can miss it by an ulp. Without this slack a 1-second interval stepped at
// 1/60s drifts by a whole tick every few seconds.
const EPSILON = 1e-9;

// A frame long enough to owe more ticks than this has stalled; catching up on
// hundreds at once would be a spike, and the dt clamp upstream means it should
// never happen anyway.
const MAX_CATCHUP = 64;

export function createEffectRuntime(defs = EFFECTS) {
  const byId = effectMap(defs);
  let instances = [];

  /**
   * A magnitude is a literal or a live reading of an attribute. Executions call
   * this on every tick, so an upgrade that raises healthRegen is picked up by
   * an already-running regen effect on its very next tick.
   */
  function resolve(magnitude, target, source) {
    if (!magnitude) return 0;
    if (magnitude.type === 'attribute') {
      const from = magnitude.from === 'source' ? source : target;
      const value = from?.attrs?.value(magnitude.attribute) ?? 0;
      return value * (magnitude.coefficient ?? 1);
    }
    return magnitude.value ?? 0;
  }

  /** A permanent application: instant effects and every periodic tick. */
  function execute(def, target, source) {
    const results = [];

    if (def.execution) {
      const result = runExecution(def.execution, { target, source, resolve });
      if (result) results.push(result);
    }

    for (const mod of def.modifiers) {
      const amount = resolve(mod.magnitude, target, source);
      if (mod.op === 'override') {
        target.attrs.setBase(mod.attribute, amount);
      } else if (mod.op === 'multiply') {
        // Scaling a value permanently means moving it by the difference.
        target.attrs.applyDelta(mod.attribute, target.attrs.value(mod.attribute) * amount);
      } else {
        target.attrs.applyDelta(mod.attribute, amount);
      }
    }

    return results;
  }

  function detach(instance) {
    for (const handle of instance.handles) instance.target.attrs.removeModifier(handle);
    instance.handles.length = 0;
  }

  return {
    get active() {
      return instances;
    },

    /**
     * Put an effect on an actor. `source` is whoever caused it, defaulting to
     * the target itself for self-applied things like regen.
     *
     * Returns the live instance, or null for an instant effect (which leaves
     * nothing behind to hold on to).
     */
    apply(effectId, target, source = target) {
      const def = byId.get(effectId);
      if (!def || !target?.attrs) return null;

      if (def.duration === 'instant') {
        execute(def, target, source);
        return null;
      }

      // Not stackable: a second application refreshes the timer of the one
      // already running rather than adding a duplicate.
      if (!def.stackable) {
        const existing = instances.find(
          (i) => i.def.id === def.id && i.target === target && i.source === source,
        );
        if (existing) {
          existing.remaining = def.duration === 'infinite' ? Infinity : def.seconds;
          return existing;
        }
      }

      const instance = {
        def,
        target,
        source,
        remaining: def.duration === 'infinite' ? Infinity : def.seconds,
        tickIn: def.interval > 0 ? def.interval : Infinity,
        handles: [],
      };

      // Periodic effects execute on a timer; non-periodic ones go live now.
      if (!(def.interval > 0)) {
        for (const mod of def.modifiers) {
          const handle = target.attrs.addModifier({
            attribute: mod.attribute,
            op: mod.op,
            value: resolve(mod.magnitude, target, source),
            source: instance,
          });
          if (handle) instance.handles.push(handle);
        }
      }

      instances.push(instance);
      return instance;
    },

    remove(instance) {
      const index = instances.indexOf(instance);
      if (index < 0) return false;
      detach(instance);
      instances.splice(index, 1);
      return true;
    },

    /** Everything one actor caused — the end of a roguelike run. */
    removeBySource(source) {
      const kept = [];
      for (const instance of instances) {
        if (instance.source === source) detach(instance);
        else kept.push(instance);
      }
      const removed = instances.length - kept.length;
      instances = kept;
      return removed;
    },

    /** Everything riding on one actor. Call this when it dies. */
    removeByTarget(target) {
      const kept = [];
      for (const instance of instances) {
        if (instance.target === target) detach(instance);
        else kept.push(instance);
      }
      const removed = instances.length - kept.length;
      instances = kept;
      return removed;
    },

    update(dt) {
      if (!instances.length) return;
      const expired = [];

      for (const instance of instances) {
        const { def } = instance;
        instance.remaining -= dt;

        if (def.interval > 0) {
          instance.tickIn -= dt;
          let catchup = 0;
          // Accumulating the remainder rather than resetting to the interval is
          // what keeps the tick rate independent of frame rate: sixty 1/60s
          // steps owe exactly the same ticks as one 1s step.
          while (instance.tickIn <= EPSILON && catchup++ < MAX_CATCHUP) {
            execute(def, instance.target, instance.source);
            instance.tickIn += def.interval;
          }
        }

        if (instance.remaining <= 0) expired.push(instance);
      }

      for (const instance of expired) {
        detach(instance);
        const index = instances.indexOf(instance);
        if (index >= 0) instances.splice(index, 1);
      }
    },
  };
}
