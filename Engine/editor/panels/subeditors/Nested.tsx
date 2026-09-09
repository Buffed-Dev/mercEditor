import { MODIFIER_OPS, MAGNITUDE_TYPES, MAGNITUDE_SOURCES, EXECUTIONS } from '../../../src/data/effects.ts';
import { EFFECT_TARGETS } from '../../../src/data/abilities.js';
import { COST_KINDS } from '../../../src/data/costs.ts';
import { LOOT_ROLL_FIELDS } from '../../../src/data/lootTables.ts';
import { ITEM_STAT_FIELDS } from '../../../src/data/items.ts';
import { Field } from '../../fields/Field';
import type { FieldSpec, FieldValue } from '../../fields/types';
import { optionsForField, type ListId, type OptionSource } from '../../rules/schema';
import { useEdit } from '../../state/useEdit';
import { Row, RowList } from './RowList';
import styles from './Nested.module.css';

/**
 * The repeating structures inside a record.
 *
 * These are what the flat field tables cannot describe: an effect is not five
 * settings, it is five settings *and a list of modifiers*, each of which has a
 * magnitude that is itself one of two shapes. The document already knows how to
 * change every one of them — `addModifier`, `updateMagnitude`, `addLootRoll` —
 * so all of this is the interface for methods that were already there.
 *
 * Each is a row of controls rather than a nested form: a modifier list reads as
 * "+5 health, ×1.2 attack power", and a stack of labelled boxes per entry
 * buries that under its own chrome.
 */

export type NestedDoc = OptionSource & {
  list: (kind: string) => Record_[];
  checkpoint: (checkpointed?: boolean) => void;
  addModifier: (index: number) => void;
  removeModifier: (index: number, modIndex: number) => void;
  updateModifier: (index: number, modIndex: number, patch: Patch, checkpointed?: boolean) => void;
  updateMagnitude: (index: number, modIndex: number, patch: Patch, checkpointed?: boolean) => void;
  setExecution: (index: number, execution: unknown) => void;
  updateExecutionMagnitude: (index: number, patch: Patch, checkpointed?: boolean) => void;
  addAbilityEffect: (index: number, effectId?: string) => void;
  setAbilityEffect: (index: number, slot: number, effectId: string) => void;
  setAbilityEffectTarget: (index: number, slot: number, to: string) => void;
  removeAbilityEffect: (index: number, slot: number) => void;
  addItemStat: (index: number) => void;
  removeItemStat: (index: number, statIndex: number) => void;
  updateItemStat: (index: number, statIndex: number, patch: Patch, checkpointed?: boolean) => void;
  addLootRoll: (index: number) => void;
  removeLootRoll: (index: number, rollIndex: number) => void;
  updateLootRoll: (index: number, rollIndex: number, patch: Patch, checkpointed?: boolean) => void;
  addCost: (list: string, index: number) => void;
  removeCost: (list: string, index: number, costIndex: number) => void;
  updateCost: (
    list: string,
    index: number,
    costIndex: number,
    patch: Patch,
    checkpointed?: boolean,
  ) => void;
  setArchetypeValue: (
    index: number,
    attributeId: string,
    value: number,
    checkpointed?: boolean,
  ) => void;
  clearArchetypeValue: (index: number, attributeId: string) => void;
  toggleGrant: (index: number, effectId: string) => void;
};

type Patch = Record<string, unknown>;
type Record_ = Record<string, unknown>;

/**
 * A field descriptor written here, or lifted from a data file's table.
 *
 * Loosely typed for the same reason `rules/schema.ts` is: the tables live under
 * `Engine/src/data`, which is shared with the game and must not reach into the
 * editor for a type. The editor narrows once, where the two meet.
 */
const field = (spec: { key: string; kind: string; label: string } & Record<string, unknown>) =>
  spec as unknown as FieldSpec;

/**
 * An option list from a data file, as pairs.
 *
 * The tables are plain JS, so TypeScript reads `[['add', '+ add']]` as an array
 * of arrays rather than of pairs. Narrowed once, here, where the two meet.
 */
const opts = (pairs: unknown): readonly (readonly [string, string])[] =>
  (pairs as [string, string][]).map(([id, label]) => [id, label] as const);

/** A picker over one of the document's lists, as an ordinary select. */
const picker = (key: string, label: string, kind: string, doc: NestedDoc): FieldSpec =>
  field({ key, label, kind: 'select', options: optionsForField({ kind }, doc) ?? [] });

