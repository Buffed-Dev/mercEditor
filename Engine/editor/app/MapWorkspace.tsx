import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useParams } from 'react-router';
import { redraw } from '../history.ts';
import { MAPS, START_MAP, mapIds, registerMap } from '../../src/data/maps/index.ts';
import { blankMap } from '../document.ts';
import { servedGame } from '../games.ts';
import { globalHistory } from '../globalHistory.ts';
import { terrainCharOf } from '../save.ts';
import { serializeMap } from '../serialize.ts';
import { Shell } from '../shell/Shell';
import { DockPanel, type PanelTab } from '../shell/DockPanel';
import { StatusBar } from '../shell/StatusBar';
import { ToolRail } from '../shell/ToolRail';
import { TopBar } from '../shell/TopBar';
import { useDocument } from '../state/useDocument';
import { useGame } from '../state/useGame';
import { useGlobalHistory } from '../state/useGlobalHistory';
import { useLayout } from '../state/layout';
import { say } from '../state/status';
import styles from './MapWorkspace.module.css';
import { useTools } from '../state/tools';
import { IconPackage } from '@tabler/icons-react';
import { IconButton } from '../ui/Button';
import { DEBUG_LAYERS, layerById } from '../terrain/debugLayers.ts';
import { SnapControl } from '../viewport/SnapControl';
import type { Terrain } from '../../src/data/terrains.ts';
import type { ProfileRecord, TerrainRecord } from '../shell/ToolRail';
import { Viewport, useHoveredTile } from '../viewport/Viewport';
import { useStage } from '../viewport/useStage';
import { Inspector } from '../panels/Inspector';
import { MapList } from '../panels/MapList';
import { ObjectTree } from '../panels/ObjectTree';
import { useMapTools } from '../viewport/useMapTools';
import { useSelection } from '../state/selection';
import { prefabFromSelection, unpackPrefab } from '../prefabFromSelection.ts';
import { clipboardSize, copyObjects, pasteObjects } from '../clipboard.ts';
import { normalizePrefab, type Prefab } from '../../src/data/prefabs.ts';
import { useVisibility } from '../state/visibility';
import { useShortcuts } from '../state/useShortcuts';
import { Shortcuts } from '../ui/Shortcuts';
import { AssetsPanel, PREFAB_DRAG_TYPE, dragging } from '../assets/AssetsPanel';
import { AssetInspector, useSelectedAssets } from '../assets/AssetInspector';
import { PreviewPanel } from '../assets/PreviewPanel';
import { autosaveMap, useAssetTree } from '../assets/session.ts';

const LEFT_TABS = [
  { id: 'objects', label: 'Objects' },
  { id: 'assets', label: 'Assets' },
  { id: 'maps', label: 'Maps' },
] as const satisfies readonly PanelTab<string>[];

type LeftTab = (typeof LEFT_TABS)[number]['id'];

/**
 * The map screen: one screen for the ground and everything standing on it, and
 * the game's Assets folder beside it.
 *
 * Nothing here is saved by hand. The map and every asset autosave to the
 * draft, and Publish in the top bar puts the draft into the game.
 */
