import { useRef } from 'react';
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  IconAlertTriangle,
  IconBox,
  IconFile,
  IconFolder,
  IconChevronDown,
  IconFolderPlus,
  IconMountain,
  IconPlus,
  IconRefresh,
  IconPackage,
  IconPaint,
  IconPhoto,
  IconSparkles,
} from '@tabler/icons-react';
import { Button } from '../ui/Button';
import { DropdownMenu, MenuItem } from '../ui/Menu';
import { LIBRARY_KINDS, type LibraryKind } from '../rules/library';
import {
  crumbs,
  libraryRows,
  rowsIn,
  thumbFor,
  TOP,
  type LibraryRow,
  type LibraryScan,
} from '../rules/libraryTree.ts';
import { useLayout } from '../state/layout';
import { urlOfGame, useMaterialThumb } from '../preview/thumbnails.ts';
import { fileUrl } from '../../src/data/assets.ts';
import styles from './LibraryTree.module.css';

/**
 * The assets folder, as the thing you browse.
 *
 * One folder at a time, the way a file manager is: crumbs across the top, what
 * is in this folder below them as a grid of cards, and clicking a folder goes
 * into it. Which kind a card is, is a colour and a filter rather than a level
 * of the hierarchy — the folders are yours to arrange, which is the whole point
 * of them being real.
 *
 * Cards rather than rows because the useful thing about most of these is what
 * they look like. A name tells you `Grass-Sand_normal.png` from
 * `Grass-Sand_base_color.png`; a picture tells you at a glance. Mostly that
 * picture is the file itself; a material is drawn on a sphere, because what a
 * material looks like is what light does to it.
 *
 * The folder you are in is kept with the panel sizes, so it is per game and it
 * survives leaving for the map and coming back — which is most of the reason
 * anybody arranges folders in the first place.
 */

const GLYPHS: Record<string, typeof IconBox> = {
  materials: IconPaint,
  props: IconBox,
  terrains: IconMountain,
  vfx: IconSparkles,
  prefabs: IconPackage,
};

