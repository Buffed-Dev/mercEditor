import { IconAlertTriangle, IconX } from '@tabler/icons-react';
import { useStatus } from '../state/status';
import { IconButton } from './Button';
import styles from './Toast.module.css';

/**
 * Failures, stated where they cannot be missed, and staying until dismissed.
 *
 * Deliberately not used for anything that went right. A channel that carries
 * every message is one you learn to ignore, which would defeat the only reason
 * this exists.
 */
export function Toasts() {
  const toasts = useStatus((state) => state.toasts);
  const dismiss = useStatus((state) => state.dismiss);

  if (!toasts.length) return null;

  return (
    <div className={styles.stack} role="alert" aria-live="assertive">
      {toasts.map((toast) => (
        <div key={toast.id} className={styles.toast}>
          <IconAlertTriangle size={16} className={styles.icon} />
          <span className={styles.text}>{toast.text}</span>
          <IconButton label="Dismiss" onClick={() => dismiss(toast.id)}>
            <IconX size={14} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
