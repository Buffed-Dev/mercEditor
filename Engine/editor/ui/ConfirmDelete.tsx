import { Dialog } from '@base-ui/react/dialog';
import { Button } from './Button';
import styles from './ConfirmDelete.module.css';

/**
 * The one thing in the library that cannot be undone, asked about first.
 *
 * Moving a folder is recoverable by moving it back; deleting one is bytes
 * nothing else has a copy of. So this is the only place a destructive action
 * gets a dialog rather than a menu item — and it does not merely say "are you
 * sure", which is a question nobody reads. It says what breaks.
 *
 * What it can say is limited, and it admits so. `usedBy` walks the rules, and a
 * map names objects, terrains and prefabs too — maps being files the editor has
 * not opened. "Nothing in the rules" is the honest phrasing, and it is the one
 * used.
 */

export type Users = readonly { list: string; id: string; label: string }[];

export function ConfirmDelete({
  target,
  users,
  checksMaps,
  onCancel,
  onConfirm,
}: {
  /** What is about to go, as it should be named to a person. */
  target: { label: string; path: string; what: string } | null;
  users: Users;
  /** Whether the walk behind `users` could have seen a map. It cannot. */
  checksMaps?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={Boolean(target)} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup}>
          <Dialog.Title className={styles.title}>Delete {target?.what}?</Dialog.Title>

          <p className={styles.what}>
            <span className={styles.name}>{target?.label}</span>
            <span className={styles.path}>{target?.path}</span>
          </p>

          {users.length > 0 && (
            <>
              <p className={styles.warn}>
                {users.length === 1 ? 'One record names it' : `${users.length} records name it`}.
                Deleting empties {users.length === 1 ? 'that reference' : 'those references'} rather
                than leaving them pointing at nothing.
              </p>
              <ul className={styles.users}>
                {users.map((user) => (
                  <li key={`${user.list}:${user.id}`} className={styles.user}>
                    <span className={styles.userList}>{user.list}</span>
                    {user.label}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Said whether or not anything was found, because "nothing names it"
              and "nothing in the rules names it" are different claims and only
              the second one is true. */}
          {!checksMaps && (
            <p className={styles.note}>
              Maps are not checked. Anything placed on one goes on naming this.
            </p>
          )}

          <div className={styles.actions}>
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm}>
              {users.length ? 'Delete anyway' : 'Delete'}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
