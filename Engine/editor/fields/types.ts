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

/**
 * Every kind of control there is.
 *
 * A list rather than a bare union, because something has to be able to *check*
 * a kind at runtime: an action declares the variables it reads (see
 * `Engine/src/game/actions/`), and one test walks every registered action
 * asserting each names a control that exists. A union alone cannot be asked.
 * The type is derived from it, so the two can never disagree.
 */
export const FIELD_KINDS = [
  'text',
  'number',
  'range',
  'color',
  'bool',
  'select',
  /** The map registry, filled in from `destinationIds()`. */
  'maps',
  /**
   * A file in this record's own folder, by name.
   *
   * Not a picker yet: it draws as the plain text of the filename, which is
   * what it is. `accept` says which sort of file belongs, for the browser to
   * narrow by once it can offer them.
   */
  'file',
  /** A picture, by filename or still inline as a data URL. A sprite sheet. */
  'image',
  /** A material of the library's, by id. */
  'material',
  /** Filled in by the panel from the rules document being edited. */
  'vfx',
  'prop',
  'prefab',
  'archetype',
  /** A glyph an item or a category wears. See ui/IconPicker.tsx. */
  'icon',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

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
  /**
   * The same pairs, under headings, for a list too long to read flat.
   *
   * There is one of these: the action a wiring runs, whose list is meant to
   * grow into the hundreds (see `Engine/src/game/actions/`). A field that sets
   * `groups` needs no `options` — the headings hold them.
   */
  groups?: readonly { label: string; options: readonly (readonly [string, string])[] }[];
  maxLength?: number;
  default?: unknown;
};

/** What a field can hold once read back off its control. */
export type FieldValue = string | number | boolean | undefined;
