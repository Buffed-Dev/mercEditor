import { globalHistory } from '../globalHistory.ts';
import { say } from './status';
import { useDocument } from './useDocument';

/** The editor-wide undo and redo, for buttons and shortcuts. */
export function useGlobalHistory() {
  const history = useDocument(globalHistory);
  const run = (step: () => Promise<boolean>) =>
    void step().catch((error: unknown) => say(`Could not undo that: ${(error as Error).message}`, 'error'));
  return {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: () => run(() => globalHistory.undo()),
    redo: () => run(() => globalHistory.redo()),
  };
}
