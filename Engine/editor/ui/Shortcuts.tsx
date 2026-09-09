import { Dialog } from '@base-ui/react/dialog';
import { TOOLS } from '../state/tools';
import styles from './Shortcuts.module.css';

/**
 * Every key the editor answers to, in one place.
 *
 * This is what took over from the command palette. A palette made rarely-used
 * commands reachable but told you nothing about the keys, and the keys are what
 * you actually use once you know the tool — so the list is the list.
 */
const KEYS: readonly (readonly [string, string])[] = [
  ['Ctrl+S', 'Save'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
  ['Del', 'Delete the selection'],
  ['Esc', 'Clear the selection'],
  ['F', 'Frame the whole map'],
  ['G', 'Show or hide the tile grid'],
  ['?', 'This list'],
  ['1 – 9, 0', 'Pick the brush in that slot'],
];

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup}>
          <Dialog.Title className={styles.title}>Keyboard</Dialog.Title>
          <div className={styles.columns}>
            <dl className={styles.list}>
              <dt className={styles.head}>Tools</dt>
              {TOOLS.map((tool) => (
                <div key={tool.id} className={styles.row}>
                  <dt className={styles.key}>{tool.shortcut.toUpperCase()}</dt>
                  <dd className={styles.what}>{tool.label}</dd>
                </div>
              ))}
            </dl>
            <dl className={styles.list}>
              <dt className={styles.head}>Editing</dt>
              {KEYS.map(([key, what]) => (
                <div key={key} className={styles.row}>
                  <dt className={styles.key}>{key}</dt>
                  <dd className={styles.what}>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
          <p className={styles.note}>
            While dragging a number: hold Shift for fine steps, Ctrl or Alt for coarse.
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
