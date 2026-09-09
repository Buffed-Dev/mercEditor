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

const clone = (value) => structuredClone(value);

export function createUndoable(initial) {
  let state = clone(initial);
  const undoStack = [];
  const redoStack = [];
  let dirty = false;

  /** Who wants to hear that this document changed. See history.ts. */
  const listeners = new Set();
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
    subscribe(listener) {
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
    checkpoint(checkpointed = true) {
      dirty = true;
      notify();
      if (!checkpointed) return;
      undoStack.push(clone(state));
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push(clone(state));
      state = undoStack.pop();
      dirty = true;
      notify();
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(clone(state));
      state = redoStack.pop();
      dirty = true;
      notify();
      return true;
    },

    markSaved() {
      dirty = false;
      notify();
    },
  };
}
