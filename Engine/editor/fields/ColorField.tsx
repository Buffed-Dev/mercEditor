import { useRef } from 'react';
import { Popover } from '@base-ui/react/popover';
import { fromHex, fromHsv, isHex, toHex, toHsv } from './color';
import fieldStyles from './Field.module.css';
import styles from './ColorField.module.css';

/**
 * A colour, picked the way a person reaches for one.
 *
 * Not `<input type="color">`: that opens the operating system's dialog, which
 * looks nothing like the editor, takes over the screen, and knows nothing about
 * the colours this map already uses — which is what most colour picking
 * actually is.
 *
 * Dragging inside the square or the hue bar is a preview; letting go commits.
 * Same split as the number field, and for the same reason: a drag is one undo
 * step, not forty.
 */
export function ColorField({
  value,
  label,
  used = [],
  onInput,
  onChange,
}: {
  value: number;
  label: string;
  /** Colours already used on this map, offered as a row of chips. */
  used?: readonly number[];
  onInput: (value: number) => void;
  onChange: (value: number) => void;
}) {
  const hsv = toHsv(value ?? 0);
  const area = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);

  /** Where in a box the pointer is, 0..1 on each axis. */
  const at = (element: HTMLElement | null, event: React.PointerEvent) => {
    const box = element?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };

  const dragging = (
    ref: React.RefObject<HTMLDivElement | null>,
    read: (position: { x: number; y: number }) => number,
  ) => ({
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      onInput(read(at(ref.current, event)));
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      onInput(read(at(ref.current, event)));
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      onChange(read(at(ref.current, event)));
    },
  });

  return (
    <Popover.Root>
      <Popover.Trigger
        className={fieldStyles.swatchButton}
        aria-label={`${label}: ${toHex(value)}`}
      >
        <span className={fieldStyles.swatch} style={{ background: toHex(value) }} />
        {toHex(value).toUpperCase()}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4}>
          <Popover.Popup className={styles.popup}>
            <div
              ref={area}
              className={styles.area}
              style={{ ['--hue' as string]: toHex(fromHsv({ h: hsv.h, s: 1, v: 1 })) }}
              {...dragging(area, ({ x, y }) => fromHsv({ h: hsv.h, s: x, v: 1 - y }))}
            >
              <span
                className={styles.marker}
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
              />
            </div>

            <div
              ref={hue}
              className={styles.hue}
              {...dragging(hue, ({ x }) => fromHsv({ ...hsv, h: x * 360 }))}
            >
              <span
                className={styles.marker}
                style={{ left: `${(hsv.h / 360) * 100}%`, top: '50%' }}
              />
            </div>

            <input
              className={styles.hex}
              value={toHex(value)}
              aria-label="Hex value"
              spellCheck={false}
              onChange={(event) => {
                if (isHex(event.target.value)) onChange(fromHex(event.target.value));
              }}
            />

            {used.length > 0 && (
              <>
                <span className={styles.usedLabel}>Used on this map</span>
                <div className={styles.used}>
                  {used.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      className={styles.chip}
                      style={{ background: toHex(colour) }}
                      title={toHex(colour).toUpperCase()}
                      aria-label={toHex(colour)}
                      onClick={() => onChange(colour)}
                    />
                  ))}
                </div>
              </>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