export function MapWorkspace({ active = true }: { active?: boolean } = {}) {
  const { gameId, game, layout, brush, setBrush, setTool, setOption } = useWorkspaceBasics();

  const hidden = useVisibility((state) => state.hidden);
  const clearHidden = useVisibility((state) => state.clear);

  const [leftTab, setLeftTab] = useState<LeftTab>('assets');
  const [debugLayer, setDebugLayer] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  // Asked for at the moment of a rebuild: these are the records being edited.
  const content = useCallback(() => {
    const rules = game?.rules;
    return {
      vfx: rules?.list('vfx') ?? [],
      props: rules?.list('props') ?? [],
      prefabs: rules?.list('prefabs') ?? [],
      materials: rules?.list('materials') ?? [],
      terrains: rules?.list('terrains') ?? [],
      profiles: rules?.list('profiles') ?? [],
      game: gameId,
    };
  }, [game, gameId]);

  const stage = useStage(host, content, active);
  const editor = stage?.editor ?? null;

  useEffect(() => {
    if (active) editor?.refreshTerrainMaterials();
  }, [active, editor]);

  const openMap = useCallback(
    (id: string) => {
      const map = MAPS[id];
      if (!editor || !map) return;
      clearHidden();
      editor.open(map);
    },
    [editor, clearHidden],
  );

  useEffect(() => {
    if (!editor || !game) return;
    openMap(START_MAP in MAPS ? START_MAP : (Object.keys(MAPS)[0] ?? ''));
    const pending = requestAnimationFrame(() => editor.frameAll());
    return () => cancelAnimationFrame(pending);
  }, [editor, game, openMap]);

  useEffect(() => {
    (window as unknown as { merc?: unknown }).merc = stage
      ? { ...stage, editor: stage.editor, game, history: globalHistory, assets: useAssetTree }
      : undefined;
  }, [stage, game]);

  const doc = useDocument(editor?.doc ?? null);
  const rules = useDocument(game?.rules ?? null);
  const hover = useHoveredTile(editor);
  const selection = useSelection((state) => state.selection);
  const picked = useSelection((state) => state.picked);
  const clearSelection = useSelection((state) => state.clear);
  const history = useGlobalHistory();
  const assetsSelected = useSelectedAssets().length > 0;

  useMapTools(editor, doc);

  // Every step on the open map goes on the one history, and every change to it
  // is written to the draft.
  const map = editor?.doc ?? null;
  useEffect(() => {
    if (!map || !editor || !game) return;
    const detach = globalHistory.attach(map, 'map', (result) => redraw(result as never, editor));
    // A block that is gone keeps the key the map already gave it, so a map
    // naming missing blocks is written back unchanged rather than renumbered.
    const charOf = (id: string) =>
      terrainCharOf(game.rules.list('terrains') as unknown as Terrain[])(id) ||
      (Object.entries((map.map as { terrainKeys?: Record<string, string> }).terrainKeys ?? {}).find(
        ([, named]) => named === id,
      )?.[0] ??
        '');
    const source = () => ({ id: String(map.map.id), source: serializeMap(map.map, charOf) });
    const stop = autosaveMap(gameId, map, source, () => registerMap(structuredClone(map.map)));
    return () => {
      detach();
      stop();
    };
  }, [map, editor, game, gameId]);

  function onCopy() {
    if (!doc) return;
    const many = copyObjects(doc, picked, selection);
    say(many ? `Copied ${many} object${many > 1 ? 's' : ''}` : 'Nothing picked to copy', many ? 'good' : 'error');
  }

  function onPaste() {
    if (!doc) return;
    if (!clipboardSize()) return say('Nothing copied', 'error');
    const at = hover ?? { gx: 1, gy: 1 };
    const why = pasteObjects(doc, at.gx, at.gy);
    if (why) return say(why, 'error');
    editor?.invalidate();
    say(`Pasted ${clipboardSize()} object${clipboardSize() > 1 ? 's' : ''}`, 'good');
  }

  useShortcuts({
    onSlot: (slot: number) => {
      const prefab = (rules?.list('prefabs') ?? [])[slot] as { id?: string } | undefined;
      if (!prefab?.id) return;
      setOption('prefab', 'prefabId', prefab.id);
      setBrush('prefab');
      setTool('place');
    },
    // Everything autosaves; Ctrl+S has nothing left to do.
    onSave: () => say('Changes save to the draft by themselves. Publish puts them into the game.'),
    onCopy,
    onPaste,
    onUndo: history.undo,
    onRedo: history.redo,
    onFrame: () => editor?.frameAll(),
    onToggleGrid: layout.toggleGrid,
    onHelp: () => setHelpOpen(true),
    onEscape: () => setHelpOpen(false),
    onDelete: () => {
      if (!doc || !selection || selection.index === undefined) return;
      doc.removeObject(selection.list, selection.index);
      clearSelection();
      editor?.invalidate();
    },
  });

  useEffect(() => {
    editor?.setGridVisible(layout.gridVisible);
  }, [editor, layout.gridVisible]);

  useEffect(() => {
    editor?.setHiddenObjects(hidden);
  }, [editor, hidden]);

  useEffect(() => {
    if (!editor || !doc) return;
    const layer = layerById(debugLayer);
    editor.setCellOverlay('debug', layer ? layer.cells(doc.terrain) : [], doc.terrain);
  }, [editor, doc, debugLayer, doc?.revision]);

  function onPlaytest() {
    if (gameId !== servedGame) {
      say(`To play ${gameId}, restart the dev server with GAME=${gameId}.`, 'error');
      return;
    }
    say('Playtest runs the published game. Publish first to try your latest changes.');
    window.open('/', '_blank');
  }

  function onNewMap() {
    const name = window.prompt('New map id (a-z, digits, dashes):', 'dungeon-02');
    if (!name) return;
    editor?.open(blankMap(name.trim().toLowerCase()));
    say(`New map. It saves to the draft as you edit it.`, 'good');
  }

  const prefabOf = (id: string): Prefab | null => {
    const found = (rules?.list('prefabs') ?? []).find((one) => one.id === id);
    return found ? normalizePrefab(found) : null;
  };

  function onMakePrefab(picked: ReadonlySet<string>) {
    if (!doc || !rules) return;
    const name = window.prompt(`Make a prefab of ${picked.size} objects. Call it:`, 'Camp');
    if (!name) return;
    const made = prefabFromSelection(doc, picked, rules, name.trim());
    if (typeof made === 'string') return say(made, 'error');
    clearSelection();
    editor?.invalidate();
    say(`Made "${name.trim()}".`, 'good');
  }

  function onUnpack(index: number) {
    if (!doc) return;
    const why = unpackPrefab(doc, index, prefabOf);
    if (why) return say(why, 'error');
    clearSelection();
    editor?.invalidate();
    say('Unpacked into loose objects', 'good');
  }

  /**
   * A prefab dragged from the Assets panel: while it is over the map it is the
   * brush in hand, with its ghost on the tile under the pointer; dropped, it is
   * placed by the same rules a click with that brush places by.
   */
  const held = useRef<{ tool: string; brush: string | null } | null>(null);
  const restore = () => {
    if (!held.current) return;
    setTool(held.current.tool as never);
    setBrush(held.current.brush as never);
    held.current = null;
  };
  const dropHandlers = {
    onDragOver: (event: DragEvent) => {
      if (!editor || !dragging.prefabId || !event.dataTransfer.types.includes(PREFAB_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      if (!held.current) {
        const tools = useTools.getState();
        held.current = { tool: tools.tool, brush: tools.brush };
        setOption('prefab', 'prefabId', dragging.prefabId);
        setBrush('prefab');
        setTool('place');
      }
      editor.hoverAt(event.clientX, event.clientY);
    },
    onDragLeave: (event: DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      restore();
    },
    onDrop: (event: DragEvent) => {
      const id = event.dataTransfer.getData(PREFAB_DRAG_TYPE);
      if (!editor || !id) return;
      event.preventDefault();
      setOption('prefab', 'prefabId', id);
      // The brush was set on dragover; one frame for the tool effect to take it.
      requestAnimationFrame(() => {
        editor.paintAt(event.clientX, event.clientY);
        restore();
      });
    },
  };

  return (
    <>
      <Shortcuts open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Shell
        game={gameId}
        topBar={
          <TopBar
            game={gameId}
            gameLabel={game?.label ?? gameId}
            mapId={doc?.map.id}
            maps={mapIds().map((id: string) => ({ id, label: MAPS[id]?.name ?? id }))}
            onOpenMap={openMap}
            onNewMap={onNewMap}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
            onPlaytest={onPlaytest}
          />
        }
        left={
          <DockPanel
            title="Contents"
            side="left"
            tabs={LEFT_TABS}
            active={leftTab}
            onSelect={setLeftTab}
            collapsed={layout.leftCollapsed}
            onToggle={layout.toggleLeft}
          >
            {leftTab === 'objects' && <ObjectTree doc={doc} onChanged={() => editor?.invalidate()} />}
            {leftTab === 'assets' && (
              <AssetsPanel
                game={gameId}
                rules={rules}
                folder={layout.folder}
                onFolder={layout.setFolder}
                mapValue={() => (doc ? { id: String(doc.map.id), value: doc.map } : null)}
              />
            )}
            {leftTab === 'maps' && <MapList current={doc?.map.id} onOpen={openMap} onNew={onNewMap} />}
          </DockPanel>
        }
        viewport={
          <div className={styles.work}>
            <div className={styles.stage} {...dropHandlers}>
              <Viewport
                hostRef={host}
                scene={stage?.renderer.scene ?? null}
                overlay={
                  <ToolRail
                    terrains={(rules?.list('terrains') ?? []) as TerrainRecord[]}
                    profiles={(rules?.list('profiles') ?? []) as ProfileRecord[]}
                    actions={
                      <IconButton
                        label={
                          picked.size
                            ? `Make a prefab of ${picked.size} ${picked.size === 1 ? 'object' : 'objects'}`
                            : 'Make a prefab — pick some objects first'
                        }
                        side="top"
                        disabled={picked.size === 0}
                        onClick={() => onMakePrefab(picked)}
                      >
                        <IconPackage size={21} />
                      </IconButton>
                    }
                  />
                }
                gridVisible={layout.gridVisible}
                onToggleGrid={layout.toggleGrid}
                onFrameAll={() => editor?.frameAll()}
              >
                <SnapControl />
                <select
                  className={styles.debug}
                  aria-label="Debug layer"
                  title={layerById(debugLayer)?.hint ?? 'Draw a reading of the terrain data over the map'}
                  value={debugLayer}
                  onChange={(event) => setDebugLayer(event.target.value)}
                >
                  <option value="">No overlay</option>
                  {DEBUG_LAYERS.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      {layer.label}
                    </option>
                  ))}
                </select>
              </Viewport>
            </div>
            <PreviewPanel game={gameId} rules={rules} />
          </div>
        }
        inspector={
          <DockPanel
            title="Inspector"
            side="right"
            collapsed={layout.inspectorCollapsed}
            onToggle={layout.toggleInspector}
          >
            {assetsSelected ? (
              <AssetInspector game={gameId} rules={rules} />
            ) : (
              <Inspector
                doc={doc}
                editor={editor}
                rules={rules}
                game={gameId}
                mapId={String(doc?.map.id ?? '')}
                onPlaytest={onPlaytest}
                onUnpack={onUnpack}
              />
            )}
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
    </>
  );
}


/** What every map-like workspace reads first. */
function useWorkspaceBasics() {
  const { gameId = '' } = useParams();
  const game = useGame(gameId);
  const layout = useLayout(gameId);
  const brush = useTools((state) => state.brush);
  const setBrush = useTools((state) => state.setBrush);
  const setTool = useTools((state) => state.setTool);
  const setOption = useTools((state) => state.setOption);
  return { gameId, game, layout, brush, setBrush, setTool, setOption };
}
