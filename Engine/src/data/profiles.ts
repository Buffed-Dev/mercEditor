import { PROFILES as GAME_PROFILES } from '#game';

/**
 * Edge profiles: what the side of a block is *shaped* like, apart from what it
 * is made of.
 *
 * A terrain says what ground is made of (grass on top, dirt down the side) and
 * names a default profile; a profile says what an exposed edge looks like (a
 * soft slope, a hard cliff, a vertical wall) as a small kit of explicitly
 * assigned models. Grass, sand and snow can all wear the same Soft Slope.
 *
 * ## The kit
 *
 * Every piece is a complete 1×1 block with its own top: the tile spans
 * -0.5..0.5 on x and z, its walkable top is y = 0 and one level hangs below it
 * to y = -LEVEL_H. Each is modelled in one canonical orientation, and the
 * renderer turns it a quarter at a time to face the way the tile needs:
 *
 *   edge         a tile with its EAST side exposed (+x)
 *   outerCorner  its EAST and NORTH sides exposed (+x and -z)
 *   innerCorner  no side exposed, but the NORTH-EAST diagonal drops away
 *   corridor     EAST and WEST exposed (optional)
 *   cap          everything but SOUTH exposed (optional)
 *   single       all four exposed (optional)
 *
 * A tile needing a piece its profile does not have is drawn as the generated
 * block instead. There is exactly one model per slot: nothing is random.
 *
 * ## Corners between two profiles
 *
 * A corner is shared by two edges, and the two may use different profiles.
 * The profile with the higher `priority` owns the corner, and draws its own
 * corner piece — unless it lists a `transitions` entry for the other profile,
 * which names the corner to use for exactly that pair.
 */

export const PROFILE_FIELDS = {
  edge: { kind: 'file', accept: 'mesh', label: 'Edge' },
  outerCorner: { kind: 'file', accept: 'mesh', label: 'Outer corner' },
  innerCorner: { kind: 'file', accept: 'mesh', label: 'Inner corner' },
  corridor: { kind: 'file', accept: 'mesh', label: 'Corridor' },
  cap: { kind: 'file', accept: 'mesh', label: 'Cap' },
  single: { kind: 'file', accept: 'mesh', label: 'Single' },
  priority: { kind: 'range', label: 'Corner priority', min: 0, max: 100, step: 1, default: 0 },
} as const;

/** A corner to use when this profile meets one particular other profile. */
export type ProfileTransition = { profile: string; outerCorner: string; innerCorner: string };

export type EdgeProfile = {
  id: string;
  label: string;
  /** The folder the record was found in. See `path` on Material. */
  path: string;
  edge: string;
  outerCorner: string;
  innerCorner: string;
  corridor: string;
  cap: string;
  single: string;
  priority: number;
  transitions: ProfileTransition[];
};

export type ProfileInput = Partial<Omit<EdgeProfile, 'transitions'>> & { transitions?: unknown };

export function defaultProfile(id = 'profile'): EdgeProfile {
  return { id, label: id, path: '', edge: '', outerCorner: '', innerCorner: '', corridor: '', cap: '', single: '', priority: 0, transitions: [] };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export function normalizeProfile(input: ProfileInput = {}): EdgeProfile {
  const full = defaultProfile(input.id ?? 'profile');
  return {
    ...full,
    id: text(input.id) || full.id,
    label: text(input.label) || text(input.id) || full.id,
    path: text(input.path),
    edge: text(input.edge),
    outerCorner: text(input.outerCorner),
    innerCorner: text(input.innerCorner),
    corridor: text(input.corridor),
    cap: text(input.cap),
    single: text(input.single),
    priority: Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0,
    transitions: (Array.isArray(input.transitions) ? input.transitions : [])
      .filter((one): one is Record<string, unknown> => Boolean(one) && typeof one === 'object')
      .map((one) => ({ profile: text(one.profile), outerCorner: text(one.outerCorner), innerCorner: text(one.innerCorner) })),
  };
}

export const PROFILES: EdgeProfile[] = ((GAME_PROFILES as ProfileInput[] | undefined) ?? []).map(normalizeProfile);

export type CornerKind = 'outerCorner' | 'innerCorner';

/** The pieces taken from the highest-priority profile rather than resolved per corner. */
export type ShapeSlot = 'corridor' | 'cap' | 'single';

/**
 * The corner model where two edges meet, or '' when there is none to draw.
 *
 * Same profile: its own corner. Different: the higher priority owns it (the
 * first of the two on a tie, so a corner never flips on an unrelated edit),
 * and a transition that profile lists for the other one wins over its plain
 * corner.
 */
export function cornerMesh(a: EdgeProfile | null, b: EdgeProfile | null, kind: CornerKind): string {
  if (!a || !b) return '';
  if (a.id === b.id) return a[kind];
  const [owner, other] = b.priority > a.priority ? [b, a] : [a, b];
  const pair = owner.transitions.find((one) => one.profile === other.id);
  return (pair && pair[kind]) || owner[kind];
}

/** Side names, in the grid's side order: east, north, west, south. */
export const SIDE_NAMES = ['east', 'north', 'west', 'south'] as const;
export type SideName = (typeof SIDE_NAMES)[number];
