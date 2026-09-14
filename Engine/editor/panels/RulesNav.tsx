import { NavLink } from 'react-router';
import { GROUPS, LIST_LABELS } from '../rules/schema';
import styles from './RulesNav.module.css';

/**
 * The three groups and their nine lists.
 *
 * Each group rebinds `--e-accent` to its own hue, so every tab, card edge, fill
 * and focus ring below inherits it without a single rule knowing which group it
 * is drawing. Where you are is something you see before you read anything.
 */
export function RulesNav({ game, counts }: { game: string; counts: Record<string, number> }) {
  return (
    <nav className={styles.nav} aria-label="Rules">
      {GROUPS.map((group) => (
        <div key={group.id} className={styles.group} data-group={group.id}>
          <h3 className={styles.head}>{group.label}</h3>
          {group.lists.map((list) => (
            <NavLink key={list} to={`/${game}/rules/${list}`} className={styles.item ?? ''}>
              <span className={styles.label}>{LIST_LABELS[list]}</span>
              <span className={styles.count}>{counts[list] ?? 0}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
