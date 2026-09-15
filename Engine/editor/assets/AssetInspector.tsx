import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { IconEye, IconEyeOff } from '@tabler/icons-react';
import { MAPS } from '../../src/data/maps/index.ts';
import { normalizeProfile } from '../../src/data/profiles.ts';
import type { DataDocument } from '../dataDocument.ts';
import { FieldList } from '../fields/FieldList';
import type { FieldSpec } from '../fields/types';
import { VfxDetail } from '../panels/VfxDetail';
import { ProfileTransitions } from '../panels/subeditors/ProfileTransitions';
import { Wirings } from '../panels/subeditors/Wirings';
import { optionsForField } from '../rules/schema';
import { useDocument } from '../state/useDocument';
import { useEdit } from '../state/useEdit';
import { Button, IconButton } from '../ui/Button';
import { fileUrl } from '../../src/data/assets.ts';
import { useAssetSelection } from './assetSelection.ts';
import { fieldSections } from './fields.ts';
import { JSON_TYPES, LIST_OF, TYPE_LABEL, displayName, recordPath, usedBy, type AssetEntry, type JsonType, type LibraryRecord } from './model.ts';
import { useAssetTree } from './session.ts';
import styles from './AssetInspector.module.css';

/** What the preview is asked to replay, bumped by the effect editor. */
export const previewReplay = { count: 0, listeners: new Set<() => void>() };
const replay = () => {
  previewReplay.count += 1;
  for (const listener of previewReplay.listeners) listener();
};

/** The json record at a path, and where it is held. */
export function findRecord(rules: DataDocument | null, entry: AssetEntry | undefined) {
  if (!rules || !entry || !(JSON_TYPES as string[]).includes(entry.type)) return null;
  const type = entry.type as JsonType;
  const list = LIST_OF[type];
  const records = rules.list(list) as LibraryRecord[];
  const index = records.findIndex((record) => recordPath(type, record) === entry.path);
  return index >= 0 ? { type, list, index, record: records[index]! } : null;
}

/** The selected assets, or null when nothing in the Assets panel is selected. */
export function useSelectedAssets(): AssetEntry[] {
  const selected = useAssetSelection((state) => state.selected);
  const entries = useAssetTree((state) => state.entries);
  return selected.map((path) => entries.find((entry) => entry.path === path)).filter((e): e is AssetEntry => Boolean(e));
}

/**
 * The inspector for whatever is selected in the Assets panel: a json asset's
 * fields, a file's facts, or how many things are selected.
 */
