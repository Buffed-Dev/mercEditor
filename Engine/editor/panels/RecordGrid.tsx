import { useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { Button } from '../ui/Button';
import { DropdownMenu, MenuItem } from '../ui/Menu';
import { Glyph } from '../ui/IconPicker';
import { LIST_LABELS, SINGULAR, type ListId } from '../rules/schema';
import styles from './RecordGrid.module.css';

export type Record_ = { id: string; label?: string; [key: string]: unknown };

/**
 * The records in one list, as cards.
 *
 * A card carries enough to tell two of them apart without opening either: what
 * it is called, what kind it is, the tags that matter for it and a couple of
 * its numbers. That is the whole reason the middle is a grid rather than a
 * second list — you are comparing, not scrolling.
 */
export function RecordGrid({
  list,
  records,
  selected,
  onSelect,
  onAdd,
  onDelete,
  summarise,
}: {
  list: ListId;
  records: Record_[];
  selected?: string | undefined;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  /** Chips and stats for one record — what this list finds worth showing. */
  summarise: (record: Record_) => { kind?: string; chips: string[]; stats: [string, string][] };
}) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? records.filter(
        (record) =>
          record.id.toLowerCase().includes(needle) ||
          String(record.label ?? '').toLowerCase().includes(needle),
      )
    : records;

  return (
    <div className={styles.wrap}>
      <header className={styles.bar}>
        <input
          className={styles.filter}
          placeholder={`Filter ${LIST_LABELS[list].toLowerCase()}`}
          aria-label={`Filter ${LIST_LABELS[list].toLowerCase()}`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <Button variant="primary" onClick={onAdd}>
          <IconPlus size={13} />
          New {SINGULAR[list]}
        </Button>
      </header>

      {shown.length === 0 ? (
        <p className={styles.empty}>
          {needle ? 'Nothing matches.' : `No ${LIST_LABELS[list].toLowerCase()} yet.`}
        </p>
      ) : (
        <div className={styles.grid}>
          {shown.map((record) => {
            const { kind, chips, stats } = summarise(record);
            return (
              <div
                key={record.id}
                className={`${styles.card} ${record.id === selected ? styles.on : ''}`}
                onClick={() => onSelect(record.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => event.key === 'Enter' && onSelect(record.id)}
              >
                <div className={styles.top}>
                  <span className={styles.tile} aria-hidden="true">
                    {/* Its own picture where it has one; its initials where it
                        does not. An icon nobody can see is not worth setting. */}
                    {record.icon ? (
                      <Glyph value={String(record.icon)} size={17} />
                    ) : (
                      (record.label ?? record.id).slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className={styles.names}>
                    <span className={styles.name}>{record.label ?? record.id}</span>
                    <span className={styles.kind}>{kind ?? record.id}</span>
                  </span>
                  <DropdownMenu
                    align="end"
                    trigger={
                      <button
                        type="button"
                        className={styles.more}
                        aria-label={`Actions for ${record.label ?? record.id}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        ⋯
                      </button>
                    }
                  >
                    <MenuItem
                      danger
                      onClick={() => onDelete(records.indexOf(record))}
                    >
                      Delete
                    </MenuItem>
                  </DropdownMenu>
                </div>

                {chips.length > 0 && (
                  <div className={styles.chips}>
                    {chips.map((chip) => (
                      <span key={chip} className={styles.chip}>
                        {chip}
                      </span>
                    ))}
                  </div>
                )}

                {stats.length > 0 && (
                  <div className={styles.stats}>
                    {stats.map(([label, value]) => (
                      <span key={label}>
                        {label} <b className={styles.value}>{value}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