export function Nested({
  list,
  index,
  record,
  doc,
}: {
  list: ListId;
  index: number;
  record: Record_;
  doc: NestedDoc;
}) {
  const edit = useEdit(doc, null);
  const commit = (write: () => void) => edit.commit(write);
  const preview = (write: () => void) => edit.preview(write);

  if (list === 'effects') {
    return <Modifiers {...{ index, record, doc, commit, preview }} />;
  }
  if (list === 'abilities') {
    return <AbilityEffects {...{ index, record, doc, commit }} />;
  }
  if (list === 'items') {
    return (
      <>
        <ItemStats {...{ index, record, doc, commit, preview }} />
        <Costs {...{ list, index, record, doc, commit, preview }} />
      </>
    );
  }
  if (list === 'lootTables') {
    return <LootRolls {...{ index, record, doc, commit, preview }} />;
  }
  if (list === 'recipes' || list === 'baseLevels') {
    return <Costs {...{ list, index, record, doc, commit, preview }} />;
  }
  if (list === 'archetypes') {
    return <Archetype {...{ index, record, doc, commit, preview }} />;
  }
  return null;
}

type Common = {
  index: number;
  record: Record_;
  doc: NestedDoc;
  commit: (write: () => void) => void;
  preview: (write: () => void) => void;
};

// --- effects ---------------------------------------------------------------

/**
 * What an effect actually does.
 *
 * A modifier names an attribute, how it changes it, and by how much — and that
 * last part is either a fixed number or a reading of some other attribute,
 * which is what lets a heal scale with spell power without a line of code.
 */
function Modifiers({ index, record, doc, commit, preview }: Common) {
  const modifiers = (record.modifiers as Record_[]) ?? [];
  const execution = record.execution as Record_ | null;

  return (
    <>
      <RowList
        title="Modifiers"
        count={modifiers.length}
        empty="This effect changes nothing yet."
        addLabel="Add"
        onAdd={() => doc.addModifier(index)}
      >
        {modifiers.map((modifier, at) => {
          const magnitude = (modifier.magnitude as Record_) ?? {};
          const reads = magnitude.type === 'attribute';
          return (
            <Row key={at} label="modifier" onRemove={() => doc.removeModifier(index, at)}>
              <Field
                field={picker('attribute', 'Attribute', 'attribute', doc)}
                value={modifier.attribute as FieldValue}
                onInput={() => {}}
                onChange={(value) => commit(() => doc.updateModifier(index, at, { attribute: value }))}
              />
              <Field
                field={field({ key: 'op', kind: 'select', label: 'How', options: opts(MODIFIER_OPS) })}
                value={modifier.op as FieldValue}
                onInput={() => {}}
                onChange={(value) => commit(() => doc.updateModifier(index, at, { op: value }))}
              />
              <Field
                field={field({ key: 'type', kind: 'select', label: 'By', options: opts(MAGNITUDE_TYPES) })}
                value={magnitude.type as FieldValue}
                onInput={() => {}}
                onChange={(value) => commit(() => doc.updateMagnitude(index, at, { type: value }))}
              />
              {reads ? (
                <>
                  <Field
                    field={picker('attribute', 'Reads', 'attribute', doc)}
                    value={magnitude.attribute as FieldValue}
                    onInput={() => {}}
                    onChange={(value) =>
                      commit(() => doc.updateMagnitude(index, at, { attribute: value }))
                    }
                  />
                  <Field
                    field={field({
                      key: 'source',
                      kind: 'select',
                      label: 'Whose',
                      options: opts(MAGNITUDE_SOURCES),
                    })}
                    value={magnitude.source as FieldValue}
                    onInput={() => {}}
                    onChange={(value) =>
                      commit(() => doc.updateMagnitude(index, at, { source: value }))
                    }
                  />
                </>
              ) : (
                <Field
                  field={field({ key: 'value', kind: 'number', label: 'Amount', step: 0.1 })}
                  value={magnitude.value as FieldValue}
                  onInput={(value) =>
                    preview(() => doc.updateMagnitude(index, at, { value }, false))
                  }
                  onChange={(value) =>
                    commit(() => doc.updateMagnitude(index, at, { value }, false))
                  }
                />
              )}
            </Row>
          );
        })}
      </RowList>

      {/*
        A calculation the game does in code, for maths a modifier cannot state.
        It is off unless something turns it on, so the switch comes first.
      */}
      <RowList
        title="Execution"
        count={execution ? 1 : 0}
        empty="No coded calculation."
        addLabel={execution ? 'Remove' : 'Add'}
        onAdd={() =>
          commit(() =>
            doc.setExecution(index, execution ? null : { type: 'damage', magnitude: { type: 'constant', value: 1 } }),
          )
        }
      >
        {execution && (
          <Row label="execution" onRemove={() => commit(() => doc.setExecution(index, null))}>
            <Field
              field={field({ key: 'type', kind: 'select', label: 'Calculation', options: opts(EXECUTIONS) })}
              value={execution.type as FieldValue}
              onInput={() => {}}
              onChange={(value) => commit(() => doc.setExecution(index, { ...execution, type: value }))}
            />
            <Field
              field={field({ key: 'value', kind: 'number', label: 'Amount', step: 0.1 })}
              value={((execution.magnitude as Record_) ?? {}).value as FieldValue}
              onInput={(value) => preview(() => doc.updateExecutionMagnitude(index, { value }, false))}
              onChange={(value) => commit(() => doc.updateExecutionMagnitude(index, { value }, false))}
            />
          </Row>
        )}
      </RowList>
    </>
  );
}

