import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { IconUpload } from '@tabler/icons-react';
import { ASSET_EXTENSIONS, fileUrl } from '../../src/data/assets.ts';
import { MATERIAL_SHAPE_KEYS, MATERIAL_SHAPES } from '../../src/data/materials.ts';
import { writeRules } from '../save.ts';
import { Shell } from '../shell/Shell';
import { DockPanel } from '../shell/DockPanel';
import { StatusBar } from '../shell/StatusBar';
import { TopBar } from '../shell/TopBar';
import { FieldList } from '../fields/FieldList';
import type { FieldSpec } from '../fields/types';
import { LIBRARY_KINDS, libraryFields, pathOf, type LibraryKind } from '../rules/library';
import { optionsForField } from '../rules/schema';
import { Button } from '../ui/Button';
import { useDocument } from '../state/useDocument';
import { useEdit } from '../state/useEdit';
import { useGame } from '../state/useGame';
import { useLayout } from '../state/layout';
import { say } from '../state/status';
import { createAssetPreview } from '../preview/assetPreview.ts';
import type { MaterialInput } from '../../src/data/materials.ts';
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
      game: gameId,
      kind: active,
      shape,
      urlOf,
    });
  }, [ready, preview, active, record, shape, urlOf, materials, gameId, doc?.revision]);

  async function onSave() {
    if (!doc) return;
    try {
      const files = await writeRules(gameId, doc.data);
      doc.markSaved();
      say(`Wrote ${files} rule files`, 'good');
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
          <nav className={styles.kinds} aria-label="Library">
            {LIBRARY_KINDS.map((entry) => (
              <NavLink
                key={entry.id}
                to={`/${gameId}/library/${entry.id}`}
                className={styles.kind}
              >
                <span className={styles.kindLabel}>{entry.label}</span>
                <span className={styles.count}>{doc?.list(entry.id).length ?? 0}</span>
              </NavLink>
            ))}
          </nav>

          <div className={styles.records}>
            {records.map((entry) => (
              <button
                key={String(entry.id)}
                type="button"
                className={`${styles.record} ${entry.id === recordId ? styles.on : ''}`}
                onClick={() => void navigate(`/${gameId}/library/${active}/${String(entry.id)}`)}
              >
                <span className={styles.name}>{String(entry.label ?? entry.id)}</span>
                <span className={styles.id}>{String(entry.id)}</span>
              </button>
            ))}
            <Button
              variant="quiet"
              className={styles.add}
              onClick={() => {
                const made = doc?.add(active);
                if (made) {
                  const list = doc?.list(active) ?? [];
                  void navigate(
                    `/${gameId}/library/${active}/${String(list[made.index]?.id ?? '')}`,
                  );
                }
              }}
            >
              New {LIBRARY_KINDS.find((entry) => entry.id === active)?.singular}
            </Button>
          </div>
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
