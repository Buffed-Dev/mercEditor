import { useRef } from 'react';
import { destinationIds } from '../../src/data/maps/index.ts';
import { ColorField } from './ColorField';
import { IconPicker } from '../ui/IconPicker';
import { FilePicker, RecordPicker, type Files } from '../ui/FilePicker';
import { NumberField } from './NumberField';
import { splitUnit } from './ranges';
import { Tooltip } from '../ui/Tooltip';
import type { FieldSpec, FieldValue } from './types';
import styles from './Field.module.css';

/**
 * One labelled row, wrapping whatever control the field's kind calls for.
 *
 * Nothing in here knows what a light, a portal or an ability is. A panel hands
 * over a descriptor and gets back a control, which is what keeps a new editable
 * property to one line in a data file rather than a new branch of interface
 * code.
 */
export function FieldRow({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className={styles.row}>
      {/* The gutter is a fixed width, so a long name ellipsises, and that is
          all it does — nothing pops up over the panel to tell you the rest. */}
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

export type FieldProps = {
  field: FieldSpec;
  value: FieldValue;
  /** Live, while a value is still moving. Not an undo step. */
  onInput: (value: FieldValue) => void;
  /** Settled. This is the one that commits. */
  onChange: (value: FieldValue) => void;
  /**
   * Options for the kinds whose choices come from the rules being edited —
   * `vfx` and `prop`. The panel knows the document; this does not.
   */
  resolveOptions?: ((field: FieldSpec) => readonly (readonly [string, string])[]) | undefined;
  /** Colours already used on this map, offered by the colour picker. */
  used?: readonly number[] | undefined;
  /** The project's files, for a `file` field to choose from. See ui/FilePicker.tsx. */
  files?: Files | undefined;
};

export function Field({
  field,
  value,
  onInput,
  onChange,
  resolveOptions,
  used,
  files,
}: FieldProps) {
  // The name only; the unit is drawn inside the number itself, beside the
  // figure it belongs to rather than at the end of a label you read once.
  const { name } = splitUnit(field.label);

  switch (field.kind) {
    case 'number':
    case 'range':
      return (
        <FieldRow label={name}>
          <NumberField
            field={field}
            value={Number(value ?? field.default ?? 0)}
            onInput={onInput}
            onChange={onChange}
          />
        </FieldRow>
      );

    case 'color':
      return (
        <FieldRow label={name}>
          <ColorField
            label={name}
            value={Number(value ?? 0)}
            used={used}
            onInput={onInput}
            onChange={onChange}
          />
        </FieldRow>
      );

    case 'bool':
      return (
        <FieldRow label={name}>
          <Toggle label={name} value={Boolean(value)} onChange={onChange} />
        </FieldRow>
      );

    case 'icon':
      return (
        <FieldRow label={name}>
          <IconPicker label={name} value={String(value ?? '')} onChange={onChange} />
        </FieldRow>
      );

    case 'file':
    case 'image':
      // Without the project's files to offer, the name is typed as it always was.
      if (!files) return null;
      return (
        <FieldRow label={name}>
          <FilePicker
            label={name}
            value={String(value ?? '')}
            accept={field.kind === 'image' ? 'texture' : field.accept}
            files={files}
            onChange={onChange}
          />
        </FieldRow>
      );

    case 'material':
    case 'prop': {
      const list = field.kind === 'prop' ? 'props' : 'materials';
      if (!files?.[list]) return null;
      return (
        <FieldRow label={name}>
          <RecordPicker
            label={name}
            value={String(value ?? '')}
            list={list}
            files={files}
            onChange={onChange}
          />
        </FieldRow>
      );
    }

    case 'select':
    case 'maps':
    case 'vfx':
    case 'prop':
    case 'prefab': {
      // Headings hold the options when there are any, so a long list is read
      // in sections rather than as one wall of names.
      const options = field.groups
        ? field.groups.flatMap((group) => group.options)
        : optionsFor(field, resolveOptions);
      return (
        <FieldRow label={name}>
          <Choice
            label={name}
            options={options}
            groups={field.groups}
            value={String(value ?? '')}
            onChange={onChange}
          />
        </FieldRow>
      );
    }

    default:
      return (
        <FieldRow label={name}>
          <TextInput
            label={name}
            value={String(value ?? '')}
            maxLength={field.maxLength}
            onChange={onChange}
          />
        </FieldRow>
      );
  }
}

function optionsFor(
  field: FieldSpec,
  resolve?: ((field: FieldSpec) => readonly (readonly [string, string])[]) | undefined,
): readonly (readonly [string, string])[] {
  // The map registry is something this file can answer for itself; the rules
  // lists are not, because they are the document the panel is editing.
  if (field.kind === 'maps') return destinationIds().map((id: string) => [id, id] as const);
  if (field.kind === 'vfx' || field.kind === 'prop' || field.kind === 'prefab') {
    return resolve?.(field) ?? [];
  }
  return field.options ?? [];
}

/** How many options still fit as a switcher rather than hiding in a menu. */
const SEGMENTED_MAX = 3;

/**
 * A choice, shown whole where it fits.
 *
 * A few options draw as a switcher: every choice visible and one click away,
 * rather than hidden behind a menu you have to open to find out what it holds.
 *
 * Three, not four. Four fitted while the type was 11px and stopped fitting when
 * it was not — "Weapon / Armour / Material / Currency" across an inspector
 * column is four labels of five characters each, and a switcher you cannot read
 * has lost the only argument for being one.
 */
function Choice({
  label,
  options,
  groups,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [string, string])[];
  groups?: readonly { label: string; options: readonly (readonly [string, string])[] }[] | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  if (options.length > 0 && options.length <= SEGMENTED_MAX) {
    return (
      <div className={styles.segmented} role="group" aria-label={label}>
        {options.map(([id, text]) => (
          <Tooltip key={id} label={text}>
            <button
              type="button"
              className={styles.segment}
              aria-pressed={id === value}
              onClick={() => onChange(id)}
            >
              {text}
            </button>
          </Tooltip>
        ))}
      </div>
    );
  }

  return (
    <select
      className={styles.select}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {/*
        An empty value needs an option of its own. A <select> with no matching
        option shows its first one instead, so a record that names nothing would
        read as naming whatever happens to be at the top of the list — and one
        touch of the control would make that true.
      */}
      {/* A grouped picker always offers it, not only while nothing is set:
          those are the long lists, and a wiring you cannot take off again is
          worse than one you have to scroll to find. */}
      {(!value || groups) && <option value="">— none —</option>}
      {/* A value the list no longer offers still has to be shown, or the
          control would silently claim the record says something else. */}
      {value && !options.some(([id]) => id === value) && <option value={value}>{value}</option>}
      {groups
        ? groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(([id, text]) => (
                <option key={id} value={id}>
                  {text}
                </option>
              ))}
            </optgroup>
          ))
        : options.map(([id, text]) => (
            <option key={id} value={id}>
              {text}
            </option>
          ))}
    </select>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      role="switch"
      aria-checked={value}
      aria-pressed={value}
      aria-label={label}
      onClick={() => onChange(!value)}
    >
      <span className={styles.knob} />
    </button>
  );
}

function TextInput({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength?: number | undefined;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <input
      ref={input}
      type="text"
      className={styles.text}
      aria-label={label}
      value={value}
      maxLength={maxLength}
      // A one-character field is a field you replace, not one you add to:
      // clicking in and typing would otherwise put the caret after the letter
      // already there, and maxlength would swallow the keystroke silently.
      onFocus={maxLength === 1 ? () => input.current?.select() : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
