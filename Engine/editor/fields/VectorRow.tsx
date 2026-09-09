import { FieldRow } from './Field';
import { NumberField } from './NumberField';
import { splitUnit } from './ranges';
import type { FieldSpec } from './types';
import styles from './Field.module.css';

/**
 * Fields that are one value with parts, on one row.
 *
 * A position is not two settings called "Position X" and "Position Y" — it is
 * one place. Giving each component its own labelled row spends two rows saying
 * so and still reads as though they were unrelated. Here the label names the
 * whole thing once and the components sit side by side, which is both shorter
 * and truer.
 *
 * Each part keeps its own descriptor, so a width and a height with different
 * ends still behave correctly.
 */
export function VectorRow({
  label,
  parts,
  values,
  onInput,
  onChange,
}: {
  label: string;
  parts: readonly FieldSpec[];
  values: readonly number[];
  onInput: (key: string, value: number) => void;
  onChange: (key: string, value: number) => void;
}) {
  const { name } = splitUnit(label);

  return (
    <FieldRow label={name}>
      <div className={styles.pair}>
        {parts.map((part, index) => (
          <NumberField
            key={part.key}
            field={part}
            value={values[index] ?? Number(part.default ?? 0)}
            onInput={(value) => onInput(part.key, value)}
            onChange={(value) => onChange(part.key, value)}
            // The unit belongs to the whole row, not to each half of it.
            showUnit={parts.length === 1}
          />
        ))}
      </div>
    </FieldRow>
  );
}
