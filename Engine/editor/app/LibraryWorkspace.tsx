import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { IconUpload } from '@tabler/icons-react';
import { ASSET_EXTENSIONS, fileUrl } from '../../src/data/assets.ts';
import { MATERIAL_SHAPE_KEYS, MATERIAL_SHAPES } from '../../src/data/materials.ts';
import { makeFolder, moveFolder, writeRules } from '../save.ts';
import { Shell } from '../shell/Shell';
import { DockPanel } from '../shell/DockPanel';
import { StatusBar } from '../shell/StatusBar';
import { TopBar } from '../shell/TopBar';
import { FieldList } from '../fields/FieldList';
import type { FieldSpec } from '../fields/types';
import { LIBRARY_KINDS, libraryFields, pathOf, type LibraryKind } from '../rules/library';
import { LibraryTree } from '../panels/LibraryTree';
import { kindOfFolder, type LibraryRow } from '../rules/libraryTree.ts';
import { useLibrary } from '../state/useLibrary';
import { optionsForField } from '../rules/schema';
import { Button } from '../ui/Button';
import { useDocument } from '../state/useDocument';
import { useEdit } from '../state/useEdit';
import { useGame } from '../state/useGame';
import { useLayout } from '../state/layout';
import { say } from '../state/status';
import { createAssetPreview } from '../preview/assetPreview.ts';
import type { MaterialInput } from '../../src/data/materials.ts';
import type { PropInput } from '../../src/data/props.ts';
import { createMaterialPreview } from '../preview/materialPreview.ts';
import { createVfxPreview } from '../preview/vfxPreview.ts';
import { VfxDetail } from '../panels/VfxDetail';
import { usePreviewStage } from '../viewport/usePreviewStage';
import { kindOfFile, stemOf, uploadAsset } from '../uploadAsset.ts';
import styles from './LibraryWorkspace.module.css';

/** One empty list, so "no document yet" does not look like a change. */
const EMPTY: never[] = [];

/**
 * The library: the records a map is drawn *with*.
 *
 * The same three regions as everywhere else — browse left, look centre, edit
 * right — and here the middle is a canvas again, because these are the records
 * you judge by looking at them. "Roughness 0.35" is not a thing anyone knows
 * the look of.
 */
