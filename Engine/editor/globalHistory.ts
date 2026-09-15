/**
 * One undo stack for everything the editor does in a session.
 *
 * Each document keeps its own snapshots — the map its terrain strokes and
 * object edits, the rules document its asset records — and this only keeps
 * the *order*: every time either of them takes a step, a token pointing back at
 * that document goes on here. Ctrl+Z pops the latest token and asks that
 * document to undo, so a material edit, a brush stroke and a folder move undo
 * in the order you made them, whichever document each lives in.
 *
 * File operations have no document; they push their own undo and redo.
 *
 * Session only: it is thrown away with the page, while drafts persist.
 */

export type Step = {
  label: string;
  undo(): unknown;
  redo(): unknown;
};

/** Anything with an undo stack of its own that says when it grows. */
export type Steppable = {
  onStep(listener: () => void): () => void;
  undo(): unknown;
  redo(): unknown;
};

const LIMIT = 200;

export function createGlobalHistory() {
  const undoStack: Step[] = [];
  const redoStack: Step[] = [];
  const listeners = new Set<() => void>();
  let revision = 0;
  /** While set, document steps are not recorded: an undo is replaying them. */
  let replaying = 0;
  /** While set, document steps are folded into one step being assembled. */
  let batching = 0;

  const notify = () => {
    revision += 1;
    for (const listener of listeners) listener();
  };

  function push(step: Step) {
    undoStack.push(step);
    if (undoStack.length > LIMIT) undoStack.shift();
    redoStack.length = 0;
    notify();
  }

  const run = async (fn: () => unknown) => {
    replaying += 1;
    try {
      await fn();
    } finally {
      replaying -= 1;
    }
  };

  return {
    get revision() {
      return revision;
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /**
     * Record this document's steps here from now on.
     *
     * @param after called with whatever the document's undo/redo returned, so
     *   the map can redraw only what moved.
     */
    attach(doc: Steppable, label: string, after?: (result: unknown) => void): () => void {
      return doc.onStep(() => {
        if (replaying || batching) return;
        push({
          label,
          undo: () => {
            const result = doc.undo();
            after?.(result);
          },
          redo: () => {
            const result = doc.redo();
            after?.(result);
          },
        });
      });
    },

    push,

    /**
     * Do several things as one undo step. Document steps taken inside are not
     * recorded on their own; the caller pushes the one step that stands for all.
     */
    async batch<T>(fn: () => Promise<T> | T): Promise<T> {
      batching += 1;
      try {
        return await fn();
      } finally {
        batching -= 1;
      }
    },

    async undo(): Promise<boolean> {
      const step = undoStack.pop();
      if (!step) return false;
      try {
        await run(() => step.undo());
        redoStack.push(step);
      } catch (error) {
        // A step that could not be undone is dropped rather than retried forever.
        notify();
        throw error;
      }
      notify();
      return true;
    },

    async redo(): Promise<boolean> {
      const step = redoStack.pop();
      if (!step) return false;
      try {
        await run(() => step.redo());
        undoStack.push(step);
      } catch (error) {
        notify();
        throw error;
      }
      notify();
      return true;
    },
  };
}

export type GlobalHistory = ReturnType<typeof createGlobalHistory>;

/** The editor's one history. A page opens one game, so one is enough. */
export const globalHistory = createGlobalHistory();
