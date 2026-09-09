import type { ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { IconCheck } from '@tabler/icons-react';
import styles from './Menu.module.css';

/**
 * A dropdown, styled with the editor's tokens and nothing else.
 *
 * Base UI supplies only the behaviour — focus, keyboard navigation, and staying
 * on screen near the edges of the window — which is the part that is tedious to
 * write and easy to get subtly wrong.
 */
export function DropdownMenu({
  trigger,
  children,
  align = 'start',
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger as never} />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align={align} sideOffset={4}>
          <Menu.Popup className={styles.popup}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * One line of a menu.
 *
 * `checked` leaves the tick column in place either way, so a list of options
 * does not shuffle sideways as the chosen one changes.
 */
export function MenuItem({
  children,
  onClick,
  checked,
  danger,
  hint,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  checked?: boolean;
  danger?: boolean;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <Menu.Item
      className={`${styles.item} ${danger ? styles.danger : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {checked !== undefined && (
        <span className={styles.check}>{checked && <IconCheck size={13} />}</span>
      )}
      <span className={styles.label}>{children}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </Menu.Item>
  );
}

export const MenuSeparator = () => <div className={styles.separator} role="separator" />;
