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
  IconStairs,
} from '@tabler/icons-react';
import { Fragment, useEffect, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Stepped } from '../fields/Stepped';
import type { FieldSpec } from '../fields/types';
import { IconButton } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { TOOLS, TOOLS_BY_TERRAIN, useTools, type ToolDef, type ToolId } from '../state/tools';
import styles from './ToolRail.module.css';

/** What a terrain swatch needs of a block record. */
export type TerrainRecord = { id: string; label?: string; char?: string };

/** What an edge-profile swatch needs of a profile record. */
export type ProfileRecord = { id: string; label?: string };

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
  'terrain.edge': IconStairs,
};

/**
 * The ground a terrain tool lays, offered on the tool itself.
 *
 * On the tool rather than in a panel across the screen, because the choice is
 * about what the *next* drag will do — a terrain is the tool, not the map.
 * Brush size and level used to live here too, per tool; they are shared
 * across every tool now (see the brush fields in `ToolRail`), so this popover
 * is left with only the palette.
 *
 * Only drawn for the tool that lays a terrain down. Sculpt shares the same
 * brush field but has no ground to choose, and Region takes no settings at
 * all, so both stay plain buttons.
 */
function ToolOptions({
  tool,
  terrains,
  profiles,
  children,
}: {
  tool: ToolDef;
  terrains: readonly TerrainRecord[];
  profiles: readonly ProfileRecord[];
  children: ReactNode;
}) {
  const terrainId = useTools((state) => state.terrainId);
  const setTerrainId = useTools((state) => state.setTerrainId);
  const edgeProfile = String(useTools((state) => state.terrainOptions.edgeProfile) ?? '');
  const setTerrainOption = useTools((state) => state.setTerrainOption);

  const spec = tool.terrainTool;
  // Only the tool that lays a terrain down needs to be told which one. Cutting
  // ground and raising it are the same whatever the ground is made of.
  const palette = spec === 'paint' ? terrains : [];

  // Paint with nothing chosen has nothing to lay down (see paint.onDown, which
  // refuses to run rather than read "nothing picked" as Erase) — so the moment
  // there is a palette and no valid choice in it, default to the first one.
  // A fresh session can then paint right away instead of needing a click just
  // to stop nothing from happening.
  useEffect(() => {
    if (palette.length && !palette.some((terrain) => terrain.id === terrainId)) {
      setTerrainId(palette[0]!.id);
    }
    // `palette` itself is a new array every render (it is derived, not
    // stored) -- depending on its identity would run this on every render for
    // no reason. `spec` and `terrains` are what it is actually made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, terrains, terrainId, setTerrainId]);

  if (spec === 'edge') {
    // Auto first: it is what every edge is until painted, and how one goes back.
    const choices: ProfileRecord[] = [{ id: '', label: 'Auto (terrain default)' }, ...profiles];
    return (
      <Popover.Root>
        <Popover.Trigger className={styles.trigger} render={<span />}>
          {children}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="center" sideOffset={8}>
            <Popover.Popup className={styles.popup}>
              <span className={styles.popupHead}>{tool.label}</span>
              <div className={styles.tiles}>
                {choices.map((profile) => {
                  const name = profile.label ?? profile.id;
                  const on = edgeProfile === profile.id;
                  return (
                    <button
                      key={profile.id || 'auto'}
                      type="button"
                      className={`${styles.tile} ${on ? styles.on : ''}`}
                      aria-pressed={on}
                      title={name}
                      onClick={() => setTerrainOption('edgeProfile', profile.id)}
                    >
                      <span className={styles.chip} aria-hidden="true">
                        {profile.id ? name.slice(0, 2) : 'A'}
                      </span>
                      <span className={styles.tileLabel}>{name}</span>
                    </button>
                  );
                })}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  if (!palette.length) return <>{children}</>;

  return (
    <Popover.Root>
      <Popover.Trigger className={styles.trigger} render={<span />}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={8}>
          <Popover.Popup className={styles.popup}>
            <span className={styles.popupHead}>{tool.label}</span>

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
  profiles = [],
}: {
  only?: readonly ToolId[];
  actions?: ReactNode;
  /** The ground the paint tool can lay, offered on the tool itself. */
  terrains?: readonly TerrainRecord[];
  /** The edge profiles the edge tool can paint, offered on the tool itself. */
  profiles?: readonly ProfileRecord[];
} = {}) {
  const tool = useTools((state) => state.tool);
  const setTool = useTools((state) => state.setTool);
  const brush = useTools((state) => state.brush);
  const options = useTools((state) => state.options);
  const terrainOptions = useTools((state) => state.terrainOptions);
  const setTerrainOption = useTools((state) => state.setTerrainOption);
  // Every brush on the map screen is 'prefab', so the brush itself is not what
  // is in hand -- which prefab is. Saying 'pr' for all seven of them is a
  // read-out that cannot be wrong and cannot be useful either.
  const held = brush === 'prefab' ? String(options.prefab?.prefabId ?? '') || brush : brush;

  const shown = TOOLS.filter((entry) => !only || only.includes(entry.id));
  // Size and level, read off Sculpt: it is the one terrain tool that takes
  // both, and every terrain tool shares the same two fields under the same
  // keys, so there is no second copy to define. Shown only when a terrain
  // tool is actually on offer -- the prefab screen has no ground to size a
  // brush for.
  const brushFields = shown.some((entry) => entry.group === 'terrain')
    ? (TOOLS_BY_TERRAIN.height?.fields ?? [])
    : [];

  return (
    <div className={styles.rail} role="toolbar" aria-orientation="horizontal" aria-label="Tools">
      {shown.map((entry, index) => {
        const Glyph = GLYPHS[entry.id];
        const newGroup = index > 0 && TOOLS[index - 1]?.group !== entry.group;
        return (
          <Fragment key={entry.id}>
            {newGroup && <div className={styles.divider} />}
            <ToolOptions tool={entry} terrains={terrains} profiles={profiles}>
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

      {brushFields.length > 0 && (
        <>
          <div className={styles.divider} />
          <div className={styles.brushFields}>
            {brushFields.map((field) => (
              <Stepped
                key={field.key}
                field={field as FieldSpec}
                value={Number(terrainOptions[field.key] ?? field.default ?? 0)}
                onChange={(value) => setTerrainOption(field.key, value)}
              />
            ))}
          </div>
        </>
      )}

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