export function AssetInspector({ game, rules: rulesDoc }: { game: string; rules: DataDocument | null }) {
  const rules = useDocument(rulesDoc);
  const chosen = useSelectedAssets();
  const previewOpen = useAssetSelection((state) => state.previewOpen);
  const togglePreview = useAssetSelection((state) => state.togglePreview);
  const edit = useEdit(rules, null);
  const navigate = useNavigate();
  const entries = useAssetTree((state) => state.entries);

  if (chosen.length > 1) {
    return <div className={styles.empty}>{chosen.length} items selected</div>;
  }
  const entry = chosen[0];
  if (!entry || !rules) return null;

  const previewable = entry.type !== 'folder' && entry.type !== 'other';
  const head = (
    <header className={styles.head}>
      <span className={styles.kind}>{TYPE_LABEL[entry.type]}</span>
      <span className={styles.name} title={entry.path}>
        {displayName(entry)}
      </span>
      {previewable && (
        <IconButton label={previewOpen ? 'Hide preview' : 'Show preview'} active={previewOpen} onClick={togglePreview}>
          {previewOpen ? <IconEyeOff size={15} /> : <IconEye size={15} />}
        </IconButton>
      )}
    </header>
  );

  const files = {
    game,
    materials: rules.list('materials') as Record<string, unknown>[],
    props: rules.list('props') as Record<string, unknown>[],
  };

  if (entry.type === 'folder') {
    const inside = entries.filter((one) => one.path.startsWith(`${entry.path}/`));
    return (
      <div className={styles.detail}>
        {head}
        <dl className={styles.facts}>
          <dt>Path</dt>
          <dd>Assets/{entry.path}</dd>
          <dt>Folders</dt>
          <dd>{inside.filter((one) => one.dir).length}</dd>
          <dt>Files</dt>
          <dd>{inside.filter((one) => !one.dir).length}</dd>
        </dl>
      </div>
    );
  }

  if (entry.type === 'texture' || entry.type === 'model' || entry.type === 'other') {
    return (
      <div className={styles.detail}>
        {head}
        <FileFacts entry={entry} game={game} rules={rules} />
      </div>
    );
  }

  const found = findRecord(rules, entry);
  if (!found) return <div className={styles.detail}>{head}<p className={styles.empty}>This asset could not be read.</p></div>;
  const { type, list, index, record } = found;

  if (type === 'effect') {
    return (
      <div className={styles.detail}>
        {head}
        <VfxDetail index={index} record={record} doc={rules} onReplay={replay} files={files} />
      </div>
    );
  }

  return (
    <div className={styles.detail}>
      {head}
      <dl className={styles.facts}>
        <dt>Id</dt>
        <dd>{String(record.id)}</dd>
      </dl>
      {type === 'prefab' && (
        <div className={styles.row}>
          <span className={styles.name}>{(record.props as unknown[] | undefined)?.length ?? 0} models</span>
          <Button variant="primary" onClick={() => void navigate(`/${game}/prefabs/${String(record.id)}`)}>
            Open in prefab editor
          </Button>
        </div>
      )}
      {fieldSections(type).map((section) => (
        <section key={section.label || 'fields'} className={styles.section}>
          {section.label && <h3 className={styles.sectionTitle}>{section.label}</h3>}
          <FieldList
            fields={section.fields.map((field) => {
              if (field.kind === 'material') return field;
              const options = optionsForField(field as { kind: string }, rules);
              return options ? ({ ...field, kind: 'select', options } as FieldSpec) : field;
            })}
            values={record}
            files={files}
            onInput={(key, value) => edit.preview(() => rules.update(list, index, { [key]: value }, false))}
            onChange={(key, value) => edit.commit(() => rules.update(list, index, { [key]: value }, false))}
          />
        </section>
      ))}
      {type === 'prefab' && (
        <Wirings
          list="prefabs"
          entry={record}
          onInput={(patch) => edit.preview(() => rules.update(list, index, patch, false))}
          onChange={(patch) => edit.commit(() => rules.update(list, index, patch, false))}
        />
      )}
      {type === 'profile' && (
        <ProfileTransitions
          profile={normalizeProfile(record)}
          options={rules.profileOptions()}
          files={files}
          onPatch={(patch) => edit.commit(() => rules.update(list, index, patch, false))}
        />
      )}
    </div>
  );
}

function FileFacts({ entry, game, rules }: { entry: AssetEntry; game: string; rules: DataDocument }) {
  const [size, setSize] = useState<string>('');
  useEffect(() => {
    setSize('');
    if (entry.type !== 'texture') return;
    const image = new Image();
    image.onload = () => setSize(`${image.naturalWidth} × ${image.naturalHeight}`);
    image.src = fileUrl(entry.path, game);
  }, [entry.path, entry.type, game]);

  const users = entry.id
    ? usedBy(
        entry.id,
        {
          materials: rules.list('materials'),
          terrains: rules.list('terrains'),
          prefabs: rules.list('prefabs'),
          vfx: rules.list('vfx'),
          profiles: rules.list('profiles'),
        },
        Object.values(MAPS).map((map) => ({ id: map.id, value: map })),
      )
    : [];

  return (
    <>
      {entry.type === 'texture' && <img className={styles.bigThumb} src={fileUrl(entry.path, game)} alt="" />}
      <dl className={styles.facts}>
        <dt>Path</dt>
        <dd>Assets/{entry.path}</dd>
        <dt>Size</dt>
        <dd>{entry.size !== undefined ? formatBytes(entry.size) : '—'}</dd>
        {size && (
          <>
            <dt>Pixels</dt>
            <dd>{size}</dd>
          </>
        )}
        <dt>Id</dt>
        <dd>{entry.id ?? 'none'}</dd>
      </dl>
      <h3 className={styles.sectionTitle}>Used by</h3>
      {users.length ? (
        <ul className={styles.users}>
          {users.map((user) => (
            <li key={`${user.type}:${user.id}`}>
              <span className={styles.userType}>{user.type}</span>
              {user.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.users}>Nothing uses it.</p>
      )}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
