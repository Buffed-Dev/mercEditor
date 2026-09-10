import {
  IconArrowsMove,
  IconArrowsVertical,
  IconBrush,
  IconEraser,
  IconPointer,
  IconSelect,
  IconTexture,
  IconMountain,
} from '@tabler/icons-react';
import { Fragment, type ReactNode } from 'react';
import { IconButton } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { TOOLS, useTools, type ToolId } from '../state/tools';
import styles from './ToolRail.module.css';

const GLYPHS: Record<ToolId, typeof IconPointer> = {
  select: IconPointer,
  move: IconArrowsMove,
  place: IconBrush,
  erase: IconEraser,
  'terrain.height': IconArrowsVertical,
  'terrain.paint': IconTexture,
  'terrain.erase': IconMountain,
  'terrain.select': IconSelect,
};

/**
 * @param only which tools to offer, or all of them. The prefab screen has no
 *   terrain to shape, and a tool that edited scenery thrown away on save would
 *   be work that silently went nowhere.
 * @param actions things you *do*, as opposed to modes you are in. A slot rather
 *   than a list of props, so the rail goes on being about tools and whatever
 *   screen it is on decides what it can do.
 */
export function ToolRail({
  only,
  actions,
}: { only?: readonly ToolId[]; actions?: ReactNode } = {}) {
  const tool = useTools((state) => state.tool);
  const setTool = useTools((state) => state.setTool);
  const brush = useTools((state) => state.brush);

  return (
    <div className={styles.rail} role="toolbar" aria-orientation="horizontal" aria-label="Tools">
      {TOOLS.filter((entry) => !only || only.includes(entry.id)).map((entry, index) => {
        const Glyph = GLYPHS[entry.id];
        const newGroup = index > 0 && TOOLS[index - 1].group !== entry.group;
        return (
          <Fragment key={entry.id}>
            {newGroup && <div className={styles.divider} />}
            <IconButton
              label={`${entry.label} — ${entry.hint} (${entry.shortcut.toUpperCase()})`}
              side="top"
              active={tool === entry.id}
              onClick={() => setTool(entry.id)}
            >
              <Glyph size={21} />
            </IconButton>
          </Fragment>
        );
      })}

      {actions && (
        <>
          <div className={styles.divider} />
          {actions}
        </>
      )}

      <Tooltip label={brush ? `Brush: ${brush}` : 'No brush chosen'} side="top">
        <div className={styles.brush}>
          <span className={`${styles.swatch} ${brush ? '' : styles.empty}`} aria-hidden="true">
            {brush ? brush.slice(0, 2) : '—'}
          </span>
        </div>
      </Tooltip>
    </div>
  );
}
