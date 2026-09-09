import { useNavigate } from 'react-router';
import { IconArrowUpRight } from '@tabler/icons-react';
import { Field, FieldRow } from '../fields/Field';
import type { FieldSpec, FieldValue } from '../fields/types';
import {
  REFERENCE_LISTS,
  SINGULAR,
  fieldsForRecord,
  isReferenceKind,
  optionsForField,
  type ListId,
  type OptionSource,
} from '../rules/schema';
import { Nested, type NestedDoc } from './subeditors/Nested';
import { useEdit } from '../state/useEdit';
import styles from './RecordDetail.module.css';

type RulesDoc = OptionSource & NestedDoc & {
  list: (kind: string) => { id: string; label?: string }[];
  update: (list: string, index: number, patch: Record<string, unknown>, checkpointed?: boolean) => void;
  rename: (list: string, index: number, nextId: string) => unknown;
  checkpoint: (checkpointed?: boolean) => void;
};

/**
 * One record, edited.
 *
 * The fields come from the same tables the simulation reads, so a property
 * added to `data/items.js` is editable here without this file changing.
 *
 * A field that names another record is drawn as a link beside its picker.
 * Following it moves the navigator and selects that record, and because it is a
 * real route the back button brings you home — which is what turns nine
 * separate tables into a graph you can walk.
 */
export function RecordDetail({
  game,
  list,
  index,
  record,
  doc,
}: {
  game: string;
  list: ListId;
  index: number;
  record: Record<string, unknown>;
  doc: RulesDoc;
}) {
  const navigate = useNavigate();
  const edit = useEdit(doc, null);

  const fields = fieldsForRecord(list, record);

  /**
   * The pickers whose choices are the document's own lists.
   *
   * Which categories or abilities exist is data, not something a data file can
   * enumerate about itself — so the panel answers, and the field components
   * stay ignorant of what a category is.
   */
  const resolveOptions = (field: FieldSpec): readonly (readonly [string, string])[] =>
    optionsForField(field as { kind: string; assetKind?: string }, doc) ?? field.options ?? [];

  return (
    <div className={styles.detail}>
      <header className={styles.head}>
        <span className={styles.kind}>{SINGULAR[list]}</span>
        <input
          className={styles.id}
          value={String(record.id ?? '')}
          aria-label="Identifier"
          spellCheck={false}
          onChange={(event) => doc.rename(list, index, event.target.value)}
        />
      </header>

      {fields.map((field) => {
        const kind = field.kind as string;
        const target = REFERENCE_LISTS[kind];
        const value = record[field.key] as FieldValue;

        const control = (
          <Field
            key={field.key}
            field={
              // A reference is a picker over the list it points into. The kind
              // says which list; the control is an ordinary select, and the
              // choices are resolved onto it here rather than left for the
              // field renderer to ask for — it only knows how to ask about the
              // two kinds the map inspector uses.
              isReferenceKind(kind)
                ? ({ ...field, kind: 'select', options: resolveOptions(field) } as FieldSpec)
                : field
            }
            value={value}
            onInput={(next) =>
              edit.preview(() => doc.update(list, index, { [field.key]: next }, false))
            }
            onChange={(next) =>
              edit.commit(() => doc.update(list, index, { [field.key]: next }, false))
            }
          />
        );

        if (!target || !value) return control;

        return (
          <div key={field.key} className={styles.reference}>
            {control}
            <FieldRow label="">
              <button
                type="button"
                className={styles.link}
                onClick={() => void navigate(`/${game}/rules/${target}/${String(value)}`)}
              >
                Open {String(value)}
                <IconArrowUpRight size={12} />
              </button>
            </FieldRow>
          </div>
        );
      })}

      {/*
        The repeating structures the flat tables cannot describe: an effect's
        modifiers, an ability's effect slots, a loot table's rolls. They come
        after the settings because they are what the record *does*, and the
        settings above are what it is.
      */}
      <Nested list={list} index={index} record={record} doc={doc} />
    </div>
  );
}