// --- abilities -------------------------------------------------------------

/** The effects an ability hands to whatever it hits, and to whom. */
function AbilityEffects({ index, record, doc, commit }: Omit<Common, 'preview'>) {
  const slots = (record.effects as Record_[]) ?? [];

  return (
    <RowList
      title="Applies"
      count={slots.length}
      empty="This ability applies no effects."
      addLabel="Add"
      onAdd={() => doc.addAbilityEffect(index)}
    >
      {slots.map((slot, at) => (
        <Row key={at} label="effect" onRemove={() => doc.removeAbilityEffect(index, at)}>
          <Field
            field={picker('effect', 'Effect', 'effect', doc)}
            value={slot.effect as FieldValue}
            onInput={() => {}}
            onChange={(value) => commit(() => doc.setAbilityEffect(index, at, String(value)))}
          />
          <Field
            field={field({ key: 'to', kind: 'select', label: 'Applies to', options: opts(EFFECT_TARGETS) })}
            value={slot.to as FieldValue}
            onInput={() => {}}
            onChange={(value) => commit(() => doc.setAbilityEffectTarget(index, at, String(value)))}
          />
        </Row>
      ))}
    </RowList>
  );
}

// --- items -----------------------------------------------------------------

/** A rollable stat line: which attribute, and the range it rolls in. */
function ItemStats({ index, record, doc, commit, preview }: Common) {
  const stats = (record.stats as Record_[]) ?? [];

  return (
    <RowList
      title="Stat lines"
      count={stats.length}
      empty="This item changes no attributes."
      addLabel="Add"
      onAdd={() => doc.addItemStat(index)}
    >
      {stats.map((stat, at) => (
        <Row key={at} label="stat line" onRemove={() => doc.removeItemStat(index, at)}>
          <Field
            field={picker('attribute', 'Attribute', 'attribute', doc)}
            value={stat.attribute as FieldValue}
            onInput={() => {}}
            onChange={(value) => commit(() => doc.updateItemStat(index, at, { attribute: value }))}
          />
          <Field
            field={field({ key: 'op', kind: 'select', label: 'How', options: opts(MODIFIER_OPS) })}
            value={stat.op as FieldValue}
            onInput={() => {}}
            onChange={(value) => commit(() => doc.updateItemStat(index, at, { op: value }))}
          />
          {(['min', 'max', 'step'] as const).map((key) => (
            <Field
              key={key}
              field={field({ key, ...ITEM_STAT_FIELDS[key] })}
              value={stat[key] as FieldValue}
              onInput={(value) => preview(() => doc.updateItemStat(index, at, { [key]: value }, false))}
              onChange={(value) => commit(() => doc.updateItemStat(index, at, { [key]: value }, false))}
            />
          ))}
        </Row>
      ))}
    </RowList>
  );
}

// --- costs and loot --------------------------------------------------------

/**
 * A price: which thing, and how much of it.
 *
 * A cost and a loot roll are the same shape — `{kind, id}` plus an amount — so
 * the picker is written once. Which list `id` comes from depends on `kind`,
 * which is why the two controls sit next to each other.
 */
function RefPicker({
  kind,
  id,
  doc,
  onKind,
  onId,
}: {
  kind: string;
  id: string;
  doc: NestedDoc;
  onKind: (value: string) => void;
  onId: (value: string) => void;
}) {
  return (
    <>
      <Field
        field={field({ key: 'kind', kind: 'select', label: 'Kind', options: opts(COST_KINDS) })}
        value={kind}
        onInput={() => {}}
        onChange={(value) => onKind(String(value))}
      />
      <Field
        field={picker('id', kind === 'item' ? 'Item' : 'Currency', kind === 'item' ? 'item' : 'currency', doc)}
        value={id}
        onInput={() => {}}
        onChange={(value) => onId(String(value))}
      />
    </>
  );
}

