import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { writeRules } from '../save.ts';
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
  const navigate = useNavigate();
  const game = useGame(gameId);
  const layout = useLayout(gameId);
  const brush = useTools((state) => state.brush);
  const setTool = useTools((state) => state.setTool);
  const host = useRef<HTMLDivElement>(null);
  const [gridVisible, setGridVisible] = useState(true);
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
    editor?.setGridVisible(gridVisible);
  }, [editor, gridVisible]);

  useShortcuts({
    onSave: () => void onSave(),
    onUndo: () => doc?.undo() !== false && editor?.invalidate(),
    onRedo: () => doc?.redo() !== false && editor?.invalidate(),
    onFrame: () => editor?.frameAll(),
    onToggleGrid: () => setGridVisible((on) => !on),
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
   * Write what was built back onto the record, and save the library with it.
   *
   * The prefab is a record in the rules document rather than a file of its own
   * to post, so saving it is saving that — which is also what makes a prefab
   * and the objects it names travel together.
   */
  async function onSave() {
    if (!doc || !rules || index < 0 || !record) return;
    try {
      rules.update('prefabs', index, mapToPrefab(doc.map, record as unknown as Prefab));
      const files = await writeRules(gameId, rules.data);
      rules.markSaved();
      doc.markSaved();
      say(`Wrote ${files} files`, 'good');
    } catch (error) {
      say(`Save failed: ${(error as Error).message}. Is the dev server running?`, 'error');
    }
  }

  const dirty = Boolean(doc?.dirty || rules?.dirty);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <Shell
      game={gameId}
      topBar={
        <TopBar
          game={gameId}
          gameLabel={game?.label ?? gameId}
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
          onPlaytest={() => void navigate(`/${gameId}/library/prefabs/${prefabId}`)}
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
              // No terrains: there is no ground here to paint, only the floor
              // laid down to judge heights against, and it is not saved.
              terrains={[]}
              onEditTerrain={(id) => void navigate(`/${gameId}/library/terrains/${id}`)}
              // A prefab cannot contain the ground it stands on, nor the start
              // tile of a map, nor a chunk of one -- nor itself.
              without={['chunk', 'spawn', 'prefab']}
            />
          )}
        </DockPanel>
      }
      viewport={
        <Viewport
          hostRef={host}
          // No terrain tools: the floor is scenery for the editing and is
          // thrown away on the way out, so painting it would be work that
          // silently went nowhere.
          overlay={<ToolRail only={['select', 'move', 'place', 'erase']} />}
          gridVisible={gridVisible}
          onToggleGrid={() => setGridVisible((on) => !on)}
          onFrameAll={() => editor?.frameAll()}
        />
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
            onPlaytest={() => void navigate(`/${gameId}/library/prefabs/${prefabId}`)}
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
