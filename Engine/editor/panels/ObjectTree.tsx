import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  IconBox,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconDoor,
  IconFlame,
  IconGhost,
  IconHammer,
  IconSparkles,
  IconStack2,
  IconSun,
  IconTargetArrow,
} from '@tabler/icons-react';
import { objectRows } from '../schema.js';
import { DropdownMenu, MenuItem, MenuSeparator } from '../ui/Menu';
import { say } from '../state/status';
import { rowId, useSelection, type Selection } from '../state/selection';
import { useVisibility } from '../state/visibility';
import styles from './ObjectTree.module.css';

/**
 * What is on the map, in the groups you put it in.
 *
 * A group is a name written on each object, not a container holding them, which
 * is why an object can be dragged out of one by having the name rubbed off. One
 * level deep: folders inside folders would need recursive drop targets and a
 * guard against dropping a folder into its own descendant, for a map's worth of
 * objects that has never needed more than one.
 *
 * Reordering is within a list only. An object's place in the map *is* its index
 * in `map.lights` or `map.props`, and there is no ordering between those lists
 * for a drag to change — so dragging a light above a prop is a grouping, and
 * dragging a light above another light is a reorder.
 */

const GLYPHS: Record<string, typeof IconBox> = {
  lights: IconSun,
  torches: IconFlame,
  vfx: IconSparkles,
  props: IconBox,
  portals: IconDoor,
  doors: IconDoor,
  monsters: IconGhost,
  stations: IconHammer,
  walls: IconStack2,
  spawns: IconTargetArrow,
  chunks: IconStack2,
};

type Row = {
  list: string;
  index?: number;
  key?: string;
  entry: Record<string, unknown>;
  label: string;
};

type MapDoc = {
  map: Record<string, unknown>;
  /**
   * Changes whenever anything about the document does.
   *
   * The document is edited in place, so its identity says nothing about its
   * contents — memoising the rows on the document alone would draw the list as
   * it was when the map was opened. See history.ts.
   */
  revision: number;
  updateObject: (
    list: string,
    index: number,
    patch: Record<string, unknown>,
    checkpointed?: boolean,
  ) => void;
  removeObject: (list: string, index: number, checkpointed?: boolean) => void;
  reorderObject: (list: string, from: number, to: number) => boolean;
  checkpoint: (checkpointed?: boolean) => void;
};

/**
 * The lists whose objects can be switched off.
 *
 * Everything with a node of its own. A wall is not one of them: every wall on
 * the map is an instance of a single mesh, so there is nothing to switch off
 * that would not take all of them with it. Better to offer no eye than one that
 * hides more than it says.
 */
const HIDEABLE = new Set(['lights', 'torches', 'portals', 'stations', 'props', 'chunks', 'doors', 'vfx', 'monsters', 'spawns']);

/** Ungrouped objects live at the root, under no heading. */
const ROOT = '';

const filtered = (rows: Row[], filter: string) => {
  const needle = filter.trim().toLowerCase();
  return needle ? rows.filter((row) => row.label.toLowerCase().includes(needle)) : rows;
};

