import { ABILITIES as GAME_ABILITIES } from '#game/rules/abilities.js';

/**
 * Abilities: what decides *when* an effect happens and *where* it lands.
 *
 * An effect already says what happens to an attribute. An ability adds the
 * three things it cannot: a cooldown and a cost that gate when it may fire, a
 * targeting shape that decides who is hit, and a list of effects to hand to
 * whatever it finds. Adding a new attack is therefore data, not code.
 *
 * `target` picks which fields exist, exactly as an effect's `duration` does,
 * so the editor renders an ability with no UI code of its own.
 *
 * Note `cooldownRate`. A flat cooldown would quietly throw away the way the
 * basic attack scales with attackSpeed, so a cooldown may be divided by an
 * attribute:
 *
 *     seconds = cooldown / max(0.05, cooldownRate ? value(cooldownRate) : 1)
 *
 * The basic attack is then "1 second, divided by attackSpeed" — identical to
 * the hardcoded behaviour it replaces — and any ability can scale off any
 * attribute the same way.
 */

/**
 * How long using *any* ability holds *every* ability, in seconds.
 *
 * One timer for the whole bar, not a tax on each slot. Firing the left button
 * stops the right one for this long too, so the shortest possible gap between
 * two actions is this whatever they are.
 *
 * It exists because an ability is re-attempted every frame its button is held.
 * Without it a cooldown of zero would not mean "fires quickly", it would mean
 * "fires sixty times a second" — a rate set by the frame rate, which is not
 * something anyone should be balancing against. It also stops three held
 * buttons all going off on the same frame.
 *
 * Deliberately not added to each ability's own cooldown as well: an ability
 * that is off for a second has already sat out this tenth inside that second,
 * and charging for it twice would make every cooldown in the game 0.1 longer
 * than the number written next to it.
 */
export const GLOBAL_COOLDOWN = 0.1;

/** Who an ability hands one of its effects to. */
export const EFFECT_TARGETS = [
  ['target', 'what it hits'],
  ['self', 'the caster'],
] as const;

/** Who an ability hands one of its effects to. */
export type EffectTarget = (typeof EFFECT_TARGETS)[number][0];

/**
 * What sets an ability's direction.
 *
 * `cursor` turns the caster to the pointer and fires that way — right for
 * anything you place deliberately. `facing` uses the way the body is already
 * pointing, which for the player is the direction they are walking, so a dash
 * carries you where you are already going instead of where you happen to be
 * looking.
 */
const AIM_SOURCES = [
  ['cursor', 'the cursor'],
  ['facing', 'the way it faces'],
] as const;

/** What sets an ability's direction. */
export type AimSource = (typeof AIM_SOURCES)[number][0];

/** Whether an ability fires at once or winds up first. */
export type CastMode = 'instant' | 'timed';

/**
 * The wind-up fields, in the order they read.
 *
 * `cast` decides which of the rest exist — see `abilityFields` — the same way
 * an effect's duration does: an instant ability has no wind-up to time or to
 * be slowed by, and only an instant one can arrive while something else is
 * winding up, so only it has anything to say about cancelling that.
 */
const CASTING = ['aimedBy', 'cast', 'castTime', 'castSlow', 'castTurn', 'interrupts'] as const;

