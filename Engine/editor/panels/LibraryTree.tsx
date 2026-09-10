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
  IconChevronRight,
  IconFile,
  IconFolder,
  IconChevronDown,
  IconFolderPlus,
  IconPlus,
  IconRefresh,
  IconPaint,
  IconPhoto,
  IconSparkles,
  IconStack2,
} from '@tabler/icons-react';
import { Button } from '../ui/Button';
import { DropdownMenu, MenuItem } from '../ui/Menu';
import { LIBRARY_KINDS, type LibraryKind } from '../rules/library';
import {
  filterRows,
  hasChildren,
  libraryRows,
  visibleRows,
  type LibraryRow,
  type LibraryScan,
} from '../rules/libraryTree.ts';
import styles from './LibraryTree.module.css';

/**
 * The assets folder, as the thing you browse.
 *
 * One tree with every kind in it rather than a shelf per kind, because what
 * belongs together is a *thing* and its parts: the mesh, the picture, the
 * material and the object are one campfire filed in one folder. Which kind a
 * row is, is a colour and a filter rather than a level of the hierarchy — the
 * folders are yours to arrange, which is the whole point of them being real.
 *
 * Rows rather than nested lists: the drop targets are the rows, and a nested
 * list would put a folder's own box behind its children's.
 */

const GLYPHS: Record<string, typeof IconBox> = {
  materials: IconPaint,
  props: IconBox,
  terrains: IconStack2,
  vfx: IconSparkles,
};

/** The chips, in the order they are offered. Files last: it is the leftovers. */
const CHIPS: readonly { id: string; label: string }[] = [
  ...LIBRARY_KINDS.map((kind) => ({ id: kind.id as string, label: kind.label })),
  { id: 'files', label: 'Files' },
];

export function LibraryTree({
  scan,
  records,
  selected,
  onOpen,
  onImport,
  onMove,
  onNewFolder,
  onNew,
  onRefresh,
}: {
  scan: LibraryScan | null;
  records: Partial<Record<LibraryKind, Record<string, unknown>[]>>;
  selected: string;
  onOpen: (row: LibraryRow) => void;
  onImport: (path: string) => void;
  onMove: (from: string, toFolder: string) => void;
  onNewFolder: () => void;
  onNew: (kind: LibraryKind) => void;
  onRefresh: () => void;
}) {
  const [wanted, setWanted] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // Not memoized: the records arrive from a document edited in place, so their
  // identity is stable while their contents are not -- a memo over them would
  // never recompute and a rename would never reach this list.
  const all = libraryRows(scan, records);
  const rows = visibleRows(filterRows(all, wanted), collapsed);

  // A pointer has to travel before a click becomes a drag, or selecting a row
  // by clicking it would start one every time.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const toggle = (set: ReadonlySet<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

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
      <div className={styles.chips} role="toolbar" aria-label="Filter by type">
        {CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`${styles.chip} ${wanted.has(chip.id) ? styles.chipOn : ''}`}
            aria-pressed={wanted.has(chip.id)}
            onClick={() => setWanted((set) => toggle(set, chip.id))}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
        <div className={styles.tree}>
          {rows.map((row) => (
            <Row
              key={row.path}
              row={row}
              open={!collapsed.has(row.path)}
              folder={row.row === 'folder' || row.row === 'record'}
              twisty={hasChildren(all, row.path)}
              on={row.path === selected}
              onToggle={() => setCollapsed((set) => toggle(set, row.path))}
              onOpen={() => onOpen(row)}
              onImport={() => onImport(row.path)}
            />
          ))}
          {!rows.length && (
            <p className={styles.empty}>
              {scan ? 'Nothing here yet.' : 'Reading the library…'}
            </p>
          )}
        </div>
      </DndContext>

      <div className={styles.tools}>
        {/* Which kind is a question here rather than a mode, because the tree
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
        <Button variant="quiet" onClick={onNewFolder}>
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
 * One row: draggable always, and a drop target when it is a folder.
 *
 * Both hooks on one element rather than a wrapper each, so the row that lights
 * up under the pointer is the row you are pointing at.
 */
function Row({
  row,
  open,
  folder,
  twisty,
  on,
  onToggle,
  onOpen,
  onImport,
}: {
  row: LibraryRow;
  open: boolean;
  folder: boolean;
  twisty: boolean;
  on: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onImport: () => void;
}) {
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
      className={`${styles.row} ${on ? styles.on : ''} ${drop.isOver ? styles.over : ''}`}
      style={{ paddingLeft: 4 + row.depth * 12, opacity: drag.isDragging ? 0.4 : 1 }}
      // dnd-kit's attributes already say this is a button and make it
      // focusable, so the spread goes first and what is ours goes after it --
      // the other way round it was quietly overwriting both.
      {...drag.attributes}
      {...drag.listeners}
      onClick={onOpen}
      onKeyDown={(event) => event.key === 'Enter' && onOpen()}
    >
      <span
        className={`${styles.twisty} ${open ? styles.open : ''}`}
        onClick={(event) => {
          if (!twisty) return;
          event.stopPropagation();
          onToggle();
        }}
      >
        {twisty && <IconChevronRight size={12} />}
      </span>

      <span className={styles.glyph}>
        <Glyph size={14} />
      </span>

      <span className={`${styles.name} ${unimported ? styles.quiet : ''}`}>
        {row.row === 'record' ? row.label : row.name}
      </span>

      {/* A file no record names. Not a mistake in itself -- it is how a file
          arrives -- but it is invisible to the game until something claims it,
          and that used to be the drift nobody could see. */}
      {unimported && (
        <>
          <span className={styles.badge}>unimported</span>
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
        </>
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
