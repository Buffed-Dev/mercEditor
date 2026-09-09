import { ASSET_FIELDS, ASSET_KINDS } from '../../src/data/assets.js';
import { MATERIAL_FIELDS } from '../../src/data/materials.ts';
import { PROP_FIELDS } from '../../src/data/props.ts';
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

export type LibraryKind = 'assets' | 'materials' | 'props' | 'terrains' | 'vfx';

export const LIBRARY_KINDS: readonly { id: LibraryKind; label: string; singular: string }[] = [
  { id: 'assets', label: 'Files', singular: 'file' },
  { id: 'materials', label: 'Materials', singular: 'material' },
  { id: 'props', label: 'Objects', singular: 'object' },
  { id: 'terrains', label: 'Terrains', singular: 'terrain' },
  { id: 'vfx', label: 'Effects', singular: 'effect' },
];

type FieldTable = Record<string, { kind: string; label: string } & Record<string, unknown>>;

/** An asset is a file, so what it is called and which file it is come first. */
const ASSET_COMMON: FieldTable = {
  label: { kind: 'text', label: 'Name' },
  kind: {
    kind: 'select',
    label: 'Kind',
    options: Object.entries(ASSET_KINDS as Record<string, { label: string }>).map(
      ([id, spec]) => [id, spec.label],
    ),
  },
};

const TABLES: Record<LibraryKind, FieldTable> = {
  assets: ASSET_COMMON,
  materials: MATERIAL_FIELDS as FieldTable,
  props: PROP_FIELDS as FieldTable,
  terrains: TERRAIN_FIELDS as unknown as FieldTable,
  // An effect is emitter, particle, movement and sheet together, each its own
  // table — so its fields are gathered by the effect editor rather than here.
  vfx: {},
};

/**
 * Which fields a record shows.
 *
 * An asset varies by what kind of file it is: a mesh is placed with a scale and
 * three rotations, a texture is tiled, a sheet has rows and columns. Those are
 * three different sets and `ASSET_FIELDS` already declares them, keyed by kind.
 */
export function libraryFields(kind: LibraryKind, record: Record<string, unknown>): FieldSpec[] {
  const table = TABLES[kind];
  const own = Object.entries(table).map(([key, spec]) => ({ key, ...spec }) as FieldSpec);

  if (kind !== 'assets') return own;

  const byKind = (ASSET_FIELDS as Record<string, FieldTable>)[String(record.kind ?? 'mesh')] ?? {};
  return [
    ...own,
    ...Object.entries(byKind).map(([key, spec]) => ({ key, ...spec }) as FieldSpec),
  ];
}

/** What a file's own name is, which no field table describes. */
export const fileOf = (record: Record<string, unknown>) => String(record.file ?? '');