function Costs({
  list,
  index,
  record,
  doc,
  commit,
  preview,
}: Common & { list: ListId }) {
  const costs = (record.costs as Record_[]) ?? [];

  return (
    <RowList
      title="Costs"
      count={costs.length}
      empty="Free."
      addLabel="Add"
      onAdd={() => doc.addCost(list, index)}
    >
      {costs.map((cost, at) => (
        <Row key={at} label="cost" onRemove={() => doc.removeCost(list, index, at)}>
          <RefPicker
            kind={String(cost.kind ?? 'currency')}
            id={String(cost.id ?? '')}
            doc={doc}
            onKind={(value) => commit(() => doc.updateCost(list, index, at, { kind: value, id: '' }))}
            onId={(value) => commit(() => doc.updateCost(list, index, at, { id: value }))}
          />
          <Field
            field={field({ key: 'amount', kind: 'number', label: 'Amount', min: 0, max: 999999, step: 1 })}
            value={cost.amount as FieldValue}
            onInput={(value) => preview(() => doc.updateCost(list, index, at, { amount: value }, false))}
            onChange={(value) => commit(() => doc.updateCost(list, index, at, { amount: value }, false))}
          />
        </Row>
      ))}
    </RowList>
  );
}

/** What a table hands over, how much of it, and how often. */
function LootRolls({ index, record, doc, commit, preview }: Common) {
  const rolls = (record.rolls as Record_[]) ?? [];

  return (
    <RowList
      title="Rolls"
      count={rolls.length}
      empty="This table drops nothing."
      addLabel="Add"
      onAdd={() => doc.addLootRoll(index)}
    >
      {rolls.map((roll, at) => (
        <Row key={at} label="roll" onRemove={() => doc.removeLootRoll(index, at)}>
          <RefPicker
            kind={String(roll.kind ?? 'currency')}
            id={String(roll.id ?? '')}
            doc={doc}
            onKind={(value) => commit(() => doc.updateLootRoll(index, at, { kind: value, id: '' }))}
            onId={(value) => commit(() => doc.updateLootRoll(index, at, { id: value }))}
          />
          {(['min', 'max', 'chance'] as const).map((key) => (
            <Field
              key={key}
              field={field({ key, ...LOOT_ROLL_FIELDS[key] })}
              value={roll[key] as FieldValue}
              onInput={(value) => preview(() => doc.updateLootRoll(index, at, { [key]: value }, false))}
              onChange={(value) => commit(() => doc.updateLootRoll(index, at, { [key]: value }, false))}
            />
          ))}
        </Row>
      ))}
    </RowList>
  );
}

// --- archetypes ------------------------------------------------------------

/**
 * An actor's starting numbers.
 *
 * Every attribute is listed, but only the ones this archetype names are set —
 * the rest fall back to the attribute's own base, and say so. Listing them all
 * is what makes "what is different about this actor" answerable at a glance,
 * where a list of only the overrides makes you hold the defaults in your head.
 */
function Archetype({ index, record, doc, commit, preview }: Common) {
  const attributes = (record.attributes as Record<string, number>) ?? {};
  const grants = new Set((record.grants as string[]) ?? []);
  // The records rather than the id/label pairs, because an attribute this
  // archetype does not override still has a number — its own base — and showing
  // 0 there would be a lie about what the actor starts with.
  const all = doc.list('attributes');
  const effects = doc.effectOptions();

  return (
    <>
      <RowList
        title={`Starting values · ${Object.keys(attributes).length} set`}
        count={all.length}
        empty="No attributes to set."
      >
        {all.map((attribute) => {
          const id = String(attribute.id);
          const label = String(attribute.label ?? id);
          const set = id in attributes;
          return (
            <div key={id}>
              <Field
                field={field({ key: id, kind: 'number', label, step: 0.1 })}
                value={(set ? attributes[id] : (attribute.base ?? 0)) as FieldValue}
                onInput={(value) =>
                  preview(() => doc.setArchetypeValue(index, id, Number(value), false))
                }
                onChange={(value) =>
                  commit(() => doc.setArchetypeValue(index, id, Number(value), false))
                }
              />
              {set && (
                <button
                  type="button"
                  className={styles.clear}
                  onClick={() => commit(() => doc.clearArchetypeValue(index, id))}
                >
                  use the attribute's base
                </button>
              )}
            </div>
          );
        })}
      </RowList>

      <RowList
        title={`Granted at spawn · ${grants.size}`}
        count={effects.length}
        empty="No effects to grant."
      >
        {effects.map(([id, label]) => (
          <Field
            key={id}
            field={field({ key: id, kind: 'bool', label })}
            value={grants.has(id)}
            onInput={() => {}}
            onChange={() => commit(() => doc.toggleGrant(index, id))}
          />
        ))}
      </RowList>
    </>
  );
}
