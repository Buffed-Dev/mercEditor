import { useEffect } from 'react';
import { SLOT_KEYS, TOOLS, useTools } from './tools';
import { ASSETS } from '../document.ts';
import { useSelection } from './selection';

/**
 * The keyboard.
 *
 * Kept as it was — the shortcuts are muscle memory and there was no reason to
 * move any of them — minus `Ctrl+K`, which opened the command palette that this
 * rewrite removes. Added: a single key per tool, in the idiom every tool of
 * this kind uses, and `?` for the list of all of them, which takes over the
 * discoverability job the palette used to do.
 */

type Handlers = {
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onFrame: () => void;
  onToggleGrid: () => void;
  onHelp: () => void;
  onEscape: () => void;
};

export function useShortcuts(handlers: Handlers) {
  const setTool = useTools((state) => state.setTool);
  const setBrush = useTools((state) => state.setBrush);
  const clear = useSelection((state) => state.clear);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Typing in a field is typing, not driving the editor. Without this, "b"
      // in a portal's name would put you in the Place tool.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;

      const key = event.key.toLowerCase();

      if (event.ctrlKey || event.metaKey) {
        if (key === 's') {
          event.preventDefault();
          handlers.onSave();
        } else if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) handlers.onRedo();
          else handlers.onUndo();
        } else if (key === 'y') {
          event.preventDefault();
          handlers.onRedo();
        }
        return;
      }

      if (key === 'escape') {
        // Whatever you are holding, put it down. Escape means "not this", and
        // a brush you cannot stop holding is the same trap as a selection you
        // cannot clear.
        clear();
        setBrush(null);
        setTool('select');
        handlers.onEscape();
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        handlers.onDelete();
        return;
      }
      if (key === 'f') return handlers.onFrame();
      if (key === 'g') return handlers.onToggleGrid();
      if (key === '?') return handlers.onHelp();

      // A digit picks the brush in that slot and reaches for the tool that
      // places it — wanting the brush and wanting to put it down are the same
      // wish, and making them two keystrokes only ever has one answer.
      const slot = SLOT_KEYS.indexOf(key);
      if (slot >= 0) {
        const brush = (ASSETS as { id: string }[])[slot];
        if (brush) {
          setBrush(brush.id);
          setTool('place');
        }
        return;
      }

      const tool = TOOLS.find((entry) => entry.shortcut === key);
      if (tool) setTool(tool.id);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, setTool, setBrush, clear]);
}
