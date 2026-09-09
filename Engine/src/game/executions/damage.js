/**
 * Damage, with mitigation.
 *
 * This is why executions exist at all. Armor cannot be expressed as a modifier
 * on health: the amount depends on two attributes belonging to two different
 * actors, and the reduction has to happen between the attacker's number and the
 * target's pool rather than on either side of it. Forcing that through the
 * modifier system takes hacks; giving it a named calculation does not.
 *
 *   mitigated = amount × 100 / (100 + resist)
 *
 * The ratio form never divides by zero and never turns resist into flat
 * immunity — 100 armor halves incoming damage, 300 quarters it, and no value
 * reaches zero. Flat subtraction does both of those things wrong.
 */

export const damage = {
  label: 'Damage',

  run({ target, source, params, resolve }) {
    const amount = resolve(params.magnitude, target, source);
    if (!(amount > 0)) return { dealt: 0, killed: false };

    const resist = target.attrs.value(params.school === 'magic' ? 'magicResist' : 'armor');
    const mitigated = (amount * 100) / (100 + Math.max(0, resist));

    // applyDelta reports what it could actually take off, so an overkill hit
    // reports the health that was really there rather than the swing.
    const dealt = -target.attrs.applyDelta('health', -mitigated);

    // Guarded on `alive` so a corpse struck again never reports a second kill.
    const killed = target.alive && target.attrs.current('health') <= 0;
    if (killed) target.alive = false;

    return { dealt, killed };
  },
};
