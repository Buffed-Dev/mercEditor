import { useRef, useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { IconChevronDown, IconX } from '@tabler/icons-react';
import styles from './Picker.module.css';

/**
 * A choice made by looking: a box showing what is chosen, and a popup that
 * lists the rest with a search over them.
 *
 * A `<select>` is the right control for six options and the wrong one for
 * sixty textures, because a name is not a picture and a menu cannot be
 * searched. This is the other one. What the options are — files, materials —
 * is the caller's business; this draws whatever thumb it is handed.
 */
export type Option = {
  id: string;
  label: string;
  /** Where it is, or what it is: read small beside the label. */
  hint?: string;
  thumb?: ReactNode;
};

export function Picker({
  label,
  current,
  options,
  placeholder = 'Search',
  onChange,
}: {
  label: string;
  /** The chosen one, drawn in the box. Null for none. */
  current: Option | null;
  options: readonly Option[];
  placeholder?: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const anchor = useRef<HTMLDivElement>(null);

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? options.filter((one) => `${one.label} ${one.hint ?? ''}`.toLowerCase().includes(needle))
    : options;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      {/* The popup is anchored to the whole box rather than the trigger, so
          it lines up under the input the way a select's menu does. */}
      <div ref={anchor} className={styles.field}>
        <Popover.Trigger
          className={styles.trigger}
          aria-label={`${label}: ${current?.id || 'none'}`}
          title={current?.id}
        >
          {current?.thumb ?? <span className={styles.thumb} />}
          <span className={styles.name}>{current?.label ?? '— none —'}</span>
        </Popover.Trigger>
        {current && (
          <button
            type="button"
            className={styles.side}
            aria-label={`Clear ${label}`}
            onClick={() => onChange('')}
          >
            <IconX size={12} />
          </button>
        )}
        <button
          type="button"
          className={styles.side}
          aria-label={`Choose ${label}`}
          onClick={() => setOpen(!open)}
        >
          <IconChevronDown size={12} />
        </button>
      </div>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4}>
          <Popover.Popup className={styles.popup}>
            <input
              className={styles.filter}
              placeholder={placeholder}
              aria-label={placeholder}
              autoFocus
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className={styles.list}>
              {shown.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className={`${styles.row} ${one.id === current?.id ? styles.on : ''}`}
                  title={one.id}
                  onClick={() => {
                    onChange(one.id);
                    setOpen(false);
                  }}
                >
                  {one.thumb ?? <span className={styles.thumb} />}
                  <span className={styles.name}>{one.label}</span>
                  {one.hint && <span className={styles.where}>{one.hint}</span>}
                </button>
              ))}
              {shown.length === 0 && <p className={styles.empty}>Nothing matches.</p>}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
