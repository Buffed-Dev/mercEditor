import { create } from 'zustand';

/**
 * What the editor has to say, split by whether you have to notice it.
 *
 * Routine confirmations go to the status bar and clear themselves, so a stale
 * "Wrote 4 files" cannot sit there looking like the current state. Failures
 * raise a toast as well and stay until dismissed: a failed save that scrolls
 * quietly past in a status bar is how work gets lost.
 */

export type MessageKind = 'info' | 'good' | 'warn' | 'error';

export type Toast = { id: number; text: string; kind: MessageKind };

/** How long a message that is not a failure stays up. */
const MESSAGE_MS = 4000;

type StatusStore = {
  message: { text: string; kind: MessageKind } | null;
  toasts: Toast[];
  say: (text: string, kind?: MessageKind) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

export const useStatus = create<StatusStore>((set) => ({
  message: null,
  toasts: [],

  say(text, kind = 'info') {
    clearTimeout(clearTimer);
    set((state) => ({
      message: text ? { text, kind } : null,
      toasts:
        kind === 'error' ? [...state.toasts, { id: nextId++, text, kind }] : state.toasts,
    }));
    if (text && kind !== 'error') {
      clearTimer = setTimeout(() => set({ message: null }), MESSAGE_MS);
    }
  },

  dismiss(id) {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));

/**
 * Say something from outside a component.
 *
 * The editor surface, the save path and the file loaders are all plain modules
 * with no hooks in them, and they have as much to report as any panel does.
 */
export const say = (text: string, kind?: MessageKind) => useStatus.getState().say(text, kind);
