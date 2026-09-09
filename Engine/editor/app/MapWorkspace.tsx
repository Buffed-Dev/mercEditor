import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { MAPS, START_MAP, mapIds } from '../../src/data/maps/index.ts';
import { blankMap } from '../document.js';
import { servedGame } from '../games.js';
import { writeMap, writeRules } from '../save.js';
import { Shell } from '../shell/Shell';
import { DockPanel, type PanelTab } from '../shell/DockPanel';
import { StatusBar } from '../shell/StatusBar';
import { ToolRail } from '../shell/ToolRail';
import { TopBar } from '../shell/TopBar';
import { useDocument } from '../state/useDocument';
import { useGame } from '../state/useGame';
import { useLayout } from '../state/layout';
import { say } from '../state/status';
import styles from './MapWorkspace.module.css';
import { useTools } from '../state/tools';
import { IconAngle } from '@tabler/icons-react';
import { IconButton } from '../ui/Button';
import { DEBUG_LAYERS, layerById } from '../terrain/debugLayers.ts';
import { TURN_STEP } from '../viewport/heading';
import { Viewport, useHoveredTile } from '../viewport/Viewport';
import { useStage } from '../viewport/useStage';
import { AssetShelves } from '../panels/AssetShelves';
import { Inspector } from '../panels/Inspector';
import { MapList } from '../panels/MapList';
import { ObjectTree } from '../panels/ObjectTree';
import { useMapTools } from '../viewport/useMapTools';
import { useSelection } from '../state/selection';
import { useVisibility } from '../state/visibility';
import { useShortcuts } from '../state/useShortcuts';
import { Shortcuts } from '../ui/Shortcuts';

const LEFT_TABS = [
  { id: 'objects', label: 'Objects' },
  { id: 'assets', label: 'Assets' },
  { id: 'maps', label: 'Maps' },
] as const satisfies readonly PanelTab<string>[];

type LeftTab = (typeof LEFT_TABS)[number]['id'];

/**
 * The map screen: one screen for the ground and everything standing on it.
 *
 * There is no terrain mode here. The tool in the rail decides which of the two
 * a click means, which is what removed the switch that used to replace the
 * toolbar, the panels and the meaning of a click all at once.
 */