export function LibraryTree({
  game,
  scan,
  records,
  selected,
  onOpen,
  onImport,
  onMove,
  onNewFolder,
  onNew,
  onRefresh,
  onDelete,
  onRename,
  renaming,
  onRenamed,
}: {
  game: string;
  scan: LibraryScan | null;
  records: Partial<Record<LibraryKind, Record<string, unknown>[]>>;
  selected: string;
  onOpen: (row: LibraryRow) => void;
  onImport: (path: string) => void;
  onMove: (from: string, toFolder: string) => void;
  onNewFolder: (into: string) => void;
  onNew: (kind: LibraryKind) => void;
  onRefresh: () => void;
  onDelete: (row: LibraryRow) => void;
  /** Name this one in place. */
  onRename: (row: LibraryRow) => void;
  /** The row being named in place, by path. See `RenameInput`. */
  renaming?: string | undefined;
  /** The name typed, or null if it was called off. */
  onRenamed: (row: LibraryRow, name: string | null) => void;
}) {
  const { folder: kept, setFolder } = useLayout(game);

  // The five top folders are tabs down the side rather than cards at the
  // root: there is nothing else at the root, and a kind is a place you go to
  // rather than a folder you open. Anywhere outside one of them lands on the
  // first tab.
  const within = (id: LibraryKind) => kept === TOP[id] || kept.startsWith(`${TOP[id]}/`);
  const tab = LIBRARY_KINDS.find(({ id }) => within(id)) ?? LIBRARY_KINDS[0];
  const folder = within(tab.id) ? kept : TOP[tab.id];

  // Not memoized: the records arrive from a document edited in place, so their
  // identity is stable while their contents are not -- a memo over them would
  // never recompute and a rename would never reach this list.
  const rows = rowsIn(libraryRows(scan, records), folder);

  // A pointer has to travel before a click becomes a drag, or selecting a card
  // by clicking it would start one every time.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragEnd(event: DragEndEvent) {
    const from = String(event.active.id);
    const to = event.over ? String(event.over.id) : '';
    // Onto itself, or onto the folder it is already in, is not a move.
    if (!to || to === from || from.slice(0, from.lastIndexOf('/')) === to) return;
    // A folder cannot go inside itself; the server refuses it too, but saying
    // so here saves the round trip and the error toast.
    if (to.startsWith(`${from}/`)) return;
    onMove(from, to);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist" aria-label="Kind">
        {LIBRARY_KINDS.map((kind) => {
          const Glyph = GLYPHS[kind.id] ?? IconBox;
          return (
            <button
              key={kind.id}
              type="button"
              role="tab"
              className={styles.tab}
              aria-selected={kind.id === tab.id}
              title={kind.label}
              onClick={() => setFolder(TOP[kind.id])}
            >
              <Glyph size={16} />
            </button>
          );
        })}
      </div>
      <div className={styles.body}>
        <nav className={styles.crumbs} aria-label="Folder">
          {/* The tab is the root, so the crumbs start at its folder. */}
          {crumbs(folder)
            .slice(1)
            .map((crumb, at) => (
              <span key={crumb.path}>
                {at > 0 && <span className={styles.slash}>/</span>}
                <button
                  type="button"
                  className={styles.crumb}
                  disabled={crumb.path === folder}
                  onClick={() => setFolder(crumb.path)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
        </nav>

        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
          <div className={styles.grid}>
            {rows.map((row) => (
              <Card
                key={row.path}
                row={row}
                thumb={thumbFor(row, records)}
                game={game}
                on={row.path === selected}
                onOpen={() => (row.row === 'folder' ? setFolder(row.path) : onOpen(row))}
                onImport={() => onImport(row.path)}
                onDelete={() => onDelete(row)}
                onRename={() => onRename(row)}
                renaming={row.path === renaming}
                onRenamed={(name) => onRenamed(row, name)}
              />
            ))}
            {!rows.length && (
              <p className={styles.empty}>
                {scan ? 'Nothing in this folder.' : 'Reading the library…'}
              </p>
            )}
          </div>
        </DndContext>

        <div className={styles.tools}>
          {/* Which kind is a question here rather than a mode, because the folder
              holds all of them at once -- there is no open shelf to infer it
              from any more. */}
          <DropdownMenu
            trigger={
              <Button variant="quiet">
                <IconPlus size={14} />
                New
                <IconChevronDown size={14} />
              </Button>
            }
          >
            {LIBRARY_KINDS.map((kind) => (
              <MenuItem key={kind.id} onClick={() => onNew(kind.id)}>
                {kind.singular}
              </MenuItem>
            ))}
          </DropdownMenu>
          <Button variant="quiet" onClick={() => onNewFolder(folder)}>
            <IconFolderPlus size={14} />
            Folder
          </Button>
          {/* The folder is the truth and the editor is not the only thing that
              writes to it: a migration, a branch change, or somebody dropping a
              file in with the mouse all happen without asking. Read it again. */}
          <Button variant="quiet" onClick={onRefresh} title="Read the folder again">
            <IconRefresh size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One card: draggable always, and a drop target when it is a folder.
 *
 * Both hooks on one element rather than a wrapper each, so the card that lights
 * up under the pointer is the card you are pointing at.
 */
function Card({
  row,
  thumb,
  game,
  on,
  onOpen,
  onImport,
  onDelete,
  onRename,
  renaming,
  onRenamed,
}: {
  row: LibraryRow;
  thumb: ReturnType<typeof thumbFor>;
  game: string;
  on: boolean;
  onOpen: () => void;
  onImport: () => void;
  onDelete: () => void;
  onRename: () => void;
  renaming: boolean;
  onRenamed: (name: string | null) => void;
}) {
  const folder = row.row === 'folder';
  const drag = useDraggable({ id: row.path });
  const drop = useDroppable({ id: row.path, disabled: !folder });

  const Glyph =
    row.row === 'record'
      ? (GLYPHS[row.list] ?? IconBox)
      : row.row === 'folder'
        ? IconFolder
        : row.row === 'broken'
          ? IconAlertTriangle
          : /\.(png|jpg|jpeg|webp)$/i.test(row.name)
            ? IconPhoto
            : IconFile;

  const unimported = row.row === 'file' && !row.used;

  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        if (folder) drop.setNodeRef(node);
      }}
      className={`${styles.card} ${on ? styles.on : ''} ${drop.isOver ? styles.over : ''}`}
      style={{ opacity: drag.isDragging ? 0.4 : 1 }}
      title={row.row === 'record' ? `${row.label} — ${row.name}` : row.name}
      // dnd-kit's attributes already say this is a button and make it
      // focusable, so the spread goes first and what is ours goes after it --
      // the other way round it was quietly overwriting both.
      {...drag.attributes}
      {...drag.listeners}
      onClick={onOpen}
      onKeyDown={(event) => event.key === 'Enter' && onOpen()}
    >
      {/* The picture the card already has, rather than one rendered for it.
          See `thumbFor`. Lazily, by the browser's own rule: a folder of forty
          textures should not be forty fetches before you have scrolled. */}
      <div className={`${styles.face} ${folder ? styles.faceFolder : ''}`}>
        {thumb && 'material' in thumb ? (
          <MaterialFace record={thumb.material} game={game} fallback={<Glyph size={28} />} />
        ) : thumb && 'src' in thumb ? (
          <img
            className={styles.thumb}
            src={thumb.src.startsWith('data:') ? thumb.src : fileUrl(thumb.src, game)}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : thumb ? (
          <span
            className={styles.thumb}
            style={{ background: `#${thumb.color.toString(16).padStart(6, '0')}` }}
          />
        ) : (
          <Glyph size={28} />
        )}

        {/* A folder wearing its record's picture would otherwise be
            indistinguishable from the record. The corner says which it is. */}
        {folder && thumb && <IconFolder size={12} className={styles.corner} />}

        {/* Behind a menu, never as a button on the card: this is the one action
            here that destroys something, and a card you click to select it is
            not a card to put it on. */}
        <span className={styles.more} onClick={(event) => event.stopPropagation()}>
          <DropdownMenu
            align="end"
            trigger={
              <button
                type="button"
                className={styles.moreButton}
                aria-label={`Actions for ${row.name}`}
              >
                ⋯
              </button>
            }
          >
            {/* A record's name is its filename, and there is nowhere else to
                type it: the detail panel has no name box. */}
            {(row.row === 'record' || (row.row === 'folder' && row.holds)) && (
              <MenuItem onClick={onRename}>Rename</MenuItem>
            )}
            <MenuItem danger onClick={onDelete}>
              Delete
            </MenuItem>
          </DropdownMenu>
        </span>
      </div>

      {renaming ? (
        <RenameInput value={named(row)} onDone={onRenamed} />
      ) : (
        <span className={`${styles.name} ${unimported ? styles.quiet : ''}`}>{named(row)}</span>
      )}

      {/* A file no record names. Not a mistake in itself -- it is how a file
          arrives -- but it is invisible to the game until something claims it,
          and that used to be the drift nobody could see. */}
      {unimported && (
        <button
          type="button"
          className={styles.import}
          onClick={(event) => {
            event.stopPropagation();
            onImport();
          }}
        >
          Import
        </button>
      )}

      {row.row === 'record' && row.missing.length > 0 && (
        <span
          className={`${styles.badge} ${styles.warn}`}
          title={`Not in this folder: ${row.missing.join(', ')}`}
        >
          {row.missing.length} missing
        </span>
      )}

      {row.row === 'broken' && (
        <span className={`${styles.badge} ${styles.bad}`} title={row.message}>
          will not parse
        </span>
      )}
    </div>
  );
}

/**
 * A material, drawn on a sphere.
 *
 * Its own component so the hook has somewhere to live: only some cards are
 * materials, and a hook cannot be called only some of the time. The glyph
 * stands in until the picture arrives, which is one frame for a material
 * already drawn and a texture load for one that is not.
 */
function MaterialFace({
  record,
  game,
  fallback,
}: {
  record: Record<string, unknown>;
  game: string;
  fallback: React.ReactNode;
}) {
  const made = useMaterialThumb(record, urlOfGame(game));
  return made ? <img className={styles.thumb} src={made} alt="" /> : <>{fallback}</>;
}

/** What a card calls itself: a record's name, or a folder's own. */
function named(row: LibraryRow): string {
  if (row.row === 'record') return row.label;
  return row.row === 'folder' ? (row.label ?? row.name) : row.name;
}

/**
 * Naming a card in place, the way a file manager names a new folder: the box
 * is already open with the name selected, so the first thing you type replaces
 * it and Enter is the only key you need.
 *
 * Every pointer event is stopped here rather than let through. The card around
 * it is a drag handle and a click target, so without this, clicking into the
 * box to fix a typo starts dragging the record into a folder.
 */
function RenameInput({
  value,
  onDone,
}: {
  value: string;
  onDone: (name: string | null) => void;
}) {
  // Escape has to be remembered rather than acted on: it moves focus out, and
  // the blur that follows would otherwise commit what Escape just refused.
  const called = useRef(false);
  // Blurred through a ref rather than `event.currentTarget`, which React has
  // already let go of by the time the key handler runs.
  const box = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={box}
      className={styles.rename}
      defaultValue={value}
      autoFocus
      aria-label="Name"
      onFocus={(event) => event.target.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        // Either key ends it; only one of them keeps what was typed. The blur
        // that follows is what commits, so there is one path out.
        called.current = event.key === 'Escape';
        box.current?.blur();
      }}
      onBlur={(event) => onDone(called.current ? null : event.target.value)}
    />
  );
}
