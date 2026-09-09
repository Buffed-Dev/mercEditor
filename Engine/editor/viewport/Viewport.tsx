import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { IconGridDots, IconMaximize } from '@tabler/icons-react';
import { IconButton } from '../ui/Button';
import styles from './Viewport.module.css';

/** The id the input reader uses to tell the map apart from the interface. */
export const VIEWPORT_ID = 'ed-viewport';

/**
 * Where the map is drawn.
 *
 * The div is handed to Babylon and never touched by React again — React owns
 * the box, Babylon owns what is inside it. Anything drawn over the map is a
 * sibling of that host, not a child, so a re-render cannot disturb the canvas.
 */
export function Viewport({
  hostRef,
  gridVisible,
  onToggleGrid,
  onFrameAll,
  overlay,
  children,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  gridVisible: boolean;
  onToggleGrid: () => void;
  onFrameAll: () => void;
  /** Drawn over the map, positioned by its own stylesheet. */
  overlay?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.viewport}>
      <div id={VIEWPORT_ID} className={styles.host} ref={hostRef} />
      <div className={styles.viewOptions} role="toolbar" aria-label="View options">
        <IconButton
          label="Show the tile grid (G)"
          active={gridVisible}
          onClick={onToggleGrid}
        >
          <IconGridDots size={17} />
        </IconButton>
        <IconButton label="Frame the whole map (F)" onClick={onFrameAll}>
          <IconMaximize size={17} />
        </IconButton>
        {children && <span className={styles.sep} />}
        {children}
      </div>
      {overlay}
    </div>
  );
}

/**
 * What the pointer is over, polled rather than pushed.
 *
 * The editor updates its hover inside Babylon's loop, which runs sixty times a
 * second — turning that into sixty React renders would be a lot of work to move
 * two numbers in the status bar. Reading it a few times a second is enough for
 * something a person is looking at.
 */
export function useHoveredTile(editor: { hover: { gx: number; gy: number } | null } | null) {
  const [hover, setHover] = useState<{ gx: number; gy: number } | null>(null);

  useEffect(() => {
    if (!editor) return;
    const timer = setInterval(() => {
      const at = editor.hover;
      setHover((last) =>
        last?.gx === at?.gx && last?.gy === at?.gy ? last : at ? { ...at } : null,
      );
    }, 120);
    return () => clearInterval(timer);
  }, [editor]);

  return hover;
}
