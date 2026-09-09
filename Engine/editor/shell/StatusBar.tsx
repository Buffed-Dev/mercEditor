import { useStatus } from '../state/status';
import styles from './StatusBar.module.css';

export type ViewportContext = {
  hover?: { gx: number; gy: number } | null;
  selection?: number;
  size?: { cols: number; rows: number };
  brush?: { label: string; color?: string } | null;
};

/**
 * The message on the left, the live readout on the right.
 *
 * The readout is the reason the bar is worth its 24px: hovered tile, how much
 * is selected, how big the map is, and what the brush currently is — that last
 * one being the thing you can no longer see once the left panel is showing
 * objects rather than assets.
 */
export function StatusBar({ context }: { context?: ViewportContext }) {
  const message = useStatus((state) => state.message);
  const kind = message?.kind ?? 'info';

  return (
    <footer className={styles.bar}>
      <span
        className={`${styles.msg} ${kind === 'good' ? styles.good : ''} ${
          kind === 'warn' || kind === 'error' ? styles.warn : ''
        }`}
      >
        {message?.text ?? ''}
      </span>
      {context && (
        <span className={styles.context}>
          {context.hover && (
            <span>
              <span className={styles.value}>
                {context.hover.gx},{context.hover.gy}
              </span>
            </span>
          )}
          {!!context.selection && (
            <span>
              <span className={styles.value}>{context.selection}</span> selected
            </span>
          )}
          {context.size && (
            <span>
              <span className={styles.value}>
                {context.size.cols}×{context.size.rows}
              </span>
            </span>
          )}
          {context.brush && (
            <span>
              <span
                className={styles.swatch}
                style={{ background: context.brush.color ?? 'var(--e-accent)' }}
              />{' '}
              <span className={styles.value}>{context.brush.label}</span>
            </span>
          )}
        </span>
      )}
    </footer>
  );
}