export const TARGET_TYPES = {
  melee: {
    label: 'Melee',
    icon: 'sword',
    hint: 'A wedge in front of the caster. Hits everything hostile inside it at once.',
    fields: [
      'label',
      'target',
      'range',
      'arc',
      ...CASTING,
      'vfx',
      'cooldown',
      'cooldownRate',
      'costAttribute',
      'cost',
    ],
  },
  projectile: {
    label: 'Projectile',
    icon: 'target-arrow',
    hint: 'Travels from the caster until it hits something hostile, meets a wall, or runs out of range.',
    fields: [
      'label',
      'target',
      'range',
      'speed',
      'size',
      ...CASTING,
      'vfx',
      'trail',
      'cooldown',
      'cooldownRate',
      'costAttribute',
      'cost',
    ],
  },
  combo: {
    label: 'Combo',
    icon: 'swords',
    hint: 'Plays its steps in order, one per press: swing, swipe, slam. Each step is an ordinary ability and pays its own cast time, cost and cooldown; this cooldown starts only once the last step has fired.',
    fields: [
      'label',
      'target',
      'stepGap',
      'chainWindow',
      'vfx',
      'cooldown',
      'cooldownRate',
      'costAttribute',
      'cost',
    ],
  },

  dash: {
    label: 'Movement',
    icon: 'run',
    hint: 'Carries the caster along the aim. Walls and ledges stop it exactly as they stop walking, so it cannot cross anything you could not walk across.',
    fields: [
      'label',
      'target',
      'range',
      'speed',
      ...CASTING,
      'vfx',
      'cooldown',
      'cooldownRate',
      'costAttribute',
      'cost',
    ],
  },
} as const;

/** Which shape an ability is. The four `TARGET_TYPES` keys and no others. */
export type TargetType = keyof typeof TARGET_TYPES;

export const isTargetType = (value: unknown): value is TargetType =>
  typeof value === 'string' && value in TARGET_TYPES;

/** One effect an ability applies, and who to. */
export type EffectEntry = { effect: string; to: EffectTarget };

/** An effect entry as a rules file writes it: an id on its own means the target. */
export type EffectEntryInput = string | { effect?: string; to?: string };

export type Ability = {
  id: string;
  label: string;
  target: TargetType;
  range: number;
  arc: number;
  speed: number;
  size: number;
  aimedBy: AimSource;
  cast: CastMode;
  castTime: number;
  castSlow: number;
  castTurn: number;
  interrupts: boolean;
  stepGap: number;
  chainWindow: number;
  cooldown: number;
  /** Attribute id the cooldown is divided by, or empty for a flat one. */
  cooldownRate: string;
  vfx: string;
  trail: string;
  costAttribute: string;
  cost: number;
  effects: EffectEntry[];
  /** Ability ids a combo plays in order. Empty for every other shape. */
  steps: string[];
};

/**
 * A fresh ability, carrying only the fields a melee one has.
 *
 * The rest arrive in `normalizeAbility`, which is also where a shape that has
 * no use for them gets them zeroed -- see the notes there.
 */
export type NewAbility = Omit<
  Ability,
  'speed' | 'size' | 'trail' | 'stepGap' | 'chainWindow' | 'steps'
>;

/** An ability as a rules file writes it. */
export type AbilityInput = {
  id?: string;
  label?: string;
  target?: string;
  range?: number;
  arc?: number;
  speed?: number;
  size?: number;
  aimedBy?: string;
  cast?: string;
  castTime?: number;
  castSlow?: number;
  castTurn?: number;
  interrupts?: boolean;
  stepGap?: number;
  chainWindow?: number;
  cooldown?: number;
  cooldownRate?: string;
  vfx?: string;
  trail?: string;
  costAttribute?: string;
  cost?: number;
  effects?: readonly EffectEntryInput[];
  steps?: readonly string[];
};

