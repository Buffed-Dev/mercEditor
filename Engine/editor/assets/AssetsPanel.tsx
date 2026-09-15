import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  IconBox,
  IconCube,
  IconFolder,
  IconFolderPlus,
  IconPackage,
  IconPalette,
  IconPhoto,
  IconPlus,
  IconSparkles,
  IconUpload,
  IconFile,
  IconStairs,
} from '@tabler/icons-react';
import { fileUrl } from '../../src/data/assets.ts';
import type { MaterialInput } from '../../src/data/materials.ts';
import type { PropInput } from '../../src/data/props.ts';
import type { ProfileInput } from '../../src/data/profiles.ts';
import { MAPS } from '../../src/data/maps/index.ts';
import type { DataDocument } from '../dataDocument.ts';
import { useDocument } from '../state/useDocument';
import { say } from '../state/status';
import { Button } from '../ui/Button';
import { DropdownMenu, MenuItem, MenuSeparator } from '../ui/Menu';
import { Tooltip } from '../ui/Tooltip';
import { useAssetSelection } from './assetSelection.ts';
import { ConflictDialog, DeleteDialog, MoveDialog, askConflict } from './Dialogs';
import { createFileOps, type Ops } from './fileOps.ts';
import {
  ACCEPT,
  JSON_TYPES,
  TYPE_LABEL,
  childrenOf,
  crumbs,
  displayName,
  folderOf,
  usedBy,
  type AssetEntry,
  type EntryType,
  type JsonType,
  type LibraryRecord,
  type User,
} from './model.ts';
import { useAssetTree } from './session.ts';
import { useThumb, type ThumbContext } from './thumbs.ts';
import styles from './AssetsPanel.module.css';

/** The drag payload: the paths being dragged, and a prefab's id when it is one. */
export const DRAG_TYPE = 'application/x-merc-assets';
export const PREFAB_DRAG_TYPE = 'application/x-merc-prefab';

/** The prefab being dragged, readable while dragging (a drag's data is not). */
export const dragging = { prefabId: '' };

const GLYPH: Record<EntryType, typeof IconBox> = {
  folder: IconFolder,
  material: IconPalette,
  block: IconCube,
  prefab: IconPackage,
  effect: IconSparkles,
  profile: IconStairs,
  texture: IconPhoto,
  model: IconBox,
  other: IconFile,
};

let opsFor: { game: string; rules: DataDocument; ops: Ops } | null = null;
/** One set of file operations per game document. */
export function useFileOps(game: string, rules: DataDocument | null): Ops | null {
  if (!rules) return null;
  if (!opsFor || opsFor.game !== game || opsFor.rules !== rules) {
    opsFor = { game, rules, ops: createFileOps(game, rules, askConflict) };
  }
  return opsFor.ops;
}

/**
 * The game's Assets folder, as a drive: folders and files in a thumbnail grid,
 * with the folder you are in remembered.
 */