export function LibraryWorkspace() {
  const { gameId = '', kind, recordId } = useParams<{
    gameId: string;
    kind: LibraryKind;
    recordId: string;
  }>();
  const navigate = useNavigate();
  const game = useGame(gameId);
  const layout = useLayout(gameId);
  const doc = useDocument(game?.rules ?? null);
  const edit = useEdit(doc, null);
  const library = useLibrary(gameId);

  const active: LibraryKind = kind ?? 'materials';
  const records = (doc?.list(active) ?? []) as Record<string, unknown>[];
  const index = records.findIndex((record) => record.id === recordId);
  const record = index >= 0 ? records[index] : null;

  // Which shape a material is shown on. A plane shows the picture and whether
  // the tiling lines up, a cube shows three faces at once — which is where a
  // tiling factor goes wrong — and a sphere has every angle in it, which is the
  // only way to watch a highlight move. Different questions, so it is a choice.
  const [shape, setShape] = useState('box');

  // One stage per kind of record, because they stand different things on it: a
  // material wears a shape, a model stands on a pad, an effect runs. Rebuilt
  // when the kind changes, which is also when the old one should be let go.
  const preview = useMemo(() => {
    if (active === 'materials') return createMaterialPreview();
    if (active === 'vfx') return createVfxPreview();
    return createAssetPreview();
  }, [active]);
  const { host, ready } = usePreviewStage(preview);

  /** A file, by its path under assets/, as a url the dev server will serve. */
  const urlOf = useMemo(() => (path: string) => fileUrl(path, gameId), [gameId]);

  // A handle on the preview, for the console — the same one the map workspace
  // publishes, and the only way to ask a running scene a question.
  useEffect(() => {
    (window as unknown as { merc?: unknown }).merc = { preview, ready, record };
  }, [preview, ready, record]);

  // The lists themselves rather than a memo over them. `doc.list` hands back
  // the array the document holds, so its identity is stable between edits and
  // changes when one replaces it — which is exactly what the effect below wants
  // to hear about, and cheaper than rebuilding a context object per render.
  const materials = doc?.list('materials') ?? EMPTY;
  const props = doc?.list('props') ?? EMPTY;

  /**
   * Every kind's records, for the tree to merge with what is on disk.
   *
   * Built fresh each render rather than memoized. The document is edited in
   * place, so the arrays it hands back keep their identity while their contents
   * change -- which means a memo over them would be a memo that never
   * recomputed, and a rename would not reach the tree. Walking forty rows is
   * not worth being wrong about.
   */
  const byKind = Object.fromEntries(
    LIBRARY_KINDS.map((kind) => [kind.id, doc?.list(kind.id) ?? EMPTY]),
  ) as Partial<Record<LibraryKind, Record<string, unknown>[]>>;

  // Redrawn whenever the record changes. The document is edited in place, so
  // its revision is what says it did.
  useEffect(() => {
    if (!ready || !preview) return;
    // One contract across the three stages: the record, and whatever that kind
    // of stage needs to build it.
    preview.draw(record, {
      // The rules lists are loose records (see dataDocument); which list holds
      // what is known here and nowhere the checker can see.
      materials: materials as unknown as readonly MaterialInput[],
      // A prefab's contents name objects, so the preview needs the list to
      // look them up. The other kinds ignore it.
      props: props as unknown as readonly PropInput[],
      game: gameId,
      kind: active,
      shape,
      urlOf,
    });
  }, [ready, preview, active, record, shape, urlOf, materials, props, gameId, doc?.revision]);

  async function onSave() {
    if (!doc) return;
    try {
      const files = await writeRules(gameId, doc.data);
      doc.markSaved();
      say(`Wrote ${files} files`, 'good');
      void library.refresh();
    } catch (error) {
      say(`Save failed: ${(error as Error).message}. Is the dev server running?`, 'error');
    }
  }

  const fields = record ? libraryFields(active) : [];

  /**
   * Bring files into the open record's own folder.
   *
   * No record is made for them. A file is named by whatever uses it — this
   * material's colour map, that object's mesh — and it is that record's folder
   * the bytes land in, which is what makes the folder copyable and the
   * filename enough to say inside it.
   *
   * The first one is dropped into the field it fits, so the ordinary case —
   * one picture, onto the material you are looking at — takes no second step.
   */
  async function onUpload(files: FileList | null) {
    if (!doc || !record || !files?.length) return;
    const folder = pathOf(record);
    let stored = '';

    for (const file of Array.from(files)) {
      const result = await uploadAsset(gameId, file, folder);
      if ('error' in result) {
        say(result.error, 'error');
        continue;
      }
      stored = result.name;
    }

    if (!stored) return;
    const slot = fields.find(
      (field) => field.kind === 'file' && field.accept === kindOfFile(stored),
    );
    if (slot && !record[slot.key]) doc.update(active, index, { [slot.key]: stored });
    say(`Stored ${stemOf(stored)} in ${folder || 'assets'}/`, 'good');
    void library.refresh();
  }

  /** Open whatever the row is: a record in the inspector, a folder open. */
  function onOpen(row: LibraryRow) {
    if (row.row !== 'record') return;
    void navigate(`/${gameId}/library/${row.list}/${row.id}`);
  }

  /**
   * Claim a file nothing names, by making the record that names it.
   *
   * Which kind is decided by the top folder it is under, because that is the
   * one thing the folder already says. Dropped straight into the field it
   * fits, so importing a normal map does not then ask which slot it was.
   */
  function onImport(path: string) {
    if (!doc) return;
    const folder = path.slice(0, path.lastIndexOf('/'));
    const list = kindOfFolder(path);
    if (!list) {
      return say('Put it under Materials, Objects, Terrain or Effects first', 'error');
    }
    const name = path.slice(path.lastIndexOf('/') + 1);

    // A record already living in this folder takes the file rather than a
    // second record being made beside it: a folder is one record.
    const here = (doc.list(list) as Record<string, unknown>[]).findIndex(
      (entry) => String(entry.path ?? '') === folder,
    );
    const at = here >= 0 ? here : (doc.add(list)?.index ?? -1);
    if (at < 0) return;

    const record = (doc.list(list) as Record<string, unknown>[])[at];
    if (here < 0) doc.update(list, at, { label: stemOf(name), path: folder });

    const slot = libraryFields(list).find(
      (field) => field.kind === 'file' && field.accept === kindOfFile(name) && !record[field.key],
    );
    if (slot) doc.update(list, at, { [slot.key]: name });
    else say(`${name} is in ${folder}, but ${String(record.label)} has no free slot for it`, 'warn');

    void navigate(`/${gameId}/library/${list}/${String(record.id)}`);
    void library.refresh();
  }

  /**
   * Drag a folder into another one.
   *
   * The bytes move first and the document follows, so a request that fails
   * leaves the records saying where things really are. Outside undo, because
   * the folder is real: see `rewrite` in undoable.ts.
   */
  async function onMove(from: string, toFolder: string) {
    if (!doc) return;
    const to = `${toFolder}/${from.slice(from.lastIndexOf('/') + 1)}`;
    const found = LIBRARY_KINDS.flatMap((kind) => {
      const index = (doc.list(kind.id) as Record<string, unknown>[]).findIndex(
        (entry) => String(entry.path ?? '') === from,
      );
      return index >= 0 ? [{ list: kind.id, index }] : [];
    })[0];

    try {
      await moveFolder(gameId, from, to);
    } catch (error) {
      return say((error as Error).message, 'error');
    }
    if (found) {
      const why = doc.setPath(found.list, found.index, to);
      if (why) say(why, 'error');
    }
    say(`Moved to ${to}`, 'good');
    void library.refresh();
  }

  async function onNewFolder() {
    const name = window.prompt('New folder, as a path under assets/', 'Materials/New');
    if (!name) return;
    try {
      await makeFolder(gameId, name);
      say(`Made ${name}`, 'good');
      void library.refresh();
    } catch (error) {
      say((error as Error).message, 'error');
    }
  }

  return (
    <Shell
      game={gameId}
      topBar={
        <TopBar
          game={gameId}
          gameLabel={game?.label ?? gameId}
          canUndo={Boolean(doc?.canUndo)}
          canRedo={Boolean(doc?.canRedo)}
          onUndo={() => doc?.undo()}
          onRedo={() => doc?.redo()}
          dirty={Boolean(doc?.dirty)}
          onSave={() => void onSave()}
          onPlaytest={() => window.open('/', '_blank')}
        />
      }
      left={
        <DockPanel
          title="Library"
          side="left"
          collapsed={layout.leftCollapsed}
          onToggle={layout.toggleLeft}
        >
          <LibraryTree
            game={gameId}
            scan={library.scan}
            records={byKind}
            selected={record ? pathOf(record) : ''}
            onOpen={onOpen}
            onImport={onImport}
            onMove={(from, to) => void onMove(from, to)}
            onRefresh={() => void library.refresh()}
            onNewFolder={() => void onNewFolder()}
            onNew={(kind) => {
              const made = doc?.add(kind);
              if (!made) return;
              const list = doc?.list(kind) ?? [];
              void navigate(`/${gameId}/library/${kind}/${String(list[made.index]?.id ?? '')}`);
            }}
          />
        </DockPanel>
      }
      viewport={
        <div className={styles.stage}>
          <canvas ref={host} className={styles.canvas} />
          {/* Only a material has a choice of shape: a plane shows the picture,
              a cube shows three faces at once, a sphere every angle. */}
          {active === 'materials' && (
            <div className={styles.shapes} role="toolbar" aria-label="Preview shape">
              {(MATERIAL_SHAPE_KEYS as string[]).map((id) => (
                <Button key={id} variant="quiet" active={shape === id} onClick={() => setShape(id)}>
                  {(MATERIAL_SHAPES as Record<string, { label: string }>)[id]?.label ?? id}
                </Button>
              ))}
            </div>
          )}
        </div>
      }
      inspector={
        <DockPanel
          title="Detail"
          side="right"
          collapsed={layout.inspectorCollapsed}
          onToggle={layout.toggleInspector}
        >
          {record && doc && active === 'vfx' ? (
            <VfxDetail
              index={index}
              record={record}
              doc={doc}
              onReplay={() => preview?.draw(record, { kind: active })}
            />
          ) : record && doc ? (
            <div className={styles.detail}>
              <header className={styles.head}>
                <span className={styles.kindTag}>
                  {LIBRARY_KINDS.find((entry) => entry.id === active)?.singular}
                </span>
                <span className={styles.recordId}>{String(record.id)}</span>
              </header>
              {/* A prefab is contents rather than settings, so the way to
                  edit one is a stage, not this form. */}
              {active === 'prefabs' && (
                <div className={styles.fileRow}>
                  <span className={styles.fileName}>
                    {(record.props as unknown[] | undefined)?.length ?? 0} objects
                  </span>
                  <Button
                    variant="primary"
                    onClick={() => void navigate(`/${gameId}/prefabs/${String(record.id)}`)}
                  >
                    Open in editor
                  </Button>
                </div>
              )}
              <div className={styles.fileRow}>
                <span className={styles.fileName}>{pathOf(record) || 'assets'}/</span>
                <label className={styles.replace}>
                  <IconUpload size={13} />
                  Add files…
                  <input
                    type="file"
                    multiple
                    accept={ASSET_EXTENSIONS.map((ext: string) => `.${ext}`).join(',')}
                    className={styles.file}
                    onChange={(event) => {
                      void onUpload(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
              <FieldList
                fields={fields.map((field) => {
                  // A terrain names a material, an ability an effect: pickers
                  // over the document's own lists. A `file` field is not one of
                  // them — it names a file in this record's folder, which the
                  // document knows nothing about.
                  const options = optionsForField(
                    field as { kind: string; assetKind?: string },
                    doc,
                  );
                  return options
                    ? ({ ...field, kind: 'select', options } as FieldSpec)
                    : field;
                })}
                values={record}
                onInput={(key, value) =>
                  edit.preview(() => doc.update(active, index, { [key]: value }, false))
                }
                onChange={(key, value) =>
                  edit.commit(() => doc.update(active, index, { [key]: value }, false))
                }
              />
            </div>
          ) : (
            <p className={styles.noPreview}>Pick a record to edit it.</p>
          )}
        </DockPanel>
      }
      statusBar={<StatusBar />}
    />
  );
}
