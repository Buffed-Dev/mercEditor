import { useCallback, useEffect, useRef, useState } from 'react';
import { redraw } from '../history.ts';
import { useParams } from 'react-router';
import { globalHistory } from '../globalHistory.ts';
import { useGlobalHistory } from '../state/useGlobalHistory';
import { Shell } from '../shell/Shell';
import { DockPanel, type PanelTab } from '../shell/DockPanel';
import { StatusBar } from '../shell/StatusBar';
import { ToolRail } from '../shell/ToolRail';
import { TopBar } from '../shell/TopBar';
import { useDocument } from '../state/useDocument';
import { useGame } from '../state/useGame';
import { useLayout } from '../state/layout';
import { say } from '../state/status';
import { useTools } from '../state/tools';
import { Viewport, useHoveredTile } from '../viewport/Viewport';
import { useStage } from '../viewport/useStage';
import { useMapTools } from '../viewport/useMapTools';
import { useSelection } from '../state/selection';
import { useShortcuts } from '../state/useShortcuts';
import { AssetShelves } from '../panels/AssetShelves';
import { Inspector } from '../panels/Inspector';
import { SnapControl } from '../viewport/SnapControl';
import { ObjectTree } from '../panels/ObjectTree';
import { mapToPrefab, prefabToMap } from '../prefabDoc.ts';
import { normalizePrefab, type Prefab } from '../../src/data/prefabs.ts';

const LEFT_TABS = [
  { id: 'objects', label: 'Contents' },
  { id: 'assets', label: 'Shelf' },
] as const satisfies readonly PanelTab<string>[];

type LeftTab = (typeof LEFT_TABS)[number]['id'];

/**
 * The screen a prefab is built on.
 *
 * A prefab is a map with no terrain, and this is what that buys: the same
 * stage, the same tools, the same object tree, the same inspector. Nothing
 * below knows it is looking at a prefab rather than a map — `prefabToMap` hands
 * the editor a small map and `mapToPrefab` reads back what was built on it.
 *
 * What is different is what is *missing*. There is no map picker, because a
 * prefab is not one of the maps. There is no Maps tab and no chunks, because
 * both are about assembling a place. And the ground is scenery: you are given a
 * floor to judge heights against, and it is thrown away on the way out.
 *
 * Some of the wiring here is the map screen's, copied rather than shared. Two
 * screens is not enough to know what an editor shell would need to be; the
 * third one is when to find out.
 */
