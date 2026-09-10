import { MATERIAL_FIELDS } from '../../src/data/materials.ts';
import { PROP_FIELDS } from '../../src/data/props.ts';
import { PREFAB_FIELDS } from '../../src/data/prefabs.ts';
import { TERRAIN_FIELDS } from '../../src/data/terrains.ts';
import type { FieldSpec } from '../fields/types';

/**
 * The library: the records a map is drawn *with*, as opposed to the rules it is
 * played by.
 *
 * A material, a model, an effect and a terrain all answer the same question —
 * what does this look like — which is why they share a screen, and why that
 * screen's middle is a preview rather than a grid. You judge these by looking
 * at them.
 */

export type LibraryKind = 'materials' | 'props' | 'terrains' | 'vfx' | 'prefabs';

export const LIBRARY_KINDS: readonly { id: LibraryKind; label: string; singular: string }[] = [
  { id: 'materials', label: 'Materials', singular: 'material' },
  { id: 'props', label: 'Objects', singular: 'object' },
  { id: 'terrains', label: 'Terrains', singular: 'terrain' },
  { id: 'vfx', label: 'Effects', singular: 'effect' },
  { id: 'prefabs', label: 'Prefabs', singular: 'prefab' },
];

type FieldTable = Record<string, { kind: string; label: string } & Record<string, unknown>>;

const TABLES: Record<LibraryKind, FieldTable> = {
  materials: MATERIAL_FIELDS as FieldTable,
  props: PROP_FIELDS as FieldTable,
  terrains: TERRAIN_FIELDS as unknown as FieldTable,
  // An effect is emitter, particle, movement and sheet together, each its own
  // table — so its fields are gathered by the effect editor rather than here.
  vfx: {},
  // A prefab is only its contents, which are edited by standing them on a grid
  // rather than by typing at them. All it has here is its name.
  prefabs: PREFAB_FIELDS as unknown as FieldTable,
};

/** Which fields a record shows. */
export function libraryFields(kind: LibraryKind): FieldSpec[] {
  return Object.entries(TABLES[kind]).map(([key, spec]) => ({ key, ...spec }) as FieldSpec);
}

/** Which folder under `assets/` a record lives in. No field table says. */
export const pathOf = (record: Record<string, unknown>) => String(record.path ?? '');
