import { Field } from './Field';
import { VectorRow } from './VectorRow';
import { groupFields } from './grouping';
import type { FieldSpec, FieldValue } from './types';
import type { Files } from '../ui/FilePicker';

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
/**
 * A value, reached by a key that may point one level in.
 *
 * `interact.ui` is the panel an object's interact wiring opens. See
 * `updateObject` in ../document.ts, which writes them back the same way, and
 * `Engine/src/game/actions/` for why a wiring is a bag rather than loose fields.
 */
const at = (values: Record<string, unknown>, key: string): unknown => {
  const dot = key.indexOf('.');
  if (dot < 0) return values[key];
  const bag = values[key.slice(0, dot)] as Record<string, unknown> | undefined;
  return bag?.[key.slice(dot + 1)];
};

export function FieldList({
  fields,
  values,
  onInput,
  onChange,
  resolveOptions,
  used,
  files,
}: {
  fields: readonly FieldSpec[];
  values: Record<string, unknown>;
  onInput: (key: string, value: FieldValue) => void;
  onChange: (key: string, value: FieldValue) => void;
  resolveOptions?: ((field: FieldSpec) => readonly (readonly [string, string])[]) | undefined;
  used?: readonly number[] | undefined;
  files?: Files | undefined;
}) {
  return (
    <>
      {groupFields(fields.filter((field) => !field.when || field.when(values))).map((row) =>
        row.kind === 'vector' ? (
          <VectorRow
            key={row.parts.map((part) => part.key).join('-')}
            label={row.label}
            parts={row.parts}
            values={row.parts.map((part) => Number(at(values, part.key) ?? part.default ?? 0))}
            onInput={onInput}
            onChange={onChange}
          />
        ) : (
          <Field
            key={row.field.key}
            field={row.field}
            value={at(values, row.field.key) as FieldValue}
            onInput={(value) => onInput(row.field.key, value)}
            onChange={(value) => onChange(row.field.key, value)}
            resolveOptions={resolveOptions}
            used={used}
            files={files}
          />
        ),
      )}
    </>
  );
}