export function PrefabWorkspace() {
  const { gameId = '', prefabId = '' } = useParams();
  const game = useGame(gameId);
  const layout = useLayout(gameId);
  const brush = useTools((state) => state.brush);
  const setTool = useTools((state) => state.setTool);
  const host = useRef<HTMLDivElement>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('assets');

  const rules = useDocument(game?.rules ?? null);

  // The same content the map screen hands over, so a prefab is drawn out of the
  // rules being edited rather than the ones that were on disk.
  const content = useCallback(() => {
    const held = game?.rules;
    return {
      vfx: held?.list('vfx') ?? [],
      props: held?.list('props') ?? [],
      prefabs: held?.list('prefabs') ?? [],
      materials: held?.list('materials') ?? [],
      terrains: held?.list('terrains') ?? [],
      profiles: held?.list('profiles') ?? [],
      game: gameId,
    };
  }, [game, gameId]);

  const stage = useStage(host, content);
  const editor = stage?.editor ?? null;
  const doc = useDocument(editor?.doc ?? null);
  const hover = useHoveredTile(editor);
  const selection = useSelection((state) => state.selection);
  const clearSelection = useSelection((state) => state.clear);

  useEffect(() => {
    (window as unknown as { merc?: unknown }).merc = stage ? { ...stage, game } : undefined;
  }, [stage, game]);

  useMapTools(editor, doc);
  const history = useGlobalHistory();

  /** The record being edited, out of the rules document. */
  const index = (rules?.list('prefabs') ?? []).findIndex((one) => one.id === prefabId);
  const record = index >= 0 ? (rules?.list('prefabs') ?? [])[index] : null;

  /**
   * Open it once, when the stage and the record are both there.
   *
   * Keyed on the id rather than the record: the record is mutated in place, so
   * re-opening on every edit would throw away the document you are editing
   * between one keystroke and the next.
   */
  useEffect(() => {
    if (!editor || !rules) return;
    const found = (rules.list('prefabs') ?? []).find((one) => one.id === prefabId);
    if (!found) return;
    const floor = String((rules.list('terrains') ?? [])[0]?.id ?? '');
    editor.open(prefabToMap(normalizePrefab(found), floor));
    // A prefab is objects, so the tool that places them is the one you want.
    setTool('place');
    const pending = requestAnimationFrame(() => editor.frameAll());
    return () => cancelAnimationFrame(pending);
  }, [editor, rules, prefabId, setTool]);

  useEffect(() => {
    editor?.setGridVisible(layout.gridVisible);
  }, [editor, layout.gridVisible]);

  useShortcuts({
    onSave: () => say('Changes save to the draft by themselves. Publish puts them into the game.'),
    onUndo: history.undo,
    onRedo: history.redo,
    onFrame: () => editor?.frameAll(),
    onToggleGrid: layout.toggleGrid,
    onHelp: () => {},
    onEscape: () => {},
    onDelete: () => {
      if (!doc || !selection || selection.index === undefined) return;
      doc.removeObject(selection.list, selection.index);
      clearSelection();
      editor?.invalidate();
    },
  });

  /**
   * What is built on the stage is written back onto the prefab record as it
   * changes, outside the asset history (the stage's own steps undo it), and the
   * library autosave takes it to the draft from there.
   */
  const stageDoc = editor?.doc ?? null;
  useEffect(() => {
    if (!stageDoc || !editor || !rules) return;
    const detach = globalHistory.attach(stageDoc, 'prefab', (result) => redraw(result as never, editor));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = stageDoc.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const found = (rules.list('prefabs') ?? []).find((one) => one.id === prefabId);
        if (found) rules.rewriteRecord('prefabs', prefabId, mapToPrefab(stageDoc.map, found as unknown as Prefab) as never);
      }, 300);
    });
    return () => {
      clearTimeout(timer);
      stop();
      detach();
    };
  }, [stageDoc, editor, rules, prefabId]);

  return (
    <Shell
      game={gameId}
      topBar={
        <TopBar
          game={gameId}
          gameLabel={game?.label ?? gameId}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.undo}
          onRedo={history.redo}
          onPlaytest={() => window.open('/', '_blank')}
        />
      }
      left={
        <DockPanel
          title={String(record?.label ?? prefabId)}
          side="left"
          tabs={LEFT_TABS}
          active={leftTab}
          onSelect={setLeftTab}
          collapsed={layout.leftCollapsed}
          onToggle={layout.toggleLeft}
        >
          {leftTab === 'objects' && (
            <ObjectTree doc={doc} onChanged={() => editor?.invalidate()} />
          )}
          {leftTab === 'assets' && (
            <AssetShelves
              // No prefab palette: a prefab cannot contain itself, and this
              // screen is where the objects one is made of are placed.
              // No ground either -- the floor here is only something to judge
              // heights against, and it is not saved.
              without={['chunk', 'spawn', 'prefab']}
            />
          )}
        </DockPanel>
      }
      viewport={
        <Viewport
          hostRef={host}
          scene={stage?.renderer.scene ?? null}
          // No terrain tools: the floor is scenery for the editing and is
          // thrown away on the way out, so painting it would be work that
          // silently went nowhere.
          overlay={<ToolRail only={['select', 'move', 'rotate', 'scale', 'place', 'erase']} />}
          gridVisible={layout.gridVisible}
          onToggleGrid={layout.toggleGrid}
          onFrameAll={() => editor?.frameAll()}
        >
          <SnapControl />
        </Viewport>
      }
      inspector={
        <DockPanel
          title="Inspector"
          side="right"
          collapsed={layout.inspectorCollapsed}
          onToggle={layout.toggleInspector}
        >
          <Inspector
            doc={doc}
            editor={editor}
            rules={rules}
            game={gameId}
            mapId={String(doc?.map.id ?? '')}
            onPlaytest={() => window.open('/', '_blank')}
            showMap={false}
          />
        </DockPanel>
      }
      statusBar={
        <StatusBar
          context={{
            hover,
            size: doc ? { cols: doc.cols, rows: doc.rows } : undefined,
            brush: brush ? { label: brush } : null,
          }}
        />
      }
    />
  );
}
