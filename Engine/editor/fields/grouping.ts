import type { FieldSpec } from './types';

/**
 * Which fields are parts of one value.
 *
 * Recognised by name rather than declared, because the data files already spell
 * these consistently — `posX`/`posY`/`posZ`, `rotX`/`rotY`/`rotZ`, `w`/`h`,
 * `min`/`max`, `uScale`/`vScale`. Adding a declaration to nine data files to
 * say what their own naming already says would be a second thing to keep in
 * step.
 *
 * Order matters: the first group whose parts are all present wins.
 */
const GROUPS: readonly { label: string; keys: readonly string[] }[] = [
  { label: 'Position', keys: ['posX', 'posY', 'posZ'] },
  { label: 'Rotation (deg)', keys: ['rotX', 'rotY', 'rotZ'] },
  { label: 'Size', keys: ['w', 'h'] },
  { label: 'Range', keys: ['min', 'max'] },
  { label: 'Tile', keys: ['uScale', 'vScale'] },
  { label: 'Shift', keys: ['uOffset', 'vOffset'] },
  { label: 'Sheet', keys: ['columns', 'rows'] },
];

export type FieldGroup =
  | { kind: 'single'; field: FieldSpec }
  | { kind: 'vector'; label: string; parts: FieldSpec[] };

/**
 * Fold a flat list of descriptors into rows, pairing the ones that belong
 * together and leaving everything else alone.
 *
 * A group is only taken when every one of its parts is present and they are all
 * numbers — a partial match is a different field that happens to share a name.
 */
export function groupFields(fields: readonly FieldSpec[]): FieldGroup[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const taken = new Set<string>();
  const rows: FieldGroup[] = [];

  for (const field of fields) {
    if (taken.has(field.key)) continue;

    const group = GROUPS.find(
      (candidate) =>
        candidate.keys.includes(field.key) &&
        candidate.keys.every((key) => {
          const part = byKey.get(key);
          return part && (part.kind === 'number' || part.kind === 'range');
        }),
    );

    if (!group) {
      rows.push({ kind: 'single', field });
      continue;
    }

    for (const key of group.keys) taken.add(key);
    rows.push({
      kind: 'vector',
      label: group.label,
      parts: group.keys.map((key) => byKey.get(key)!),
    });
  }

  return rows;
}