export function ObjectTree({
  doc,
  onChanged,
}: {
  doc: MapDoc | null;
  onChanged: () => void;
}) {
  const selection = useSelection((state) => state.selection);
  const picked = useSelection((state) => state.picked);
  const anchor = useSelection((state) => state.anchor);
  const select = useSelection((state) => state.select);
  const setPicked = useSelection((state) => state.setPicked);

  const hidden = useVisibility((state) => state.hidden);
  const toggleHidden = useVisibility((state) => state.toggle);

  const [filter, setFilter] = useState('');
  const [shut, setShut] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    // A few pixels of travel before a press becomes a drag, so clicking a row
    // to select it does not nudge it into another group.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  // Read on every render rather than memoised. The document is edited in place,
  // so its identity says nothing about its contents — a memo keyed on it would
  // draw the list as it was when the map was opened, and one keyed on a
  // revision is a cache for ten short arrays that are walked in microseconds.
  const rows: Row[] = doc ? filtered(objectRows(doc.map) as Row[], filter) : [];

  // Grouped in the order the groups turn up, with the ungrouped at the root so
  // a newly placed object is never filed somewhere you have to go and find.
  const byName = new Map<string, Row[]>([[ROOT, []]]);
  for (const row of rows) {
    const name = (row.entry.group as string) ?? ROOT;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(row);
  }
  const groups = [...byName.entries()].filter(([name, list]) => name === ROOT || list.length);

  /** Every visible row, in the order they are drawn — what a range spans. */
  const ordered = groups.flatMap(([, list]) => list);

  if (!doc) return <div className={styles.empty}>No map open.</div>;

  function onPick(row: Row, event: React.MouseEvent) {
    const id = rowId(row as NonNullable<Selection>);

    if (event.shiftKey && anchor) {
      // A range runs along the list as it is drawn — through the groups, in the
      // order you can see — not along the map's own arrays.
      const from = ordered.findIndex((other) => rowId(other as NonNullable<Selection>) === anchor);
      const to = ordered.findIndex((other) => rowId(other as NonNullable<Selection>) === id);
      if (from >= 0 && to >= 0) {
        const span = ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
        setPicked(new Set(span.map((other) => rowId(other as NonNullable<Selection>))));
        return;
      }
    }

    if (event.ctrlKey || event.metaKey) {
      const next = new Set(picked);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPicked(next, id);
      return;
    }

    select({ list: row.list, index: row.index, key: row.key });
  }

  function onDragEnd(event: DragEndEvent) {
    const from = rows.find((row) => rowId(row as NonNullable<Selection>) === event.active.id);
    if (!from || !event.over) return;

    const overId = String(event.over.id);

    // Dropped on a group heading: the name is written on, or rubbed off.
    if (overId.startsWith('group:')) {
      return regroup(from, overId.slice('group:'.length) || undefined);
    }

    const onto = rows.find((row) => rowId(row as NonNullable<Selection>) === overId);
    if (!onto || onto === from) return;

    const target = (onto.entry.group as string) ?? undefined;
    if (((from.entry.group as string) ?? undefined) !== target) return regroup(from, target);

    // Same group and same list: a real reorder.
    if (from.list === onto.list && from.index !== undefined && onto.index !== undefined) {
      if (doc!.reorderObject(from.list, from.index, onto.index)) onChanged();
    }
  }

  function regroup(row: Row, group: string | undefined) {
    if (row.index === undefined) {
      // A spawn is addressed by name rather than by index, so it is written
      // through the map directly — there is no list position to patch.
      doc!.checkpoint();
      (doc!.map.spawns as Record<string, Record<string, unknown>>)[row.key!].group = group;
    } else {
      doc!.updateObject(row.list, row.index, { group });
    }
    onChanged();
  }

  return (
    <div className={styles.tree}>
      <input
        className={styles.filter}
        placeholder="Filter"
        value={filter}
        aria-label="Filter objects"
        onChange={(event) => setFilter(event.target.value)}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <div className={styles.rows}>
          {ordered.length === 0 && (
            <p className={styles.empty}>
              {filter ? 'Nothing matches.' : 'Nothing on this map yet.'}
            </p>
          )}

          {groups.map(([name, list]) => (
            <Group
              key={name || 'root'}
              name={name}
              count={list.length}
              open={!shut.has(name)}
              onToggle={() =>
                setShut((was) => {
                  const next = new Set(was);
                  if (next.has(name)) next.delete(name);
                  else next.add(name);
                  return next;
                })
              }
            >
              <SortableContext
                items={list.map((row) => rowId(row as NonNullable<Selection>))}
                strategy={verticalListSortingStrategy}
              >
                {list.map((row) => {
                  const id = rowId(row as NonNullable<Selection>);
                  return (
                    <ObjectRow
                      key={id}
                      id={id}
                      row={row}
                      current={selection ? rowId(selection) === id : false}
                      picked={picked.has(id)}
                      hidden={hidden.has(id)}
                      onToggleHidden={
                        HIDEABLE.has(row.list) ? () => toggleHidden(id) : undefined
                      }
                      onPick={onPick}
                      onGroup={() => {
                        const name = window.prompt('Group as (blank to ungroup):', '')?.trim();
                        if (name === undefined) return;
                        regroup(row, name || undefined);
                        say(name ? `Grouped as "${name}"` : 'Ungrouped', 'good');
                      }}
                      onDelete={() => {
                        if (row.index === undefined) return;
                        doc.removeObject(row.list, row.index);
                        select(null);
                        onChanged();
                      }}
                    />
                  );
                })}
              </SortableContext>
            </Group>
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Group({
  name,
  count,
  open,
  onToggle,
  children,
}: {
  name: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  // The heading is a drop target as well as a switch: dragging onto it is how
  // an object is filed, and dragging onto the root heading is how it comes out.
  const { setNodeRef, isOver } = useDroppable({ id: `group:${name}` });

  return (
    <div>
      <div
        ref={setNodeRef}
        className={`${styles.groupHead} ${open ? styles.openGroup : ''} ${
          isOver ? styles.over : ''
        }`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => event.key === 'Enter' && onToggle()}
      >
        <IconChevronRight size={13} className={styles.chevron} />
        <span className={styles.groupName}>{name || 'Ungrouped'}</span>
        <span className={styles.count}>{count}</span>
      </div>
      {open && children}
    </div>
  );
}

function ObjectRow({
  id,
  row,
  current,
  picked,
  hidden,
  onToggleHidden,
  onPick,
  onGroup,
  onDelete,
}: {
  id: string;
  row: Row;
  current: boolean;
  picked: boolean;
  hidden: boolean;
  /** Absent for the lists that cannot be hidden — see HIDEABLE. */
  onToggleHidden?: () => void;
  onPick: (row: Row, event: React.MouseEvent) => void;
  onGroup: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const Glyph = GLYPHS[row.list] ?? IconBox;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${styles.row} ${current ? styles.current : picked ? styles.selected : ''} ${
        isDragging ? styles.dragging : ''
      } ${hidden ? styles.hidden : ''}`}
      onClick={(event) => onPick(row, event)}
      {...attributes}
      {...listeners}
    >
      <Glyph size={15} className={styles.glyph} />
      <span className={styles.name}>{row.label}</span>
      {/*
        Shown on hover like the rest — except when the object is hidden, when it
        stays. "Why can't I see that light" is otherwise a bug you go hunting
        for, and the answer is a control you have to hover to find.
      */}
      {onToggleHidden && (
        <span className={`${styles.actions} ${hidden ? styles.actionsPinned : ''}`}>
          <button
            type="button"
            className={styles.more}
            aria-label={hidden ? `Show ${row.label}` : `Hide ${row.label}`}
            aria-pressed={hidden}
            title={hidden ? 'Show this' : 'Hide this while you work'}
            onClick={(event) => {
              event.stopPropagation();
              onToggleHidden();
            }}
          >
            {hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
          </button>
        </span>
      )}
      <span className={styles.actions}>
        <DropdownMenu
          align="end"
          trigger={
            <button
              type="button"
              className={styles.more}
              aria-label={`Actions for ${row.label}`}
              onClick={(event) => event.stopPropagation()}
            >
              ⋯
            </button>
          }
        >
          <MenuItem onClick={onGroup}>Group…</MenuItem>
          <MenuSeparator />
          {/* The only place a destructive action appears: never as a visible
              button in a panel, where a mis-click can reach it. */}
          <MenuItem danger onClick={onDelete} disabled={row.index === undefined}>
            Delete
          </MenuItem>
        </DropdownMenu>
      </span>
    </div>
  );
}
