import { ATTRIBUTES, normalizeAttribute } from '../data/attributes.ts';

/**
 * One actor's attributes.
 *
 * A stat is `base` plus whatever modifiers are layered on it. The base is never
 * mutated by a modifier — that is what makes a buff removable without drift,
 * because removing it simply drops out of the sum rather than trying to undo
 * an edit.
 *
 *   value = (base + Σ add) × Π (1 + multiply),  then an override wins outright,
 *   clamped to [min, max]
 *
 * A resource is a pool whose *maximum* is that same computed value. The current
 * level is an absolute number, and when the maximum moves the pool moves with
 * it by the same amount: +50 maximum health is +50 health in hand, right now,
 * and losing the buff takes both back. That is what an ARPG does, and it is
 * what makes a maximum-health buff worth drinking mid-fight rather than a
 * percentage adjustment that hands you nothing until you heal.
 *
 * Tracking that means remembering the maximum the pool was last reconciled
 * against, since the maximum is computed lazily and can move several times
 * between two reads.
 *
 * Recomputation is dirty-flagged rather than eager: modifiers change rarely and
 * values are read every frame by several systems.
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function createAttributeSet(defs = ATTRIBUTES, overrides = {}) {
  const slots = new Map();

  for (const raw of defs) {
    const def = normalizeAttribute(raw);
    slots.set(def.id, {
      def,
      base: overrides[def.id] ?? def.base,
      mods: [],
      cached: 0,
      dirty: true,
      // Both null until the first recompute, which starts a resource full.
      pool: null,
      lastMax: null,
    });
  }

  function recompute(slot) {
    let added = 0;
    let scale = 1;
    let override = null;

    for (const mod of slot.mods) {
      if (mod.op === 'multiply') scale *= 1 + mod.value;
      else if (mod.op === 'override') override = mod.value;
      else added += mod.value;
    }

    const raw = override === null ? (slot.base + added) * scale : override;
    slot.cached = clamp(raw, slot.def.min, slot.def.max);
    slot.dirty = false;

    if (slot.def.kind !== 'resource') return;

    if (slot.pool === null) {
      slot.pool = slot.cached; // a fresh actor starts full
    } else {
      // Whatever the maximum gained or lost, the pool gained or lost too.
      slot.pool = clamp(slot.pool + (slot.cached - slot.lastMax), 0, slot.cached);
    }
    slot.lastMax = slot.cached;
  }

  function slotOf(id) {
    return slots.get(id) ?? null;
  }

  /** A stat's value, or a resource's maximum. */
  function value(id) {
    const slot = slotOf(id);
    if (!slot) return 0;
    if (slot.dirty) recompute(slot);
    return slot.cached;
  }

  function isResource(slot) {
    return slot.def.kind === 'resource';
  }

  /** A resource's current level. For a stat this is just its value. */
  function current(id) {
    const slot = slotOf(id);
    if (!slot) return 0;
    // Read the maximum first: that is what reconciles the pool against any
    // modifier added since the last read.
    const max = value(id);
    return isResource(slot) ? slot.pool : max;
  }

  function setCurrent(id, next) {
    const slot = slotOf(id);
    if (!slot || !isResource(slot)) return 0;
    const max = value(id);
    slot.pool = clamp(next, 0, max);
    slot.lastMax = max;
    return slot.pool;
  }

  return {
    get ids() {
      return [...slots.keys()];
    },

    has: (id) => slots.has(id),
    definition: (id) => slotOf(id)?.def ?? null,
    value,
    current,
    setCurrent,

    /** Permanently change what a stat is built from. Used by instant effects. */
    setBase(id, next) {
      const slot = slotOf(id);
      if (!slot) return;
      slot.base = next;
      slot.dirty = true;
    },

    base: (id) => slotOf(id)?.base ?? 0,

    /**
     * Move a value permanently — a damage tick, a potion. Returns the amount
     * that was *actually* applied, which is smaller than asked for when the
     * change clips against a bound, so a caller can report a real number.
     */
    applyDelta(id, amount) {
      const slot = slotOf(id);
      if (!slot || !Number.isFinite(amount)) return 0;

      if (isResource(slot)) {
        const before = current(id);
        return setCurrent(id, before + amount) - before;
      }

      const before = value(id);
      slot.base += amount;
      slot.dirty = true;
      return value(id) - before;
    },

    /**
     * Layer a removable modifier. `value` is already resolved to a number by
     * the caller; `source` is whatever owns it, so it can all be dropped at
     * once when a run ends.
     */
    addModifier({ attribute, op = 'add', value: amount, source = null }) {
      const slot = slotOf(attribute);
      if (!slot) return null;
      const mod = { attribute, op, value: amount, source };
      slot.mods.push(mod);
      slot.dirty = true;
      return mod;
    },

    /**
     * Change what a modifier contributes, keeping its place in the stack.
     * Removing and re-adding would say the same thing, but this is what lets a
     * modifier be animated frame by frame without churning the list.
     */
    setModifier(mod, amount) {
      const slot = mod ? slotOf(mod.attribute) : null;
      if (!slot || !slot.mods.includes(mod)) return false;
      mod.value = amount;
      slot.dirty = true;
      return true;
    },

    removeModifier(mod) {
      const slot = mod ? slotOf(mod.attribute) : null;
      if (!slot) return false;
      const index = slot.mods.indexOf(mod);
      if (index < 0) return false;
      slot.mods.splice(index, 1);
      slot.dirty = true;
      return true;
    },

    /** Drop everything one source contributed. The end of a roguelike run. */
    removeBySource(source) {
      let removed = 0;
      for (const slot of slots.values()) {
        const kept = slot.mods.filter((mod) => mod.source !== source);
        removed += slot.mods.length - kept.length;
        if (kept.length !== slot.mods.length) {
          slot.mods = kept;
          slot.dirty = true;
        }
      }
      return removed;
    },

    /** Flat read-out for the HUD and the editor. */
    snapshot() {
      const out = {};
      for (const [id, slot] of slots) {
        out[id] = { value: value(id), current: current(id), kind: slot.def.kind };
      }
      return out;
    },
  };
}
