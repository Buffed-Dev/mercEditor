/**
 * A field descriptor, as the data files already write them.
 *
 * This is the contract that makes a new editor panel cheap: nothing in the
 * field components knows what a light, a portal or an ability is. A panel hands
 * over one of these and gets back a control. Adding an editable property stays
 * one line in a data file.
 *
 * The shapes here are read from `Engine/editor/schema.js` and the `*_FIELDS`
 * tables in `Engine/src/data/*`, so this type describes what those already
 * contain rather than proposing anything new.
 */

export type FieldKind =
  | 'text'
  | 'number'
  | 'range'
  | 'color'
  | 'bool'
  | 'select'
  /** The map registry, filled in from `destinationIds()`. */
  | 'maps'
  /**
   * A file in this record's own folder, by name.
   *
   * Not a picker yet: it draws as the plain text of the filename, which is
   * what it is. `accept` says which sort of file belongs, for the browser to
   * narrow by once it can offer them.
   */
  | 'file'
  /** Filled in by the panel from the rules document being edited. */
  | 'vfx'
  | 'prop'
  /** A glyph an item or a category wears. See ui/IconPicker.tsx. */
  | 'icon';

/** How the travel of a drag maps onto the value. See `ranges.ts`. */
export type Curve = 'linear' | 'exp';

export type FieldSpec = {
  key: string;
  kind: FieldKind;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  curve?: Curve;
  /** Which sort of file a `file` field takes. See `ASSET_KINDS`. */
  accept?: string;
  /** `[id, label]` pairs, as every picker in the data files writes them. */
  options?: readonly (readonly [string, string])[];
  maxLength?: number;
  default?: unknown;
};

/** What a field can hold once read back off its control. */
export type FieldValue = string | number | boolean | undefined;
