import { IconPlus, IconTrash } from '@tabler/icons-react';
import { Field } from '../../fields/Field';
import { Button } from '../../ui/Button';
import { DropdownMenu, MenuItem } from '../../ui/Menu';
import { RowList, Row } from './RowList';
import { ACTIONS, actionGroups } from '../../../src/game/actions/index.ts';
import { EVENTS, eventApplies, eventBlockedBy } from '../../../src/game/events/index.ts';
import type { FieldSpec, FieldValue } from '../../fields/types';
import styles from './Wirings.module.css';

/**
 * What a thing does, and when.
 *
 * Triggers are *added*, not laid out ready to fill in. A thing that does
 * nothing shows an empty Events list rather than one blank section per event
 * there has ever been — which is the difference between a panel that says "this
 * does nothing" and one that says "there are three things you have not filled
 * in". Only the triggers actually on the record are drawn, and Add event offers
 * the ones that are not.
 *
 * Under each trigger, a list of actions. One trigger can do several things: a
 * lever that opens the gate *and* says so is two actions under one trigger, not
 * two levers. They run in the order shown.
 *
 * The rows come from the same table the runtime dispatches from — see
 * `Engine/src/game/actions/` — so the picker cannot offer something nothing
 * will run, and an action added there appears here, with its own settings,
 * without this file changing.
 *
 * Whole arrays are written back rather than one field at a time. It keeps the
 * dotted-key path in `updateObject` at one level — there is no `interact.0.to`
 * to parse — and it makes removing a row the same kind of edit as changing one,
 * which is one undo step either way.
 */
export function Wirings({
  list,
  entry,
  onInput,
  onChange,
  resolveOptions,
}: {
  /** Which list the thing is on. Decides which triggers it can carry. */
  list: string;
  entry: Record<string, unknown>;
  /** Previews, for a drag. */
  onInput: (patch: Record<string, unknown>) => void;
  /** Commits, which is what makes an undo step. */
  onChange: (patch: Record<string, unknown>) => void;
  resolveOptions?: (field: FieldSpec) => readonly (readonly [string, string])[];
}) {
  /**
   * A trigger counts as on the record once it has been added, empty or not.
   *
   * `undefined` rather than `in`, because taking one off writes undefined into
   * the key rather than deleting it — both documents merge patches onto the
   * record they already hold.
   *
   * Not filtered by what the thing may *carry*. A trigger already written on a
   * record is shown whatever kind the record is now, or changing a prefab's
   * kind would hide a trigger that is still firing — invisible and impossible
   * to take off. What the kind decides is what may be added, below.
   */
  const added = Object.keys(EVENTS).filter((event) => entry[event] !== undefined);

  /**
   * The triggers not yet on it.
   *
   * Every one of them for a prefab, including any the engine could not fire —
   * those are shown greyed with the reason rather than left out, because a
   * trigger that is simply absent from the menu reads as a bug in the menu. A
   * map object is filtered as before: a light is not a thing you walk into, and
   * there is no wording that would make offering it sensible.
   */
  const available = Object.keys(EVENTS).filter(
    (event) =>
      entry[event] === undefined && (list === 'prefabs' || eventApplies(event, list, entry)),
  );

  if (!added.length && !available.length) return null;

  /** The actions written under a trigger. One on its own reads as a list of one. */
  const actionsOf = (event: string): Record<string, unknown>[] => {
    const held = entry[event];
    if (Array.isArray(held)) {
      return held.filter((one) => one && typeof one === 'object') as Record<string, unknown>[];
    }
    return held && typeof held === 'object' ? [held as Record<string, unknown>] : [];
  };

  return (
    <RowList
      title="Events"
      count={added.length}
      empty="Nothing happens here yet."
      action={
        available.length > 0 && (
          <DropdownMenu
            align="end"
            trigger={
              <Button variant="quiet">
                <IconPlus size={12} />
                Add event
              </Button>
            }
          >
            {available.map((event) => {
              // Why it cannot be added, if it cannot. Only a prefab is ever
              // offered one it could not fire.
              const blocked = list === 'prefabs' ? eventBlockedBy(event, entry) : null;
              return (
                <MenuItem
                  key={event}
                  disabled={Boolean(blocked)}
                  hint={blocked ?? undefined}
                  onClick={blocked ? undefined : () => onChange({ [event]: [] })}
                >
                  {EVENTS[event].label}
                </MenuItem>
              );
            })}
          </DropdownMenu>
        )
      }
    >
      {added.map((event) => {
        const actions = actionsOf(event);

        /** The trigger as it would be after changing one of its actions. */
        const withAction = (at: number, next: Record<string, unknown> | null) => ({
          [event]: actions.map((one, i) => (i === at ? next : one)).filter(Boolean),
        });

        return (
          <div key={event} className={styles.event}>
            <RowList
              title={EVENTS[event].label}
              count={actions.length}
              empty="No actions yet."
              addLabel="Add action"
              onAdd={() => onChange({ [event]: [...actions, { do: '' }] })}
              action={
                <button
                  type="button"
                  className={styles.drop}
                  aria-label={`Remove ${EVENTS[event].label}`}
                  title={`Remove ${EVENTS[event].label}`}
                  onClick={() => onChange({ [event]: undefined })}
                >
                  <IconTrash size={12} />
                </button>
              }
            >
              {actions.map((wiring, at) => {
                const chosen = typeof wiring.do === 'string' ? ACTIONS[wiring.do] : null;
                return (
                  <Row
                    key={at}
                    label={chosen?.label ?? 'action'}
                    onRemove={() => onChange(withAction(at, null))}
                  >
                    <Field
                      field={{
                        key: `${event}-${at}-do`,
                        kind: 'select',
                        label: 'Does',
                        // Grouped by the category each action names: this list is
                        // meant to grow into the hundreds.
                        groups: actionGroups(),
                      }}
                      value={String(wiring.do ?? '')}
                      onInput={() => {}}
                      // Choosing a different action starts from nothing: the
                      // settings the old one read mean nothing to the new one,
                      // and carrying them across would write them to the file
                      // forever.
                      onChange={(next) => onChange(withAction(at, { do: String(next ?? '') }))}
                    />
                    {chosen?.hint && <p className={styles.hint}>{chosen.hint}</p>}
                    {(chosen?.vars ?? []).map((one) => (
                      <Field
                        key={one.key}
                        field={{ ...one, key: `${event}-${at}-${one.key}` } as FieldSpec}
                        value={wiring[one.key] as FieldValue}
                        onInput={(next) => onInput(withAction(at, { ...wiring, [one.key]: next }))}
                        onChange={(next) => onChange(withAction(at, { ...wiring, [one.key]: next }))}
                        resolveOptions={resolveOptions}
                      />
                    ))}
                  </Row>
                );
              })}
            </RowList>
          </div>
        );
      })}
    </RowList>
  );
}
