import type { ReactNode } from 'react';
import { Resizer } from './Resizer';
import { useLayout } from '../state/layout';
import styles from './Shell.module.css';

/**
 * Bar, work, status — and the work row is left panel, viewport, inspector,
 * with a drag handle in each gap. The tool bar is not a column here: it floats
 * over the map, which is the thing it acts on.
 *
 * Every region is a cell in one grid. That is the whole point of the rewrite:
 * the canvas used to be a fixed-position sibling of the interface, docked by
 * CSS arithmetic on the bar and status bar heights and re-flowed by a class set
 * on <html>. Here it is a child like everything else, and it is the grid that
 * decides how big it is.
 *
 * A collapsed panel is not removed — it becomes a stub of its own, which is
 * what gives you somewhere to click to bring it back.
 */
export function Shell({
  game,
  topBar,
  left,
  viewport,
  inspector,
  statusBar,
}: {
  game: string;
  topBar: ReactNode;
  left: ReactNode;
  viewport: ReactNode;
  inspector: ReactNode;
  statusBar: ReactNode;
}) {
  const layout = useLayout(game);

  // Columns and their contents are built together so the two cannot drift: a
  // hidden resizer that still has a track would let you drag a folded panel.
  const columns: string[] = [];
  const cells: ReactNode[] = [];
  const add = (template: string, node: ReactNode, key: string) => {
    columns.push(template);
    // Both minimums, not just the width. A grid item's default minimum is its
    // content, so a panel with a long form in it pushes the whole row taller
    // than the window — and every other region, the canvas included, stretches
    // with it rather than scrolling on its own.
    cells.push(
      <div key={key} style={{ minWidth: 0, minHeight: 0, display: 'grid' }}>
        {node}
      </div>,
    );
  };

  add(layout.leftCollapsed ? 'auto' : `${layout.leftWidth}px`, left, 'left');
  if (!layout.leftCollapsed) {
    columns.push('var(--e-resizer-w)');
    cells.push(
      <Resizer
        key="left-resize"
        label="Resize the left panel"
        width={layout.leftWidth}
        onResize={layout.setLeftWidth}
      />,
    );
  }

  add('minmax(0, 1fr)', viewport, 'viewport');

  if (!layout.inspectorCollapsed) {
    columns.push('var(--e-resizer-w)');
    cells.push(
      <Resizer
        key="inspector-resize"
        label="Resize the inspector"
        width={layout.inspectorWidth}
        onResize={layout.setInspectorWidth}
        invert
      />,
    );
  }
  add(layout.inspectorCollapsed ? 'auto' : `${layout.inspectorWidth}px`, inspector, 'inspector');

  return (
    <div className={styles.shell}>
      {topBar}
      <div className={styles.body} style={{ gridTemplateColumns: columns.join(' ') }}>
        {cells}
      </div>
      {statusBar}
    </div>
  );
}
