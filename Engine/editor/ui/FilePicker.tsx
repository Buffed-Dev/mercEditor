import { IconFile } from '@tabler/icons-react';
import { ASSET_KINDS, filePath, fileUrl, isAssetKind } from '../../src/data/assets.ts';
import { urlOfGame, useMaterialThumb } from '../preview/thumbnails.ts';
import { thumbFor } from '../rules/libraryTree.ts';
import { Picker } from './Picker';
import styles from './Picker.module.css';

/**
 * Which file a record names, chosen from the ones the project has.
 *
 * The value a `file` field holds is a name relative to the record's own
 * folder, or `/from/the/assets/root` for a file that lives elsewhere -- see
 * `filePath` -- so the picker needs the folder both to read a value and to
 * write one. A sprite sheet may also still be inline as a data URL, which is
 * a picture but not a file: shown, never offered.
 */
export type Files = {
  game: string;
  /** The record's folder under assets/. */
  folder: string;
  /** Every file under assets/, as paths. Narrowed by `accept` here. */
  paths: readonly string[];
  /** The document's materials, for a field that names one. */
  materials?: readonly Record<string, unknown>[];
  /** And its objects, likewise. */
  props?: readonly Record<string, unknown>[];
};

const IMAGE = /\.(png|jpg|jpeg|webp)$/i;
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function FilePicker({
  label,
  value,
  accept,
  files,
  onChange,
}: {
  label: string;
  value: string;
  accept?: string;
  files: Files;
  onChange: (value: string) => void;
}) {
  const extensions: readonly string[] | null = isAssetKind(accept)
    ? ASSET_KINDS[accept].extensions
    : null;
  const options = files.paths
    .filter((path) => !extensions || extensions.includes(path.split('.').pop()?.toLowerCase() ?? ''))
    .map((path) => ({
      id: path,
      label: nameOf(path),
      hint: path.slice(0, path.lastIndexOf('/')),
      thumb: <FileThumb path={path} game={files.game} />,
    }));

  const inline = value.startsWith('data:');
  const current = inline ? value : filePath(files.folder, value);

  /** Bare name for a file in this record's folder, rooted for one elsewhere. */
  const pick = (path: string) => {
    const own = files.folder ? `${files.folder}/` : '';
    const inside = path.startsWith(own) && !path.slice(own.length).includes('/');
    onChange(!path ? '' : inside ? path.slice(own.length) : `/${path}`);
  };

  return (
    <Picker
      label={label}
      current={
        value
          ? {
              id: current,
              label: inline ? 'inline image' : nameOf(value),
              thumb: <FileThumb path={current} game={files.game} />,
            }
          : null
      }
      options={options}
      placeholder="Search files"
      onChange={pick}
    />
  );
}

function FileThumb({ path, game }: { path: string; game: string }) {
  if (path.startsWith('data:') || IMAGE.test(path)) {
    const src = path.startsWith('data:') ? path : fileUrl(path, game);
    return <img className={styles.thumb} src={src} alt="" loading="lazy" />;
  }
  return (
    <span className={styles.thumb}>
      <IconFile size={12} />
    </span>
  );
}

/**
 * A record by id, from one of the library's lists, chosen by looking at it.
 *
 * A material is drawn on its sphere; an object shows the picture the library
 * card shows for it -- its own texture, or its material's colour map.
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
  const option = (record: Record<string, unknown>, index: number) => ({
    id: String(record.id ?? ''),
    label: String(record.label || record.id || ''),
    thumb: <RecordThumb list={list} index={index} files={files} />,
  });
  const at = records.findIndex((one) => one.id === value);
  return (
    <Picker
      label={label}
      // A value the list no longer offers is still what the record says.
      current={at >= 0 ? option(records[at], at) : value ? { id: value, label: value } : null}
      options={records.map(option)}
      placeholder={`Search ${list === 'props' ? 'objects' : 'materials'}`}
      onChange={onChange}
    />
  );
}

function RecordThumb({
  list,
  index,
  files,
}: {
  list: 'materials' | 'props';
  index: number;
  files: Files;
}) {
  const record = files[list]?.[index];
  if (!record) return <span className={styles.thumb} />;
  if (list === 'materials') return <MaterialThumb record={record} game={files.game} />;
  const thumb = thumbFor(
    { row: 'record', list, index, path: '', name: '', id: '', label: '', missing: [] },
    { props: files.props as Record<string, unknown>[], materials: files.materials as Record<string, unknown>[] },
  );
  return thumb && 'src' in thumb ? (
    <FileThumb path={thumb.src} game={files.game} />
  ) : (
    <span className={styles.thumb} />
  );
}

function MaterialThumb({ record, game }: { record: Record<string, unknown>; game: string }) {
  const made = useMaterialThumb(record, urlOfGame(game));
  return made ? (
    <img className={styles.thumb} src={made} alt="" />
  ) : (
    <span className={styles.thumb} />
  );
}
