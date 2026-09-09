import type { ReactNode } from 'react';
import { IconPlus, IconX } from '@tabler/icons-react';
import { Button } from '../../ui/Button';
import styles from './RowList.module.css';

/**
 * A repeating structure inside a record.
 *
 * An effect's modifiers, an ability's costs, a loot table's rolls — all the
 * same shape: a heading, some rows, a way to add one and a way to take one
 * away. The rows themselves differ, so they are passed in.
 *
 * `empty` is what to say when there are none, and it is worth saying: a list
 * with no rows and no explanation looks like a list that failed to load.
 */
export function RowList({
  title,
  count,
  empty,
  addLabel,
  onAdd,
  action,
  children,
}: {
  title: string;
  /** How many rows are drawn. Zero is what `empty` speaks for. */
  count: number;
  empty: string;
  /** Both, or neither: a list you cannot add to has no button to add with. */
  addLabel?: string;
  onAdd?: () => void;
  /**
   * A control of the caller's own instead of the plain Add button — for a list
   * where what you add is a choice. It sits in the header, so it is reachable
   * when the list is still empty.
   */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.list}>
      <header className={styles.head}>
        <span className={styles.title}>{title}</span>
        {action}
        {onAdd && (
          <Button variant="quiet" onClick={onAdd}>
            <IconPlus size={12} />
            {addLabel}
          </Button>
        )}
      </header>
      {count === 0 ? <p className={styles.empty}>{empty}</p> : children}
    </section>
  );
}

/** One entry, with the control that removes it. */
export function Row({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.remove}
        aria-label={`Remove ${label}`}
        title={`Remove ${label}`}
        onClick={onRemove}
      >
        <IconX size={12} />
      </button>
      {children}
    </div>
  );
}
