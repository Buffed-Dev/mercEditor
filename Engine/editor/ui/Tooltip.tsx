import type { ReactElement, ReactNode } from 'react';
import { Tooltip as Base } from '@base-ui/react/tooltip';
import styles from './Tooltip.module.css';

/**
 * What a control is, said the moment you point at it.
 *
 * The browser's own `title` waits about a second before it says anything, which
 * is long enough to have given up and gone looking somewhere else — and in a
 * tool that is mostly icon buttons, that delay is the difference between a rail
 * you can read and one you have to learn.
 *
 * `delay={0}` on the provider rather than per tooltip, so the whole editor
 * answers at the same speed.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Base.Provider delay={0} closeDelay={0}>
      {children}
    </Base.Provider>
  );
}

export function Tooltip({
  label,
  side = 'bottom',
  children,
}: {
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right' | undefined;
  children: ReactElement;
}) {
  if (!label) return children;

  return (
    <Base.Root>
      <Base.Trigger render={children} />
      <Base.Portal>
        <Base.Positioner side={side} sideOffset={5}>
          <Base.Popup className={styles.popup}>{label}</Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