export const ABILITY_FIELDS = {
  label: { kind: 'text', label: 'Name', default: 'New ability' },
  target: {
    kind: 'select',
    label: 'Shape',
    options: Object.entries(TARGET_TYPES).map(([id, spec]) => [id, spec.label]),
    default: 'melee',
  },
  range: { kind: 'range', label: 'Range (tiles)', min: 0.5, max: 20, step: 0.1, default: 1.2 },
  arc: { kind: 'range', label: 'Arc (degrees)', min: 5, max: 360, step: 5, default: 120 },
  speed: { kind: 'range', label: 'Speed (tiles/sec)', min: 1, max: 40, step: 0.5, default: 12 },
  size: { kind: 'range', label: 'Size (tiles)', min: 0.02, max: 2, step: 0.02, default: 0.18 },
  aimedBy: {
    kind: 'select',
    label: 'Aimed by',
    options: AIM_SOURCES,
    default: 'cursor',
  },
  // Instant or timed. Two abilities that differ in nothing else behave very
  // differently here: a timed one is committed the moment it starts and holds
  // the caster until it lands, and an instant one can go off *during* someone
  // else's wind-up, which is what makes a quick interrupt possible at all.
  cast: {
    kind: 'select',
    label: 'Cast',
    options: [
      ['instant', 'Instant'],
      ['timed', 'Timed'],
    ],
    default: 'instant',
  },
  // Wind-up. The effects land when this runs out, not when the button goes
  // down. Only a timed ability has one.
  castTime: { kind: 'range', label: 'Cast time (sec)', min: 0.05, max: 5, step: 0.05, default: 0.5 },
  // Whether firing this cancels a wind-up already in progress. An instant
  // ability is allowed to go off mid-cast either way; this is whether the cast
  // survives it — a shout that cuts your own channel short, against a step you
  // can take without losing it.
  interrupts: { kind: 'bool', label: 'Cancels a cast in progress', default: false },
  // How much of the caster's move speed the wind-up takes away. 0 lets them
  // walk normally while casting; 1 roots them for the duration.
  castSlow: { kind: 'range', label: 'Slowed while casting', min: 0, max: 1, step: 0.05, default: 0 },
  // How fast the caster may still turn during the wind-up, in degrees per
  // second — and with them, the ability they are winding up. 0 commits the
  // direction at the moment of pressing; a high number lets it be steered onto
  // a moving target right up until it lands. This is the dial that separates a
  // heavy swing you have to aim from a quick one you can follow through.
  castTurn: { kind: 'range', label: 'Turn while casting (deg/sec)', min: 0, max: 720, step: 15, default: 180 },
  // This slot's own wait. 0 is legitimate and means "as often as the shared
  // GLOBAL_COOLDOWN allows", not "every frame".
  // Recovery between the steps of a combo: how long after one lands before the
  // next may be started. Zero means the chain is paced by the steps themselves
  // — their wind-ups and the shared global cooldown — which is where a combo
  // starts before anyone tunes it.
  stepGap: { kind: 'range', label: 'Between steps (sec)', min: 0, max: 5, step: 0.05, default: 0 },
  // How long a combo waits for the next press before it drops back to its
  // first step. Not a cooldown: nothing is blocked while it runs down, the
  // chain only forgets where it had got to.
  chainWindow: { kind: 'range', label: 'Chain window (sec)', min: 0.1, max: 5, step: 0.05, default: 1 },
  cooldown: { kind: 'range', label: 'Cooldown (sec)', min: 0, max: 20, step: 0.05, default: 1 },
  // Empty means "do not scale": the cooldown is used as written.
  cooldownRate: { kind: 'attribute', label: 'Cooldown divided by', default: '' },
  // The puff of particles this throws when it lands, named out of the vfx
  // list. Empty is no effect at all, which is where every ability starts.
  vfx: { kind: 'vfx', label: 'Effect', default: '' },
  // What the shot leaves behind it on the way. Emitted from the body itself,
  // so the effect's own height is ignored — the shot is already flying at the
  // height it flies at, and a trail hanging above it is not a trail. It stops
  // emitting where the shot lands and the tail fades out there.
  trail: { kind: 'vfx', label: 'Trail', default: '' },
  costAttribute: { kind: 'attribute', label: 'Costs', default: '' },
  cost: { kind: 'range', label: 'Amount', min: 0, max: 100, step: 1, default: 0 },
} as const;

/**
 * Which fields an ability actually has: its shape's, minus the wind-up ones
 * that its cast mode does not use.
 *
 * Here rather than in the editor because it is a fact about the ability, not
 * about the panel — the same reason `TARGET_TYPES` lives here at all.
 */
export function abilityFields(def?: AbilityInput): string[] {
  const fields = isTargetType(def?.target)
    ? TARGET_TYPES[def.target].fields
    : TARGET_TYPES.melee.fields;
  const instant = def?.cast !== 'timed';
  return (fields as readonly string[]).filter((key) => {
    if (key === 'castTime' || key === 'castSlow' || key === 'castTurn') return !instant;
    if (key === 'interrupts') return instant;
    return true;
  });
}

