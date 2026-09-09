import { Field } from './Field';
import { VectorRow } from './VectorRow';
import { groupFields } from './grouping';
import type { FieldSpec, FieldValue } from './types';

/**
 * A whole descriptor list, rendered.
 *
 * This is the piece every panel in the editor ends up using: hand it the fields
 * an object declares and the object itself, and it draws the form. Fields that
 * are parts of one value are folded onto a single row on the way.
 *
 * `onInput` previews and `onChange` commits, all the way down — which is what
 * lets a whole drag be one undo step rather than forty.
 */
export function FieldList({
  fields,
  values,
  onInput,
  onChange,
  resolveOptions,
  used,
}: {
  fields: readonly FieldSpec[];
  values: Record<string, unknown>;
  onInput: (key: string, value: FieldValue) => void;
  onChange: (key: string, value: FieldValue) => void;
  resolveOptions?: (field: FieldSpec) => readonly (readonly [string, string])[];
  used?: readonly number[];
}) {
  return (
    <>
      {groupFields(fields).map((row) =>
        row.kind === 'vector' ? (
          <VectorRow
            key={row.parts.map((part) => part.key).join('-')}
            label={row.label}
            parts={row.parts}
            values={row.parts.map((part) => Number(values[part.key] ?? part.default ?? 0))}
            onInput={onInput}
            onChange={onChange}
          />
        ) : (
          <Field
            key={row.field.key}
            field={row.field}
            value={values[row.field.key] as FieldValue}
            onInput={(value) => onInput(row.field.key, value)}
            onChange={(value) => onChange(row.field.key, value)}
            resolveOptions={resolveOptions}
            used={used}
          />
        ),
      )}
    </>
  );
}
