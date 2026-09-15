import { MATERIAL_FIELDS } from '../../src/data/materials.ts';
import { PREFAB_FIELDS } from '../../src/data/prefabs.ts';
import { PROFILE_FIELDS } from '../../src/data/profiles.ts';
import { TERRAIN_FIELDS } from '../../src/data/terrains.ts';
import type { FieldSpec } from '../fields/types';
import type { JsonType } from './model.ts';

/**
 * Which fields each json asset shows in the inspector, grouped into sections.
 *
 * An effect is emitter, particle, movement and sheet together, each its own
 * table, so its fields are gathered by the effect editor instead. A name is
 * never a field: it is the file's name, changed by renaming the file.
 */

type FieldTable = Record<string, { kind: string; label: string } & Record<string, unknown>>;

const TABLES: Record<JsonType, FieldTable> = {
  material: MATERIAL_FIELDS as FieldTable,
  block: TERRAIN_FIELDS as unknown as FieldTable,
  prefab: PREFAB_FIELDS as unknown as FieldTable,
  effect: {},
  profile: PROFILE_FIELDS as unknown as FieldTable,
};

export type FieldSection = { label: string; fields: FieldSpec[] };

const SECTIONS: Partial<Record<JsonType, readonly { label: string; keys: readonly string[] }[]>> = {
  material: [
    { label: 'Colour & UV', keys: ['texture', 'color', 'uScale', 'vScale', 'uOffset', 'vOffset'] },
    { label: 'Variation', keys: ['variationEnabled', 'variationColor', 'variationStrength', 'variationNoiseType', 'variationNoiseScale', 'variationNoiseStrength'] },
    { label: 'Surface', keys: ['roughness', 'metallic', 'orm'] },
    { label: 'Normal', keys: ['bump', 'bumpStrength'] },
    { label: 'Occlusion', keys: ['ambient', 'ambientStrength'] },
    { label: 'Emission', keys: ['emissive', 'emissiveMap', 'emissiveStrength'] },
    { label: 'Transparency', keys: ['alpha', 'opacityMap', 'transparent', 'backFaces', 'unlit'] },
    { label: 'Animation', keys: ['sheetColumns', 'sheetRows', 'sheetFrames', 'sheetFps'] },
  ],
  block: [
    { label: 'General', keys: ['char', 'tint'] },
    { label: 'Surfaces', keys: ['top', 'sub', 'top90', 'top180', 'top270', 'sub90', 'sub180', 'sub270'] },
    { label: 'Edges', keys: ['defaultSideProfile'] },
    { label: 'Blending', keys: ['blendable', 'blendGroup', 'blendWidth', 'blendNoiseScale', 'blendNoiseStrength'] },
  ],
  profile: [
    { label: 'Pieces', keys: ['edge', 'outerCorner', 'innerCorner', 'corridor', 'cap', 'single'] },
    { label: 'Corners', keys: ['priority'] },
  ],
};

/** A type's fields in sections, in the field-table order inside each. */
export function fieldSections(type: JsonType): FieldSection[] {
  const fields = Object.entries(TABLES[type])
    .filter(([key]) => key !== 'label')
    .map(([key, spec]) => ({ key, ...spec }) as FieldSpec);
  const plan = SECTIONS[type];
  if (!plan) return fields.length ? [{ label: '', fields }] : [];
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const used = new Set(plan.flatMap((section) => section.keys));
  const sections = plan
    .map((section) => ({
      label: section.label,
      fields: section.keys.flatMap((key) => {
        const field = byKey.get(key);
        return field ? [field] : [];
      }),
    }))
    .filter((section) => section.fields.length);
  const rest = fields.filter((field) => !used.has(field.key));
  if (rest.length) sections.push({ label: 'Other', fields: rest });
  return sections;
}