export function defaultAbility(id = 'newAbility'): NewAbility {
  const ability = { id } as NewAbility;
  for (const key of TARGET_TYPES.melee.fields) {
    (ability as Record<string, unknown>)[key] = ABILITY_FIELDS[key].default;
  }
  return { ...ability, effects: [] };
}

/**
 * An effect entry is `{ effect, to }`. A bare string is read as an effect aimed
 * at the target, which is what every ability meant before self-application
 * existed.
 */
export function normalizeEffectEntry(entry: EffectEntryInput): EffectEntry {
  if (typeof entry === 'string') return { effect: entry, to: 'target' };
  return { effect: entry?.effect ?? '', to: entry?.to === 'self' ? 'self' : 'target' };
}

export function normalizeAbility(def: AbilityInput): Ability {
  const target: TargetType = isTargetType(def.target) ? def.target : 'melee';
  // Written before the switch existed: a wind-up is what made it timed.
  const castMode: CastMode =
    (def.cast ?? ((def.castTime ?? 0) > 0 ? 'timed' : 'instant')) === 'timed'
      ? 'timed'
      : 'instant';
  return {
    ...defaultAbility(def.id ?? 'newAbility'),
    // Fields the default shape (melee) does not carry, so a projectile read
    // from a hand-written file is never missing its speed.
    speed: ABILITY_FIELDS.speed.default,
    size: ABILITY_FIELDS.size.default,
    trail: ABILITY_FIELDS.trail.default,
    chainWindow: ABILITY_FIELDS.chainWindow.default,
    stepGap: ABILITY_FIELDS.stepGap.default,
    ...def,
    target,
    aimedBy: def.aimedBy === 'facing' ? 'facing' : 'cursor',
    cast: castMode,
    // The mode is what decides, not the number: an ability switched back to
    // instant with a cast time still written next to it is instant, and one
    // written before the switch existed is timed if it had a wind-up.
    castTime: castMode === 'timed' ? Math.max(0.05, def.castTime ?? 0) : 0,
    castSlow: castMode === 'timed' ? Math.min(1, Math.max(0, def.castSlow ?? 0)) : 0,
    castTurn: castMode === 'timed' ? Math.max(0, def.castTurn ?? ABILITY_FIELDS.castTurn.default) : 0,
    interrupts: castMode === 'instant' && Boolean(def.interrupts),
    effects: (def.effects ?? []).map(normalizeEffectEntry),
    // Carried by every ability so nothing has to check the shape before
    // reading it; only a combo ever has anything in it.
    steps: (def.steps ?? []).filter(Boolean),
  };
}

export function abilityMap(defs: readonly AbilityInput[] = ABILITIES): Map<string, Ability> {
  return new Map(defs.map((def) => [def.id ?? 'newAbility', normalizeAbility(def)]));
}

/** Left unnormalized: the rules editor reads this straight into what it saves. */
export const ABILITIES = GAME_ABILITIES as AbilityInput[];

/**
 * Which input fires slot n. Order on the archetype *is* the binding, so this
 * table is the only place that mapping lives — the HUD labels from it and the
 * input handler dispatches from it.
 */
/**
 * The five slots, and what presses each.
 *
 * The length of this list *is* how many slots there are: the bar draws one per
 * binding whether or not anything is in it, and a loadout is exactly this long.
 * Adding a sixth is a line here.
 */
/** One input a slot answers to: a mouse button, or a key. */
export type SlotBinding = { label: string; button?: number; code?: string };

export const SLOT_BINDINGS: SlotBinding[] = [
  { label: 'LMB', button: 0 },
  { label: 'RMB', button: 2 },
  { label: '1', code: 'Digit1' },
  { label: '2', code: 'Digit2' },
  { label: '3', code: 'Digit3' },
];
