import {
  IconArrowsMove,
  IconRotate360,
  IconResize,
  IconArrowsVertical,
  IconBrush,
  IconEraser,
  IconPointer,
  IconSelect,
  IconTexture,
  IconMountain,
} from '@tabler/icons-react';
import { Fragment, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Field } from '../fields/Field';
import type { FieldSpec, FieldValue } from '../fields/types';
import type { TerrainRecord } from '../panels/AssetShelves';
import { IconButton } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { TOOLS, TOOLS_BY_TERRAIN, useTools, type ToolDef, type ToolId } from '../state/tools';
import styles from './ToolRail.module.css';

const GLYPHS: Record<ToolId, typeof IconPointer> = {
  select: IconPointer,
  move: IconArrowsMove,
  rotate: IconRotate360,
  scale: IconResize,
  place: IconBrush,
  erase: IconEraser,
  'terrain.height': IconArrowsVertical,
  'terrain.paint': IconTexture,
  'terrain.erase': IconMountain,
  'terrain.select': IconSelect,
};

/**
 * A terrain tool's own settings, and the ground it lays.
 *
 * On the tool rather than in a panel across the screen, because both answers
 * are about what the *next* drag will do — a brush width and a terrain are the
 * tool, not the map. They used to live in the Assets tab, which meant reaching
 * away from the thing you were using to change how it behaved, and meant the
 * Assets tab was two unrelated things stacked on each other.
 *
 * Only drawn for a tool that has something to ask. The region tool takes no
 * settings and lays no ground, so it stays a plain button.
 */
function ToolOptions({
  tool,
  terrains,
  onEditTerrain,
  children,
}: {
  tool: ToolDef;
  terrains: readonly TerrainRecord[];
  onEditTerrain?: (id: string) => void;
  children: ReactNode;
}) {
  const terrainId = useTools((state) => state.terrainId);
  const setTerrainId = useTools((state) => state.setTerrainId);
  const terrainOptions = useTools((state) => state.terrainOptions);
  const setTerrainOption = useTools((state) => state.setTerrainOption);

  const spec = tool.terrainTool;
  const fields = (spec ? TOOLS_BY_TERRAIN[spec]?.fields : null) ?? [];
  // Only the tool that lays a terrain down needs to be told which one. Cutting
  // ground and raising it are the same whatever the ground is made of.
  const palette = spec === 'paint' ? terrains : [];

  if (!spec || (!fields.length && !palette.length)) return <>{children}</>;

  return (
    <Popover.Root>
      <Popover.Trigger className={styles.trigger} render={<span />}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={8}>
          <Popover.Popup className={styles.popup}>
            <span className={styles.popupHead}>{tool.label}</span>

            {fields.map((field) => (
              <Field
                key={field.key}
                field={field as FieldSpec}
                value={(terrainOptions[spec]?.[field.key] ?? field.default) as FieldValue}
                onInput={(value) => setTerrainOption(spec, field.key, value as string | number)}
                onChange={(value) => setTerrainOption(spec, field.key, value as string | number)}
              />
            ))}

            {palette.length > 0 && (
              <div className={styles.tiles}>
                {palette.map((terrain) => {
                  const name = terrain.label ?? terrain.id;
                  return (
                    <button
                      key={terrain.id}
                      type="button"
                      className={`${styles.tile} ${terrainId === terrain.id ? styles.on : ''}`}
                      aria-pressed={terrainId === terrain.id}
                      title={name}
                      onClick={() => setTerrainId(terrain.id)}
                      onDoubleClick={() => onEditTerrain?.(terrain.id)}
                    >
                      <span className={styles.chip} aria-hidden="true">
                        {terrain.char ?? terrain.id.slice(0, 2)}
                      </span>
                      <span className={styles.tileLabel}>{name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

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
  terrains = [],
  onEditTerrain,
}: {
  only?: readonly ToolId[];
  actions?: ReactNode;
  /** The ground the paint tool can lay, offered on the tool itself. */
  terrains?: readonly TerrainRecord[];
  onEditTerrain?: (id: string) => void;
} = {}) {
  const tool = useTools((state) => state.tool);
  const setTool = useTools((state) => state.setTool);
  const brush = useTools((state) => state.brush);
  const options = useTools((state) => state.options);
  // Every brush on the map screen is 'prefab', so the brush itself is not what
  // is in hand -- which prefab is. Saying 'pr' for all seven of them is a
  // read-out that cannot be wrong and cannot be useful either.
  const held = brush === 'prefab' ? String(options.prefab?.prefabId ?? '') || brush : brush;

  return (
    <div className={styles.rail} role="toolbar" aria-orientation="horizontal" aria-label="Tools">
      {TOOLS.filter((entry) => !only || only.includes(entry.id)).map((entry, index) => {
        const Glyph = GLYPHS[entry.id];
        const newGroup = index > 0 && TOOLS[index - 1].group !== entry.group;
        return (
          <Fragment key={entry.id}>
            {newGroup && <div className={styles.divider} />}
            <ToolOptions tool={entry} terrains={terrains} onEditTerrain={onEditTerrain}>
              <IconButton
                label={`${entry.label} — ${entry.hint} (${entry.shortcut.toUpperCase()})`}
                side="top"
                active={tool === entry.id}
                onClick={() => setTool(entry.id)}
              >
                <Glyph size={21} />
              </IconButton>
            </ToolOptions>
          </Fragment>
        );
      })}

      {actions && (
        <>
          <div className={styles.divider} />
          {actions}
        </>
      )}

      <Tooltip label={held ? `Holding: ${held}` : 'Nothing in hand'} side="top">
        <div className={styles.brush}>
          <span className={`${styles.swatch} ${held ? '' : styles.empty}`} aria-hidden="true">
            {held ? held.slice(0, 2) : '—'}
          </span>
        </div>
      </Tooltip>
    </div>
  );
}
