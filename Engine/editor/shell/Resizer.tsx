import { useRef, useState } from 'react';
import styles from './Shell.module.css';

/**
 * The drag handle between two panels.
 *
 * It reports a width rather than a delta, so the store stays the only thing
 * that knows how wide a panel is — dragging cannot leave the layout and the
 * stored layout disagreeing about it.
 *
 * `invert` is for a handle on the left of the panel it sizes: dragging right
 * makes that panel narrower, not wider.
 */
export function Resizer({
  width,
  onResize,
  invert = false,
  label,
}: {
  width: number;
  onResize: (width: number) => void;
  invert?: boolean;
  label: string;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, width: 0 });

  const sign = invert ? -1 : 1;

  return (
    <div
      className={`${styles.resizer} ${dragging ? styles.dragging : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        onResize(start.current.width + sign * (event.clientX - start.current.x));
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
      }}
      // A handle you can only drag is a handle some people cannot move at all.
      onKeyDown={(event) => {
        const step = event.shiftKey ? 32 : 8;
        if (event.key === 'ArrowLeft') onResize(width - sign * step);
        else if (event.key === 'ArrowRight') onResize(width + sign * step);
        else return;
        event.preventDefault();
      }}
    />
  );
}
