import { useMemo, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { IconBox, IconFile, IconFolder, IconPhoto, IconX } from '@tabler/icons-react';
import { fileUrl } from '../../src/data/assets.ts';
import type { MaterialInput } from '../../src/data/materials.ts';
import type { PropInput } from '../../src/data/props.ts';
import { childrenOf, crumbs, displayName, folderOf, type AssetEntry } from '../assets/model.ts';
import { useAssetTree } from '../assets/session.ts';
import { useThumb } from '../assets/thumbs.ts';
import { Button } from './Button';
import { Picker } from './Picker';
import styles from './Picker.module.css';
import dialog from '../assets/Dialogs.module.css';
import panel from '../assets/AssetsPanel.module.css';

/**
 * What a picker needs to know about the project: which game, and the records a
 * material or object field chooses from. The files themselves come from the
 * asset tree.
 */
export type Files = {
  game: string;
  /** Kept for callers that still pass it; files are found from the tree. */
  folder?: string;
  paths?: readonly string[];
  materials?: readonly Record<string, unknown>[];
  props?: readonly Record<string, unknown>[];
};

/** Which entries a slot takes. */
const TAKES: Record<string, AssetEntry['type']> = { mesh: 'model', texture: 'texture', sheet: 'texture' };

/**
 * A texture or model slot: shows what it holds, and opens a browser of the
 * Assets folders to choose another. The value is the file's id, so moving or
 * renaming the file never breaks it.
 */
export function FilePicker({
  label,
  value,
  accept,
  files,
  onChange,
}: {
  label: string;
  value: string;
  accept?: string | undefined;
  files: Files;
  onChange: (value: string) => void;
}) {
  const entries = useAssetTree((state) => state.entries);
  const wants = TAKES[accept ?? ''] ?? null;
  const current = value ? entries.find((entry) => entry.id === value) : undefined;
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState('');

  const inline = value.startsWith('data:');
  const shown = inline ? 'inline image' : current ? displayName(current) : value ? `missing (${value})` : 'None';

  return (
    <>
      <div className={styles.field}>
        <button
          type="button"
          className={styles.trigger}
          aria-label={`${label}: ${shown}`}
          onClick={() => {
            setFolder(current ? folderOf(current.path) : '');
            setOpen(true);
          }}
        >
          <FileThumb entry={current} inline={inline ? value : ''} game={files.game} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value && !current && !inline ? 'var(--e-danger)' : undefined }}>
            {shown}
          </span>
        </button>
        {value && (
          <button type="button" className={styles.trigger} style={{ flex: 'none' }} aria-label={`Clear ${label}`} onClick={() => onChange('')}>
            <IconX size={12} />
          </button>
        )}
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={dialog.backdrop} />
          <Dialog.Popup className={dialog.popup} style={{ width: 'min(620px, calc(100vw - 32px))' }}>
            <Dialog.Title className={dialog.title}>Choose {label.toLowerCase()}</Dialog.Title>
            <nav className={panel.crumbs} style={{ marginBottom: 8 }}>
              {crumbs(folder).map((crumb, index, all) => (
                <span key={crumb.path} className={panel.crumbWrap}>
                  {index > 0 && <span className={panel.slash}>/</span>}
                  <button type="button" className={panel.crumb} disabled={index === all.length - 1} onClick={() => setFolder(crumb.path)}>
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
            <Browser
              entries={entries}
              folder={folder}
              wants={wants}
              value={value}
              game={files.game}
              onFolder={setFolder}
              onPick={(entry) => {
                onChange(entry.id ?? '');
                setOpen(false);
              }}
            />
            <div className={dialog.actions}>
              <Button variant="quiet" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function Browser({
  entries,
  folder,
  wants,
  value,
  game,
  onFolder,
  onPick,
}: {
  entries: readonly AssetEntry[];
  folder: string;
  wants: AssetEntry['type'] | null;
  value: string;
  game: string;
  onFolder: (folder: string) => void;
  onPick: (entry: AssetEntry) => void;
}) {
  const here = useMemo(
    () =>
      childrenOf(entries, folder).filter(
        (entry) => entry.dir || (entry.id && (wants ? entry.type === wants : entry.type === 'texture' || entry.type === 'model')),
      ),
    [entries, folder, wants],
  );
  return (
    <div className={panel.grid} style={{ maxHeight: 360, minHeight: 160, border: '1px solid var(--e-line)', borderRadius: 'var(--e-r)', marginBottom: 12 }}>
      {!here.length && <p className={panel.empty}>Nothing here that fits.</p>}
      {here.map((entry) => (
        <button
          type="button"
          key={entry.path}
          className={`${panel.card} ${entry.id && entry.id === value ? panel.on : ''}`}
          style={{ border: 0, font: 'inherit', cursor: 'pointer' }}
          onClick={() => (entry.dir ? onFolder(entry.path) : onPick(entry))}
        >
          <span className={`${panel.face} ${entry.dir ? panel.faceFolder : ''}`}>
            {entry.dir ? (
              <IconFolder size={36} stroke={1.4} />
            ) : entry.type === 'texture' ? (
              <img className={panel.thumb} src={fileUrl(entry.path, game)} alt="" loading="lazy" />
            ) : (
              <ModelThumb entry={entry} game={game} />
            )}
          </span>
          <span className={panel.name}>{displayName(entry)}</span>
        </button>
      ))}
    </div>
  );
}

const NO_MATERIALS: MaterialInput[] = [];
const NO_PROPS: PropInput[] = [];

function ModelThumb({ entry, game }: { entry: AssetEntry; game: string }) {
  const record = entry.id ? { id: entry.id, mesh: entry.id, path: folderOf(entry.path), label: displayName(entry) } : null;
  const made = useThumb(record ? 'model' : null, record, { game, materials: NO_MATERIALS, props: NO_PROPS });
  return made ? <img className={panel.thumb} src={made} alt="" /> : <IconBox size={24} stroke={1.4} />;
}

function FileThumb({ entry, inline, game }: { entry: AssetEntry | undefined; inline: string; game: string }) {
  if (inline) return <img className={styles.thumb} src={inline} alt="" />;
  if (entry?.type === 'texture') return <img className={styles.thumb} src={fileUrl(entry.path, game)} alt="" loading="lazy" />;
  return <span className={styles.thumb}>{entry?.type === 'model' ? <IconBox size={12} /> : entry ? <IconFile size={12} /> : <IconPhoto size={12} />}</span>;
}

/**
 * A material or object by id, from the document's lists, chosen by looking at
 * it.
 */
export function RecordPicker({
  label,
  value,
  list,
  files,
  onChange,
}: {
  label: string;
  value: string;
  list: 'materials' | 'props';
  files: Files;
  onChange: (value: string) => void;
}) {
  const records = files[list] ?? [];
  const option = (record: Record<string, unknown>) => ({
    id: String(record.id ?? ''),
    label: String(record.label || record.id || ''),
    hint: String(record.path ?? ''),
    thumb: <RecordThumb list={list} record={record} files={files} />,
  });
  const chosen = records.find((one) => one.id === value);
  return (
    <Picker
      label={label}
      current={chosen ? option(chosen) : value ? { id: value, label: `missing (${value})` } : null}
      options={records.map(option)}
      placeholder={`Search ${list === 'props' ? 'models' : 'materials'}`}
      onChange={onChange}
    />
  );
}

function RecordThumb({ list, record, files }: { list: 'materials' | 'props'; record: Record<string, unknown>; files: Files }) {
  const made = useThumb(list === 'materials' ? 'material' : 'model', record, {
    game: files.game,
    materials: (files.materials ?? NO_MATERIALS) as MaterialInput[],
    props: NO_PROPS,
  });
  return made ? <img className={styles.thumb} src={made} alt="" /> : <span className={styles.thumb} />;
}
