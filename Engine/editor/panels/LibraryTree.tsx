import { useState } from 'react';
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
  IconPlus,
  IconRefresh,
  IconPackage,
  IconPaint,
  IconPhoto,
  IconSparkles,
  IconStack2,
} from '@tabler/icons-react';
import { Button } from '../ui/Button';
import { DropdownMenu, MenuItem } from '../ui/Menu';
import { LIBRARY_KINDS, type LibraryKind } from '../rules/library';
import {
  crumbs,
  filterRows,
  libraryRows,
  rowsIn,
  thumbFor,
  type LibraryRow,
  type LibraryScan,
} from '../rules/libraryTree.ts';
import { useLayout } from '../state/layout';
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
 * `Grass-Sand_base_color.png`; a picture tells you at a glance, and at this
 * size it is the picture the file already is rather than anything rendered.
 *
 * The folder you are in is kept with the panel sizes, so it is per game and it
 * survives leaving for the map and coming back — which is most of the reason
 * anybody arranges folders in the first place.
 */

const GLYPHS: Record<string, typeof IconBox> = {
  materials: IconPaint,
  props: IconBox,
  terrains: IconStack2,
  vfx: IconSparkles,
  prefabs: IconPackage,
};

/** The chips, in the order they are offered. Files last: it is the leftovers. */
const CHIPS: readonly { id: string; label: string }[] = [
  ...LIBRARY_KINDS.map((kind) => ({ id: kind.id as string, label: kind.label })),
  { id: 'files', label: 'Files' },
];

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
}) {
  const [wanted, setWanted] = useState<ReadonlySet<string>>(new Set());
  const { folder, setFolder } = useLayout(game);

  // Not memoized: the records arrive from a document edited in place, so their
  // identity is stable while their contents are not -- a memo over them would
  // never recompute and a rename would never reach this list.
  const rows = rowsIn(filterRows(libraryRows(scan, records), wanted), folder);

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
      <nav className={styles.crumbs} aria-label="Folder">
        {crumbs(folder).map((crumb, at) => (
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

      <div className={styles.chips} role="toolbar" aria-label="Filter by type">
        {CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`${styles.chip} ${wanted.has(chip.id) ? styles.chipOn : ''}`}
            aria-pressed={wanted.has(chip.id)}
            onClick={() =>
              setWanted((set) => {
                const next = new Set(set);
                if (!next.delete(chip.id)) next.add(chip.id);
                return next;
              })
            }
          >
            {chip.label}
          </button>
        ))}
      </div>

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
}: {
  row: LibraryRow;
  thumb: { src: string } | { color: number } | null;
  game: string;
  on: boolean;
  onOpen: () => void;
  onImport: () => void;
  onDelete: () => void;
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
        {thumb && 'src' in thumb ? (
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
          <Glyph size={28} className={styles.glyph} />
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
            <MenuItem danger onClick={onDelete}>
              Delete
            </MenuItem>
          </DropdownMenu>
        </span>
      </div>

      <span className={`${styles.name} ${unimported ? styles.quiet : ''}`}>
        {row.row === 'record' ? row.label : row.name}
      </span>

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