export function MapWorkspace() {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
  const game = useGame(gameId);
  const layout = useLayout(gameId);
  const brush = useTools((state) => state.brush);
  const snapTurns = useTools((state) => state.snapTurns);
  const setSnapTurns = useTools((state) => state.setSnapTurns);

  const hidden = useVisibility((state) => state.hidden);
  const clearHidden = useVisibility((state) => state.clear);

  const [leftTab, setLeftTab] = useState<LeftTab>('objects');
  const [gridVisible, setGridVisible] = useState(true);
  const [debugLayer, setDebugLayer] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  // Asked for at the moment of a rebuild rather than handed over once: these
  // are the rules being edited, and a copy taken when the page loaded would be
  // the rules as they were.
  const content = useCallback(() => {
    const rules = game?.rules;
    return {
      vfx: rules?.list('vfx') ?? [],
      props: rules?.list('props') ?? [],
      assets: rules?.list('assets') ?? [],
      materials: rules?.list('materials') ?? [],
      terrains: rules?.list('terrains') ?? [],
      game: gameId,
    };
  }, [game, gameId]);

  const stage = useStage(host, content);
  const editor = stage?.editor ?? null;

  // The map is opened only once the registry is the opened game's, rather than
  // the one this page happened to be built against.
  useEffect(() => {
    if (!editor || !game) return;
    // Nothing about the last map still applies to this one.
    clearHidden();
    editor.open(MAPS[START_MAP] ?? Object.values(MAPS)[0]);
    // Framed again on the next frame. `open` frames as it builds, but at that
    // moment the panels may not have taken their stored widths yet — and the
    // camera is fitted to the shape of the viewport, so a map framed against
    // the wrong shape comes up pointing at the middle of nowhere.
    const pending = requestAnimationFrame(() => editor.frameAll());
    return () => cancelAnimationFrame(pending);
  }, [editor, game, clearHidden]);

  // A handle on the running editor, for the console. The workspace this
  // replaced published the same one, and it is the only way to ask the scene a
  // question while it is drawing.
  useEffect(() => {
    (window as unknown as { merc?: unknown }).merc = stage ? { ...stage, game } : undefined;
  }, [stage, game]);

  const doc = useDocument(editor?.doc ?? null);
  const rules = useDocument(game?.rules ?? null);
  const hover = useHoveredTile(editor);
  const selection = useSelection((state) => state.selection);
  const clearSelection = useSelection((state) => state.clear);

  // What a click on the map means. The tool decides, which is the whole of the
  // unified map-and-terrain screen.
  useMapTools(editor, doc);

  useShortcuts({
    onSave: () => void onSave(),
    onUndo: () => doc?.undo() !== false && editor?.invalidate(),
    onRedo: () => doc?.redo() !== false && editor?.invalidate(),
    onFrame: () => editor?.frameAll(),
    onToggleGrid: () => setGridVisible((on) => !on),
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
    editor?.setGridVisible(gridVisible);
  }, [editor, gridVisible]);

  // Told to the view rather than written to the document: hiding a light to see
  // what is under it is a fact about this minute of editing, not about the map.
  useEffect(() => {
    editor?.setHiddenObjects(hidden);
  }, [editor, hidden]);

  // A reading of the grid, drawn over it. Recomputed when the terrain changes,
  // which is what the document's revision says.
  useEffect(() => {
    if (!editor || !doc) return;
    const layer = layerById(debugLayer);
    editor.setCellOverlay('debug', layer ? layer.cells(doc.terrain) : [], doc.terrain);
  }, [editor, doc, debugLayer, doc?.revision]);

  /**
   * Both documents, when both have been changed.
   *
   * The map and the rules are two files on disk and one session's work, so
   * "which one does Save mean" has no useful answer — it means the ones with
   * something in them. With nothing changed it still writes the map, because a
   * Save that is asked for and does nothing reads as a Save that failed.
   */
  async function onSave() {
    if (!doc || !rules) return;
    try {
      if (rules.dirty) {
        const files = await writeRules(gameId, rules.data);
        rules.markSaved();
        say(`Wrote ${files} rule files`, 'good');
      }
      if (doc.dirty || !rules.dirty) {
        const file = await writeMap(gameId, doc.map, rules.list('terrains'));
        doc.markSaved();
        say(`Wrote ${file}`, 'good');
      }
    } catch (error) {
      say(`Save failed: ${(error as Error).message}. Is the dev server running?`, 'error');
    }
  }

  function onPlaytest() {
    // The game is a separate page and reads the folder it was served with, so a
    // game this server was not started for cannot be played from here — and
    // saying which one it was started for is more use than a door that leads to
    // the wrong game.
    if (gameId !== servedGame) {
      say(`To play ${gameId}, restart the dev server with GAME=${gameId}.`, 'error');
      return;
    }
    window.open('/', '_blank');
  }

  function onNewMap() {
    const name = window.prompt('New map id (a-z, digits, dashes):', 'dungeon-02');
    if (!name) return;
    editor?.open(blankMap(name.trim().toLowerCase()));
    say(`New map. Save to write it to Games/${gameId}/maps/.`, 'good');
  }

  const dirty = Boolean(doc?.dirty || rules?.dirty);

  // Leaving with unsaved work is worth a prompt. The map is written as module
  // source, which is why the save is deliberate rather than continuous — and
  // why losing a session of it would matter.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

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
          onOpenMap={(id) => {
            clearHidden();
            editor?.open(MAPS[id]);
          }}
          onNewMap={onNewMap}
          canUndo={Boolean(doc?.canUndo)}
          canRedo={Boolean(doc?.canRedo)}
          onUndo={() => {
            if (doc?.undo() !== false) editor?.invalidate();
          }}
          onRedo={() => {
            if (doc?.redo() !== false) editor?.invalidate();
          }}
          dirty={dirty}
          onSave={() => void onSave()}
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
          {leftTab === 'objects' && (
            <ObjectTree doc={doc} onChanged={() => editor?.invalidate()} />
          )}
          {leftTab === 'assets' && (
            <AssetShelves
              terrains={rules?.list('terrains') ?? []}
              onEditTerrain={(id) => void navigate(`/${gameId}/library/terrains/${id}`)}
            />
          )}
          {leftTab === 'maps' && (
            <MapList
              current={doc?.map.id}
              onOpen={(id) => editor?.open(MAPS[id])}
              onNew={onNewMap}
            />
          )}
        </DockPanel>
      }
      viewport={
        <Viewport
          hostRef={host}
          overlay={<ToolRail />}
          gridVisible={gridVisible}
          onToggleGrid={() => setGridVisible((on) => !on)}
          onFrameAll={() => editor?.frameAll()}
        >
          {/*
            What the terrain data *is*, as opposed to what it draws as. When a
            block wears the wrong lid the question is which neighbourhood the
            grid thinks that cell is in, and there is no way to see that from
            the outside.
          */}
          {/*
            The turn handle is the one thing here that is not already on a grid:
            an object sits on a tile whatever you do, but a heading is whatever
            angle you let go at.
          */}
          <IconButton
            label={`Snap turns to ${TURN_STEP}°`}
            active={snapTurns}
            onClick={() => setSnapTurns(!snapTurns)}
          >
            <IconAngle size={17} />
          </IconButton>
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
            mapId={String(doc?.map.id ?? '')}
            onPlaytest={onPlaytest}
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
    </>
  );
}
