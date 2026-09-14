/**
 * One undo stack for the whole document.
 *
 * Entries are opaque pairs of functions, so nothing has to reason about what
 * kind of edit it is undoing — which is what makes one Ctrl+Z do the obvious
 * thing when a terrain stroke and a light being dragged are next to each other
 * in the same history. Two stacks would need a rule for ordering them, and
 * every rule anyone picks is wrong for some pair of edits.
 *
 * A snapshot entry copies the whole document; a terrain stroke records only the
 * cells it touched. The difference is not really about memory — a 64x64 terrain
 * grid is 12 KB and copying it is microseconds — it is that a stroke can say
 * *which cells* it changed, and a snapshot cannot. That rectangle is what lets
 * the 3D view rebuild the part that moved instead of all of it.
 */

export type Rect = { gx: number; gy: number; w: number; h: number };

export type HistoryEntry = {
  label: string;
  undo(): void;
  redo(): void;
  /** The cells this entry touches, when it knows. Absent means "everything". */
  rect?: Rect;
};

/**
 * How far back you can go. Deep enough that no one reaches the end during an
 * editing session, short enough that a runaway loop cannot eat memory.
 */
const LIMIT = 60;

export function createHistory(limit = LIMIT) {
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let dirty = false;

  /**
   * Who wants to hear that the document changed.
   *
   * Every edit reaches the history — a snapshot, a stroke, an undo, a save — so
   * this is the one place that can say "something happened" without each of the
   * fifty methods above it having to remember to. An interface that redraws
   * from state needs exactly that signal, and polling for it would be both
   * slower and less correct.
   */
  const listeners = new Set<() => void>();
  /**
   * How many times this document has changed.
   *
   * A number rather than only a callback, because React reads state by
   * comparing what it last saw with what it sees now — and a document that is
   * edited in place looks identical to itself every time. This is the one
   * value that is guaranteed to differ after an edit.
   */
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
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
    get depth() {
      return undoStack.length;
    },

    markSaved() {
      dirty = false;
      notify();
    },

    /** Mark the document changed without recording a step. */
    touch() {
      dirty = true;
      notify();
    },

    push(entry: HistoryEntry) {
      undoStack.push(entry);
      if (undoStack.length > limit) undoStack.shift();
      // Anything you could have redone is a branch you have now left.
      redoStack.length = 0;
      dirty = true;
      notify();
    },

    /**
     * @returns the rectangle that changed, `null` when the whole document did,
     *   or `false` when there was nothing to undo.
     */
    undo(): Rect | null | false {
      const entry = undoStack.pop();
      if (!entry) return false;
      entry.undo();
      redoStack.push(entry);
      dirty = true;
      notify();
      return entry.rect ?? null;
    },

    redo(): Rect | null | false {
      const entry = redoStack.pop();
      if (!entry) return false;
      entry.redo();
      undoStack.push(entry);
      dirty = true;
      notify();
      return entry.rect ?? null;
    },

    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },
  };
}

export type History = ReturnType<typeof createHistory>;
/**
 * Show what an undo or redo just did, as narrowly as it can be shown.
 *
 * `undo` and `redo` hand back the rectangle the entry touched, or null when the
 * entry cannot say — and cannot say is every entry except a terrain stroke,
 * which is the only kind that tracks one. So a rectangle means the ground moved
 * and nothing else did, which the view can put right by refilling instance
 * buffers; null means assume the worst and rebuild.
 *
 * Here rather than in each of the eight places that undo something, because
 * that is eight chances to write the condition backwards.
 *
 * @returns whether there was anything to undo, so a caller can tell a step that
 *   did nothing from one that did.
 */
export function redraw(
  result: Rect | null | false,
  view: { invalidate: () => void; invalidateTerrain: () => void },
): boolean {
  if (result === false) return false;
  if (result) view.invalidateTerrain();
  else view.invalidate();
  return true;
}

