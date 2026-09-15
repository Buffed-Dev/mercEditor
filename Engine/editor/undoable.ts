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
  const steps = new Set<() => void>();
  const notify = () => {
    revision++;
    for (const listener of listeners) listener();
  };

  return {
    /** Hear about each new undo step, for the editor-wide history. */
    onStep(listener: () => void): () => void {
      steps.add(listener);
      return () => steps.delete(listener);
    },

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
      for (const listener of steps) listener();
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

    /**
     * Change the present and the past together, for something undo cannot take
     * back.
     *
     * Moving a folder is a filesystem act: the bytes are somewhere else the
     * moment it returns, and nothing here can put them back. Written only into
     * the present, the next undo would restore a record still pointing at the
     * folder it used to be in — a path to nothing, and no error anywhere to say
     * why the picture stopped loading.
     *
     * So it is written into every snapshot as well. Undo goes on working for
     * everything it *can* reverse; where the record lives is simply not one of
     * the things it has an opinion about.
     */
    rewrite(change: (state: T) => void): void {
      change(state);
      for (const entry of undoStack) change(entry);
      for (const entry of redoStack) change(entry);
      dirty = true;
      notify();
    },

    markSaved(): void {
      dirty = false;
      notify();
    },
  };
}

/** A value, its history, and everyone watching it. */
export type Undoable<T> = ReturnType<typeof createUndoable<T>>;
