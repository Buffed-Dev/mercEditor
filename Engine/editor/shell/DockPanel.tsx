import type { ReactNode } from 'react';
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react';
import { IconButton } from '../ui/Button';
import styles from './DockPanel.module.css';

export type PanelTab<Id extends string> = { id: Id; label: string };

/**
 * A docked panel, optionally with tabs across its head.
 *
 * Folding one away leaves a stub rather than nothing at all. A panel that
 * vanishes completely takes its own way back with it, and the way back then has
 * to be invented somewhere else — a menu item, a shortcut, a button in the bar
 * that is about a panel it is nowhere near.
 */
export function DockPanel<Id extends string>({
  title,
  tabs,
  active,
  onSelect,
  collapsed,
  onToggle,
  side,
  actions,
  children,
}: {
  title: string;
  tabs?: readonly PanelTab<Id>[];
  active?: Id;
  onSelect?: (id: Id) => void;
  /** Both, or neither: a panel that cannot fold has no button to fold it. */
  collapsed?: boolean;
  onToggle?: () => void;
  /** Which edge it is docked to, so the fold arrow points the right way. */
  side: 'left' | 'right';
  actions?: ReactNode;
  children: ReactNode;
}) {
  if (collapsed && onToggle) {
    return (
      <div className={styles.stub}>
        <IconButton label={`Show ${title.toLowerCase()}`} onClick={onToggle}>
          <IconLayoutSidebarLeftExpand size={16} />
        </IconButton>
        <span className={styles.stubLabel}>{title}</span>
      </div>
    );
  }

  return (
    <section className={styles.panel} aria-label={title}>
      <header className={styles.head}>
        {tabs ? (
          <div className={styles.tabs} role="tablist" aria-label={title}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === active}
                className={styles.tab}
                onClick={() => onSelect?.(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : (
          <h2 className={styles.title}>{title}</h2>
        )}
        {actions}
        {onToggle && (
          <IconButton label={`Hide ${title.toLowerCase()}`} onClick={onToggle}>
            {side === 'left' ? (
              <IconLayoutSidebarLeftCollapse size={16} />
            ) : (
              <IconLayoutSidebarLeftExpand size={16} />
            )}
          </IconButton>
        )}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