export function AssetsPanel({
  game,
  rules: rulesDoc,
  folder,
  onFolder,
  mapValue,
}: {
  game: string;
  rules: DataDocument | null;
  folder: string;
  onFolder: (folder: string) => void;
  /** The open map, so a delete can say it uses something. */
  mapValue?: () => { id: string; value: unknown } | null;
}) {
  const rules = useDocument(rulesDoc);
  const ops = useFileOps(game, rules);
  const { entries, errors, loaded } = useAssetTree();
  const { selected, anchor, renaming, select, clear, setRenaming, moved } = useAssetSelection();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [deleting, setDeleting] = useState<{ targets: AssetEntry[]; users: User[] } | null>(null);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  // A folder that is gone (deleted, moved, undone) is not somewhere to stand.
  const folderExists = !folder || entries.some((entry) => entry.dir && entry.path === folder);
  useEffect(() => {
    if (loaded && !folderExists) onFolder(folderOf(folder));
  }, [loaded, folderExists, folder, onFolder]);

  const here = useMemo(() => childrenOf(entries, folder), [entries, folder]);
  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const chosen = selected.map((path) => byPath.get(path)).filter((entry): entry is AssetEntry => Boolean(entry));

  const context: ThumbContext = {
    game,
    materials: (rules?.list('materials') ?? []) as unknown as MaterialInput[],
    props: (rules?.list('props') ?? []) as unknown as PropInput[],
    profiles: (rules?.list('profiles') ?? []) as unknown as ProfileInput[],
  };

  const fail = (error: unknown) => say((error as Error).message, 'error');

  function onCardClick(event: MouseEvent, entry: AssetEntry) {
    if (event.ctrlKey || event.metaKey) {
      const next = selected.includes(entry.path) ? selected.filter((p) => p !== entry.path) : [...selected, entry.path];
      select(next, entry.path);
      return;
    }
    if (event.shiftKey && anchor) {
      const paths = here.map((one) => one.path);
      const a = paths.indexOf(anchor);
      const b = paths.indexOf(entry.path);
      if (a >= 0 && b >= 0) {
        select(paths.slice(Math.min(a, b), Math.max(a, b) + 1), anchor);
        return;
      }
    }
    select([entry.path], entry.path);
  }

  async function newFolder() {
    if (!ops) return;
    try {
      const path = await ops.newFolder(folder);
      select([path]);
      setRenaming(path);
    } catch (error) {
      fail(error);
    }
  }

  async function newAsset(type: JsonType) {
    if (!ops) return;
    try {
      const path = await ops.newAsset(type, folder);
      select([path]);
      setRenaming(path);
    } catch (error) {
      fail(error);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!ops || !files?.length) return;
    try {
      const count = await ops.importFiles([...files], folder);
      if (count) say(`Added ${count} file${count > 1 ? 's' : ''} to ${folder || 'Assets'}`, 'good');
    } catch (error) {
      fail(error);
    }
  }

  async function commitRename(entry: AssetEntry, value: string) {
    setRenaming(null);
    if (!ops || value.trim() === displayName(entry)) return;
    try {
      const to = await ops.rename(entry, value);
      moved(entry.path, to);
    } catch (error) {
      fail(error);
    }
  }

  async function moveInto(paths: string[], target: string) {
    if (!ops) return;
    const list = paths.map((path) => byPath.get(path)).filter((entry): entry is AssetEntry => Boolean(entry));
    try {
      const count = await ops.move(list, target);
      if (count) {
        clear();
        say(`Moved ${count} item${count > 1 ? 's' : ''} to ${target || 'Assets'}`, 'good');
      }
    } catch (error) {
      fail(error);
    }
  }

  async function duplicate(entry: AssetEntry) {
    if (!ops) return;
    try {
      const path = await ops.duplicate(entry);
      select([path]);
    } catch (error) {
      fail(error);
    }
  }

  /** Ids a set of entries stands for: their own, and everything under a folder. */
  function idsOf(targets: readonly AssetEntry[]): Set<string> {
    const ids = new Set<string>();
    const add = (entry: AssetEntry) => {
      if (entry.id) ids.add(entry.id);
      const found = ops?.recordAt(entry.path);
      if (found) ids.add(String(found.record.id));
    };
    for (const target of targets) {
      add(target);
      if (target.dir) for (const inner of entries) if (inner.path.startsWith(`${target.path}/`)) add(inner);
    }
    return ids;
  }

  function askDelete(targets: AssetEntry[]) {
    if (!targets.length || !rules) return;
    const ids = idsOf(targets);
    const lists = {
      materials: rules.list('materials'),
      terrains: rules.list('terrains'),
      prefabs: rules.list('prefabs'),
      vfx: rules.list('vfx'),
          profiles: rules.list('profiles'),
    };
    const open = mapValue?.();
    const maps = Object.values(MAPS)
      .filter((map) => map.id !== open?.id)
      .map((map) => ({ id: map.id, value: map }));
    if (open) maps.push(open as { id: string; value: (typeof maps)[number]['value'] });
    const found = new Map<string, User>();
    for (const id of ids) {
      for (const user of usedBy(id, lists, maps)) {
        // Something inside what is being deleted does not count.
        if (user.type !== 'map' && ids.has(user.id)) continue;
        found.set(`${user.type}:${user.id}`, user);
      }
    }
    setDeleting({ targets, users: [...found.values()] });
  }

  async function confirmDelete() {
    const asked = deleting;
    setDeleting(null);
    if (!asked || !ops) return;
    try {
      await ops.remove(asked.targets);
      clear();
      say(`Deleted ${asked.targets.length} item${asked.targets.length > 1 ? 's' : ''}`, 'good');
    } catch (error) {
      fail(error);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (renaming || (event.target as HTMLElement).tagName === 'INPUT') return;
    if (event.key === 'F2' && chosen.length === 1) {
      event.preventDefault();
      event.stopPropagation();
      setRenaming(chosen[0]!.path);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && chosen.length) {
      event.preventDefault();
      event.stopPropagation();
      askDelete(chosen);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && chosen.length === 1) {
      event.preventDefault();
      event.stopPropagation();
      void duplicate(chosen[0]!);
    }
  }

  function onDragStart(event: DragEvent, entry: AssetEntry) {
    const paths = selected.includes(entry.path) ? selected : [entry.path];
    if (!selected.includes(entry.path)) select([entry.path]);
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
    event.dataTransfer.effectAllowed = 'move';
    if (paths.length === 1 && entry.type === 'prefab') {
      const found = ops?.recordAt(entry.path);
      if (found) {
        event.dataTransfer.setData(PREFAB_DRAG_TYPE, String(found.record.id));
        dragging.prefabId = String(found.record.id);
      }
      event.dataTransfer.effectAllowed = 'copyMove';
    }
  }

  const dropProps = (target: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setOver(target);
    },
    onDragLeave: () => setOver((was) => (was === target ? null : was)),
    onDrop: (event: DragEvent) => {
      setOver(null);
      const raw = event.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      event.preventDefault();
      event.stopPropagation();
      void moveInto(JSON.parse(raw) as string[], target);
    },
  });

  const single = chosen.length === 1 ? chosen[0]! : null;

  return (
    <div className={styles.panel} onKeyDown={onKeyDown}>
      <ConflictDialog />
      <DeleteDialog
        targets={deleting?.targets ?? null}
        users={deleting?.users ?? []}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
      <MoveDialog
        open={Boolean(moving)}
        entries={entries}
        moving={moving ?? []}
        onCancel={() => setMoving(null)}
        onMove={(target) => {
          const paths = moving ?? [];
          setMoving(null);
          void moveInto(paths, target);
        }}
      />
      <div className={styles.body}>
        <div className={styles.header}>
          <nav className={styles.crumbs} aria-label="Folder">
            {crumbs(folder).map((crumb, index, all) => (
              <span key={crumb.path} className={styles.crumbWrap}>
                {index > 0 && <span className={styles.slash}>/</span>}
                <button
                  type="button"
                  className={`${styles.crumb} ${over === crumb.path ? styles.over : ''}`}
                  disabled={index === all.length - 1}
                  onClick={() => {
                    onFolder(crumb.path);
                    clear();
                  }}
                  {...dropProps(crumb.path)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
          <DropdownMenu
            align="end"
            trigger={
              <Button variant="primary" className={styles.newButton} disabled={!ops}>
                <IconPlus size={14} />
                New
              </Button>
            }
          >
            <MenuItem onClick={() => void newFolder()}>
              <IconFolderPlus size={14} /> Folder
            </MenuItem>
            <MenuSeparator />
            {(['material', 'prefab', 'block', 'effect', 'profile'] as JsonType[]).map((type) => {
              const Glyph = GLYPH[type];
              return (
                <MenuItem key={type} onClick={() => void newAsset(type)}>
                  <Glyph size={14} /> {TYPE_LABEL[type]}
                </MenuItem>
              );
            })}
            <MenuSeparator />
            <MenuItem onClick={() => fileInput.current?.click()}>
              <IconUpload size={14} /> Add files…
            </MenuItem>
          </DropdownMenu>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        <div
          ref={grid}
          className={styles.grid}
          tabIndex={0}
          role="listbox"
          aria-multiselectable="true"
          aria-label={`Contents of ${folder || 'Assets'}`}
          onClick={(event) => {
            if (event.target === grid.current) clear();
          }}
          onContextMenu={(event) => {
            // Nothing on empty space.
            if (event.target === grid.current) event.preventDefault();
          }}
        >
          {!loaded && <p className={styles.empty}>Reading the assets…</p>}
          {loaded && !here.length && <p className={styles.empty}>This folder is empty. Use New to add something.</p>}
          {here.map((entry) => (
            <AssetCard
              key={entry.path}
              entry={entry}
              record={ops?.recordAt(entry.path)?.record ?? null}
              context={context}
              selected={selected.includes(entry.path)}
              over={over === entry.path}
              broken={errors.some((error) => error.path === entry.path)}
              renaming={renaming === entry.path}
              onClick={(event) => onCardClick(event, entry)}
              onDoubleClick={() => {
                if (entry.dir) {
                  onFolder(entry.path);
                  clear();
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!selected.includes(entry.path)) select([entry.path]);
                setMenu({ x: event.clientX, y: event.clientY });
              }}
              onDragStart={(event) => onDragStart(event, entry)}
              drop={entry.dir ? dropProps(entry.path) : null}
              onRenamed={(value) => void commitRename(entry, value)}
              onCancelRename={() => setRenaming(null)}
            />
          ))}
        </div>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuButton disabled={!single} onClick={() => single && setRenaming(single.path)} hint="F2">
            Rename
          </MenuButton>
          <MenuButton onClick={() => setMoving(chosen.map((entry) => entry.path))}>Move to…</MenuButton>
          <MenuButton disabled={!single} onClick={() => single && void duplicate(single)} hint="Ctrl+D">
            Duplicate
          </MenuButton>
          <MenuButton danger onClick={() => askDelete(chosen)} hint="Del">
            Delete
          </MenuButton>
        </ContextMenu>
      )}
    </div>
  );
}

function AssetCard({
  entry,
  record,
  context,
  selected,
  over,
  broken,
  renaming,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  drop,
  onRenamed,
  onCancelRename,
}: {
  entry: AssetEntry;
  record: LibraryRecord | null;
  context: ThumbContext;
  selected: boolean;
  over: boolean;
  broken: boolean;
  renaming: boolean;
  onClick: (event: MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onDragStart: (event: DragEvent) => void;
  drop: Record<string, (event: DragEvent) => void> | null;
  onRenamed: (value: string) => void;
  onCancelRename: () => void;
}) {
  const name = displayName(entry);
  const Glyph = GLYPH[entry.type];
  const thumbRecord =
    entry.type === 'model' && entry.id
      ? { id: entry.id, mesh: entry.id, path: folderOf(entry.path), label: name }
      : (JSON_TYPES as string[]).includes(entry.type)
        ? record
        : null;
  const kind = entry.type === 'model' || (JSON_TYPES as string[]).includes(entry.type) ? (entry.type as 'model' | JsonType) : null;
  const thumb = useThumb(thumbRecord ? kind : null, thumbRecord, context);
  const src = entry.type === 'texture' ? fileUrl(entry.path, context.game) : thumb;

  return (
    <Tooltip label={`${name} — ${TYPE_LABEL[entry.type]}`}>
      <div
        role="option"
        aria-selected={selected}
        className={`${styles.card} ${selected ? styles.on : ''} ${over ? styles.over : ''}`}
        draggable={!renaming}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onDragEnd={() => {
          dragging.prefabId = '';
        }}
        {...(drop ?? {})}
      >
        <span className={`${styles.face} ${entry.dir ? styles.faceFolder : ''}`}>
          {src ? <img className={styles.thumb} src={src} alt="" draggable={false} loading="lazy" /> : <Glyph size={entry.dir ? 40 : 26} stroke={1.4} />}
          {src && (
            <span className={styles.corner}>
              <Glyph size={12} />
            </span>
          )}
          {entry.draft && <span className={styles.draftDot} aria-label="Unpublished change" />}
        </span>
        {renaming ? (
          <input
            className={styles.rename}
            defaultValue={name}
            autoFocus
            onFocus={(event) => event.target.select()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') onRenamed(event.currentTarget.value);
              if (event.key === 'Escape') onCancelRename();
            }}
            onBlur={(event) => onRenamed(event.currentTarget.value)}
          />
        ) : (
          <span className={styles.name}>{name}</span>
        )}
        {broken && <span className={`${styles.badge} ${styles.bad}`}>unreadable</span>}
      </div>
    </Tooltip>
  );
}

function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      className={styles.menu}
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 180) }}
      onClick={onClose}
    >
      {children}
    </div>
  );
}

function MenuButton({
  children,
  onClick,
  disabled,
  danger,
  hint,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.menuItem} ${danger ? styles.menuDanger : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span>{children}</span>
      {hint && <span className={styles.menuHint}>{hint}</span>}
    </button>
  );
}

