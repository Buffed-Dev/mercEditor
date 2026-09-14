import { useRef, useState } from 'react';
import {
  SLOP_PX,
  SWEEP_PX,
  display,
  fromPosition,
  grainFrom,
  quantise,
  resolveRange,
  splitUnit,
  toPosition,
} from './ranges';
import type { FieldSpec } from './types';
import styles from './Field.module.css';

/**
 * Drag to sweep, click to type.
 *
 * The two are told apart by distance, not by where you pressed: anywhere on the
 * box starts a drag, and a press that never travels turns into a caret in the
 * number. That is why there is no separate track to aim at — the whole row is
 * the control, which at 21px tall is the difference between hitting it and
 * missing it.
 *
 * `onInput` fires continuously while it moves and `onChange` when it settles.
 * That split is what lets a drag be one undo step: the panel previews every
 * intermediate value uncheckpointed and takes its snapshot on the change that
 * ends the gesture.
 */
export function NumberField({
  field,
  value,
  onInput,
  onChange,
  showUnit = true,
}: {
  field: FieldSpec;
  value: number;
  /** Live, while the value is moving. Not an undo step. */
  onInput: (value: number) => void;
  /** Settled. This is the one that commits. */
  onChange: (value: number) => void;
  showUnit?: boolean;
}) {
  const range = resolveRange(field, value);
  const { unit } = splitUnit(field.label);
  const [scrubbing, setScrubbing] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // `active` rather than asking the element whether it still has the pointer:
  // capture can be refused, and a control that silently stops responding to a
  // drag is worse than one that never offered it.
  // `last` is what the drag itself worked out, which is not the same as the
  // `value` prop: the prop is whatever React last rendered, and a render can
  // lag the pointer. Committing the prop meant a drag settled on a value one
  // event behind the cursor -- the number jumping backwards the moment you let
  // go. The control commits what it produced.
  const drag = useRef({ x: 0, value: 0, last: 0, moved: false, active: false });

  const fill = range.scaled ? `${toPosition(range, value) * 100}%` : '0%';

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // A caret already in the box means you are typing in it; let the pointer
    // select text the way it does in every other input.
    if (event.target === input.current && document.activeElement === input.current) return;
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      box.current?.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a convenience — the drag still works without it, it just
      // stops tracking if the pointer leaves the box.
    }
    drag.current = { x: event.clientX, value, last: value, moved: false, active: true };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    const travel = event.clientX - drag.current.x;
    if (!drag.current.moved && Math.abs(travel) < SLOP_PX) return;
    drag.current.moved = true;
    setScrubbing(true);

    const { grain, scale } = grainFrom(range, event);
    // A field that is a scale crosses its whole range in one sweep, following
    // its curve. One that only clamps has no scale to cross, so a pixel is
    // simply worth a step.
    const next = range.scaled
      ? fromPosition(range, toPosition(range, drag.current.value) + (travel * scale) / SWEEP_PX)
      : drag.current.value + travel * grain * scale;
    const settled = quantise(range, next, grain);
    drag.current.last = settled;
    onInput(settled);
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current.active) return;
    drag.current.active = false;
    if (box.current?.hasPointerCapture(event.pointerId)) {
      box.current.releasePointerCapture(event.pointerId);
    }
    setScrubbing(false);
    if (!drag.current.moved) {
      input.current?.focus();
      input.current?.select();
      return;
    }
    if (drag.current.last !== drag.current.value) onChange(drag.current.last);
  }

  return (
    <div
      ref={box}
      className={`${styles.num} ${range.scaled ? '' : styles.free} ${
        scrubbing ? styles.scrubbing : ''
      }`}
      style={{ ['--fill' as string]: fill }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <input
        ref={input}
        type="number"
        className={styles.numInput}
        aria-label={field.label}
        min={range.clamps ? range.min : undefined}
        max={range.clamps ? range.max : undefined}
        step={range.step}
        // While typing, whatever has been typed stands — clamping mid-keystroke
        // would make "0.5" impossible to enter one character at a time.
        value={typing ?? display(range, value)}
        onChange={(event) => {
          setTyping(event.target.value);
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onInput(next);
        }}
        onKeyDown={(event) => {
          const { grain, scale } = grainFrom(range, event);
          const by = grain * scale;
          if (event.key === 'ArrowUp') onChange(quantise(range, value + by, grain));
          else if (event.key === 'ArrowDown') onChange(quantise(range, value - by, grain));
          else if (event.key === 'Enter') event.currentTarget.blur();
          else return;
          event.preventDefault();
        }}
        // Typed values are held inside the ends on the way out, so a field
        // cannot be saved holding a number its own control could never reach.
        onBlur={() => {
          setTyping(null);
          const held = quantise(range, Number(value) || 0);
          if (held !== value) onChange(held);
          else onChange(value);
        }}
      />
      {showUnit && unit && <span className={styles.unit}>{unit}</span>}
    </div>
  );
}
