/**
 * Snapshot undo, the same model document.js uses for maps: take a deep copy
 * before any mutation, so one edit is exactly one undo step and nothing has to
 * know how to reverse itself.
 *
 * That is affordable here because the documents are small — a few hundred
 * numbers — and it is the only approach where an editing operation cannot get
 * its undo wrong, because there is no per-operation undo code to get wrong.
 */

const UNDO_LIMIT = 60;

const clone = <T>(value: T): T => structuredClone(value);

export function createUndoable<T>(initial: T) {
  let state = clone(initial);
  const undoStack: T[] = [];
  const redoStack: T[] = [];
  let dirty = false;

  /** Who wants to hear that this document changed. See history.ts. */
  const listeners = new Set<() => void>();
  /** How many times this document has changed. See history.ts. */
  let revision = 0;
  const notify = () => {
    revision++;
    for (const listener of listeners) listener();
  };

  return {
    get revision() {
      return revision;
    },

    /** @returns a function that stops listening. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    get state() {
      return state;
    },
    get dirty() {
      return dirty;
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },

    /**
     * Snapshot before mutating. A drag passes `false` for every step after the
     * first so the whole gesture collapses into one step.
     */
    checkpoint(checkpointed = true): void {
      dirty = true;
      notify();
      if (!checkpointed) return;
      undoStack.push(clone(state));
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    },

    undo(): boolean {
      // Popped into a name first: `length` says there is one, but only the
      // value itself says so in a way the compiler can carry forward.
      const previous = undoStack.pop();
      if (previous === undefined) return false;
      redoStack.push(clone(state));
      state = previous;
      dirty = true;
      notify();
      return true;
    },

    redo(): boolean {
      const next = redoStack.pop();
      if (next === undefined) return false;
      undoStack.push(clone(state));
      state = next;
      dirty = true;
      notify();
      return true;
    },

    markSaved(): void {
      dirty = false;
      notify();
    },
  };
}

/** A value, its history, and everyone watching it. */
export type Undoable<T> = ReturnType<typeof createUndoable<T>>;
