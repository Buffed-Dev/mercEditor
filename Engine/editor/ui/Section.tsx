import type { ReactNode } from 'react';
import { IconChevronRight } from '@tabler/icons-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import styles from './Section.module.css';

/**
 * Which sections are shut.
 *
 * Kept in a store rather than in the markup, and persisted: a section you
 * folded away is a decision about how you work, and having it spring back open
 * on every reload would be worse than having no sections at all.
 *
 * Keys are namespaced by the caller — the same section name on two different
 * panels is two different switches.
 */
type SectionStore = {
  shut: Record<string, boolean>;
  toggle: (key: string) => void;
};

const useSections = create<SectionStore>()(
  persist(
    (set) => ({
      shut: {},
      toggle: (key) => set((state) => ({ shut: { ...state.shut, [key]: !state.shut[key] } })),
    }),
    { name: 'merc.editor.sections' },
  ),
);

export function Section({
  id,
  title,
  count,
  action,
  defaultOpen = true,
  children,
}: {
  /** Namespaced by the caller, e.g. `inspector:environment`. */
  id: string;
  title: string;
  /** Shown as a pill beside the title. */
  count?: number;
  /** A control beside the title — an Add button, usually. */
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const shut = useSections((state) => state.shut[id]);
  const toggle = useSections((state) => state.toggle);
  const open = shut === undefined ? defaultOpen : !shut;

  return (
    <section className={`${styles.section} ${open ? styles.open : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          className={styles.head}
          aria-expanded={open}
          onClick={() => toggle(id)}
        >
          <IconChevronRight size={13} className={styles.chevron} />
          <span className={styles.title}>{title}</span>
          {count !== undefined && <span className={styles.count}>{count}</span>}
        </button>
        {/* Beside the header rather than inside it: the header is itself a
            button, and a button inside a button is not a thing. */}
        {action}
      </div>
      {open && <div className={styles.body}>{children}</div>}
    </section>
  );
}
