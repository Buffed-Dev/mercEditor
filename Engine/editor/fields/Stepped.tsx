import { IconMinus, IconPlus } from '@tabler/icons-react';
import { Field } from './Field';
import { quantise, resolveRange } from './ranges';
import type { FieldSpec, FieldValue } from './types';
import { IconButton } from '../ui/Button';
import styles from './Stepped.module.css';

/**
 * A range field with +/- buttons flanking it.
 *
 * Every other number in the editor is drag-to-sweep, deliberately without
 * spinner buttons (see NumberField's own doc comment) — dragging is how you
 * find a feel for a light's intensity or a scale's curve. Some numbers are
 * the opposite: they change in small, exact, one-at-a-time steps between
 * clicks elsewhere (a brush's size, a map's width in tiles), which a tap is a
 * better fit for than a sweep — this is the one control that gets buttons.
 */
export function Stepped({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: number;
  onChange: (value: number) => void;
}) {
  const range = resolveRange(field, value);
  const by = (steps: number) => onChange(quantise(range, value + steps * range.step));
  const set = (next: FieldValue) => onChange(Number(next ?? field.default ?? 0));
  return (
    <div className={styles.stepped}>
      <IconButton
        label={`Decrease ${field.label}`}
        onClick={() => by(-1)}
        disabled={range.clamps && value <= range.min}
      >
        <IconMinus size={12} />
      </IconButton>
      <Field field={field} value={value} onInput={set} onChange={set} />
      <IconButton
        label={`Increase ${field.label}`}
        onClick={() => by(1)}
        disabled={range.clamps && value >= range.max}
      >
        <IconPlus size={12} />
      </IconButton>
    </div>
  );
}
