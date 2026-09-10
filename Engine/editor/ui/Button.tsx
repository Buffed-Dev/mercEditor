import type { ButtonHTMLAttributes, Ref } from 'react';
import { Tooltip } from './Tooltip';
import styles from './Button.module.css';

type Variant = 'primary' | 'default' | 'quiet' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Pressed-in, for a toggle. Also reported as aria-pressed. */
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = 'default',
  active,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={active === undefined ? undefined : active}
      className={`${styles.btn} ${styles[variant]} ${active ? styles.on : ''} ${className}`}
      {...rest}
    />
  );
}

/**
 * The same button with no words in it.
 *
 * `label` is required rather than optional: an icon-only control with no
 * accessible name is a button that only says what it does to people who can
 * already see the picture. It is the tooltip and the screen-reader name both —
 * and the tooltip is instant, because a rail of icons you have to hover and
 * wait on is a rail you have to memorise.
 */
export function IconButton({
  label,
  side,
  className = '',
  variant = 'quiet',
  ...rest
}: ButtonProps & { label: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip label={label} side={side}>
      <Button
        variant={variant}
        aria-label={label}
        className={`${styles.icon} ${className}`}
        {...rest}
      />
    </Tooltip>
  );
}
