import { useState } from 'react';
import { create } from 'zustand';
import { Dialog } from '@base-ui/react/dialog';
import { IconFolder } from '@tabler/icons-react';
import { Button } from '../ui/Button';
import type { Conflict } from './fileOps.ts';
import { TYPE_LABEL, childrenOf, nameOf, type AssetEntry, type Problem, type User } from './model.ts';
import styles from './Dialogs.module.css';

/**
 * The questions the Assets panel asks: what to do about a name that is taken,
 * whether to delete something that is used, where to move things, and why a
 * publish was refused.
 */

// --- name taken ------------------------------------------------------------------

type ConflictAsk = {
  name: string;
  folder: string;
  resolve: (answer: { choice: Conflict; all: boolean }) => void;
} | null;

const useConflict = create<{ ask: ConflictAsk }>(() => ({ ask: null }));

/** Ask, and wait for the answer. Used by the file operations. */
export function askConflict(name: string, folder: string): Promise<{ choice: Conflict; all: boolean }> {
  return new Promise((resolve) => useConflict.setState({ ask: { name, folder, resolve } }));
}

export function ConflictDialog() {
  const ask = useConflict((state) => state.ask);
  const [all, setAll] = useState(false);
  const answer = (choice: Conflict) => {
    ask?.resolve({ choice, all });
    setAll(false);
    useConflict.setState({ ask: null });
  };
  return (
    <Dialog.Root open={Boolean(ask)} onOpenChange={(next) => !next && answer('skip')}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup}>
          <Dialog.Title className={styles.title}>“{ask?.name}” is already there</Dialog.Title>
          <p className={styles.what}>
            <span className={styles.path}>Assets/{ask?.folder}</span>
          </p>
          <p className={styles.note}>
            Replacing keeps the existing file’s id, so everything that uses it uses the new one.
          </p>
          <label className={styles.note} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} />
            Do this for every name that is taken
          </label>
          <div className={styles.actions}>
            <Button variant="quiet" onClick={() => answer('skip')}>
              Skip
            </Button>
            <Button onClick={() => answer('keep')}>Keep both</Button>
            <Button variant="danger" onClick={() => answer('replace')}>
              Replace
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// --- delete ----------------------------------------------------------------------

export function DeleteDialog({
  targets,
  users,
  onCancel,
  onConfirm,
}: {
  targets: readonly AssetEntry[] | null;
  users: readonly User[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const one = targets?.length === 1 ? targets[0] : null;
  return (
    <Dialog.Root open={Boolean(targets?.length)} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup}>
          <Dialog.Title className={styles.title}>
            Delete {one ? `${TYPE_LABEL[one.type].toLowerCase()}` : `${targets?.length ?? 0} items`}?
          </Dialog.Title>
          <p className={styles.what}>
            {(targets ?? []).slice(0, 6).map((target) => (
              <span key={target.path} className={styles.path}>
                Assets/{target.path}
              </span>
            ))}
            {(targets?.length ?? 0) > 6 && <span className={styles.path}>…and {(targets?.length ?? 0) - 6} more</span>}
          </p>
          {users.length > 0 && (
            <>
              <p className={styles.warn}>
                {users.length === 1 ? 'This is used by one thing' : `This is used by ${users.length} things`}. They
                will name something missing, and publishing stays blocked until they are fixed.
              </p>
              <ul className={styles.users}>
                {users.map((user) => (
                  <li key={`${user.type}:${user.id}`} className={styles.user}>
                    <span className={styles.userList}>{user.type}</span>
                    {user.label}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className={styles.note}>Only the draft changes. Undo brings it back.</p>
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

// --- move to ---------------------------------------------------------------------

export function MoveDialog({
  open,
  entries,
  moving,
  onCancel,
  onMove,
}: {
  open: boolean;
  entries: readonly AssetEntry[];
  moving: readonly string[];
  onCancel: () => void;
  onMove: (folder: string) => void;
}) {
  const [chosen, setChosen] = useState('');
  const blocked = (folder: string) => moving.some((path) => folder === path || folder.startsWith(`${path}/`));

  const Branch = ({ folder, depth }: { folder: string; depth: number }) => (
    <>
      {childrenOf(entries, folder)
        .filter((entry) => entry.dir)
        .map((entry) => (
          <div key={entry.path}>
            <button
              type="button"
              className={styles.user}
              disabled={blocked(entry.path)}
              style={{
                paddingLeft: depth * 14,
                width: '100%',
                border: 0,
                background: chosen === entry.path ? 'var(--e-raised)' : 'transparent',
                cursor: blocked(entry.path) ? 'default' : 'pointer',
                opacity: blocked(entry.path) ? 0.4 : 1,
              }}
              onClick={() => setChosen(entry.path)}
              onDoubleClick={() => !blocked(entry.path) && onMove(entry.path)}
            >
              <IconFolder size={13} /> {nameOf(entry.path)}
            </button>
            <Branch folder={entry.path} depth={depth + 1} />
          </div>
        ))}
    </>
  );

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup}>
          <Dialog.Title className={styles.title}>Move {moving.length === 1 ? nameOf(moving[0]!) : `${moving.length} items`} to…</Dialog.Title>
          <div className={styles.users} style={{ maxHeight: 280 }}>
            <button
              type="button"
              className={styles.user}
              style={{ width: '100%', border: 0, background: chosen === '' ? 'var(--e-raised)' : 'transparent', cursor: 'pointer' }}
              onClick={() => setChosen('')}
            >
              <IconFolder size={13} /> Assets
            </button>
            <Branch folder="" depth={1} />
          </div>
          <div className={styles.actions}>
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => onMove(chosen)}>
              Move here
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// --- publish refused ---------------------------------------------------------------

export function ProblemsDialog({ problems, onClose }: { problems: readonly Problem[] | null; onClose: () => void }) {
  return (
    <Dialog.Root open={Boolean(problems?.length)} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.popup} style={{ width: 'min(560px, calc(100vw - 32px))' }}>
          <Dialog.Title className={styles.title}>Can’t publish yet</Dialog.Title>
          <p className={styles.warn}>
            Fix {problems?.length === 1 ? 'this problem' : `these ${problems?.length ?? 0} problems`}, then publish again.
          </p>
          <ul className={styles.users} style={{ maxHeight: 320 }}>
            {(problems ?? []).map((problem, index) => (
              <li key={`${problem.path}:${index}`} className={styles.user} style={{ flexDirection: 'column', gap: 0 }}>
                <span className={styles.path}>{problem.path}</span>
                {problem.message}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button variant="primary" onClick={onClose}>
              OK
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
