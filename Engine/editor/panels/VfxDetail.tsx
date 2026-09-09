import {
  EMITTER_FIELDS,
  EMITTER_KEYS,
  EMITTER_SHAPES,
  MODIFIER_FIELDS,
  MODIFIER_TYPES,
  PARTICLE_FIELDS,
  SHEET_FIELDS,
  SHEET_SHAPES,
  VFX_KINDS,
  defaultModifier,
  modifierFields,
  modifiersFor,
  normalizeVfx,
  particleKeys,
  partsOf,
  sheetKeys,
} from '../../src/data/vfx.js';
import { Field } from '../fields/Field';
import type { FieldSpec, FieldValue } from '../fields/types';
import { Section } from '../ui/Section';
import { Row, RowList } from './subeditors/RowList';
import { DropdownMenu, MenuItem } from '../ui/Menu';
import { Button } from '../ui/Button';
import styles from './VfxDetail.module.css';

/**
 * An effect: what throws the particles, what a particle is, and what changes
 * over their lives.
 *
 * Forty settings describe an effect and none of them tell you what it looks
 * like, which is why the preview beside this is not a preview but the point.
 * The form's job is only to be quick to get back and forth across.
 *
 * Which rows show depends on the record: a sheet has no emitter, and an
 * emitter's shape decides which of its geometry rows are worth showing. All of
 * that is declared in `data/vfx.js` — `partsOf`, `particleKeys`, `sheetKeys`,
 * `modifiersFor` — so this file arranges rows and never decides which.
 */

type Record_ = Record<string, unknown>;

type VfxDoc = {
  update: (list: string, index: number, patch: Record_, checkpointed?: boolean) => void;
  checkpoint: (checkpointed?: boolean) => void;
};

/** The parts of an effect the panel lays out, and where each finds its rows. */
const SECTIONS: Record<
  string,
  {
    title: string;
    fields: Record<string, unknown>;
    keysFor: (part: Record_) => string[];
    hintFor: (part: Record_) => string;
  }
> = {
  emitter: {
    title: 'Emitter',
    fields: EMITTER_FIELDS,
    /** An emitter's shape decides which of its geometry rows are worth showing. */
    keysFor: (emitter) => {
      const shapes = EMITTER_SHAPES as Record<string, { fields: string[]; hint: string }>;
      const shape = shapes[String(emitter.shape)] ?? shapes.cone;
      const [first, ...rest] = EMITTER_KEYS as string[];
      return [first, ...shape.fields, ...rest];
    },
    hintFor: (emitter) => {
      const shapes = EMITTER_SHAPES as Record<string, { hint: string }>;
      return (shapes[String(emitter.shape)] ?? shapes.cone).hint;
    },
  },
  particle: {
    title: 'Particle',
    fields: PARTICLE_FIELDS,
    keysFor: (particle) => particleKeys(particle) as string[],
    hintFor: () => '',
  },
  sheet: {
    title: 'Sheet',
    fields: SHEET_FIELDS,
    keysFor: (sheet) => sheetKeys(sheet) as string[],
    hintFor: (sheet) => {
      const shapes = SHEET_SHAPES as Record<string, { hint: string }>;
      return (shapes[String(sheet.shape)] ?? shapes.plane).hint;
    },
  },
};

const field = (spec: { key: string; kind: string; label: string } & Record<string, unknown>) =>
  spec as unknown as FieldSpec;

const opts = (pairs: unknown): readonly (readonly [string, string])[] =>
  (pairs as [string, string][]).map(([id, label]) => [id, label] as const);

export function VfxDetail({
  index,
  record,
  doc,
  onReplay,
}: {
  index: number;
  record: Record_;
  doc: VfxDoc;
  /** Start the stage again, because a change you cannot see is not a change. */
  onReplay: () => void;
}) {
  const def = normalizeVfx(record) as Record_;

  /**
   * Write one part of the definition.
   *
   * The *whole* normalised record goes back with the part patched in, and the
   * legacy top-level keys are cleared on the way — so an effect still written
   * in the old flat shape is upgraded by being edited rather than left as half
   * of each.
   */
  function patch(part: string, values: Record_, checkpointed = true) {
    const cleared: Record_ = {};
    for (const key of Object.keys(record)) {
      if (!['id', 'label', 'emitter', 'particle', 'sheet', 'kind'].includes(key)) {
        cleared[key] = undefined;
      }
    }
    doc.update(
      'vfx',
      index,
      { ...cleared, ...def, [part]: { ...(def[part] as Record_), ...values } },
      checkpointed,
    );
    onReplay();
  }

  return (
    <div className={styles.detail}>
      <header className={styles.head}>
        <span className={styles.kind}>effect</span>
        <span className={styles.id}>{String(record.id)}</span>
        <Button variant="quiet" onClick={onReplay} title="Play it again">
          Replay
        </Button>
      </header>

      <Field
        field={field({ key: 'label', kind: 'text', label: 'Name' })}
        value={record.label as FieldValue}
        onInput={() => {}}
        onChange={(value) => {
          doc.update('vfx', index, { label: value });
        }}
      />
      <Field
        field={field({ key: 'kind', kind: 'select', label: 'Kind', options: opts(VFX_KINDS) })}
        value={def.kind as FieldValue}
        onInput={() => {}}
        onChange={(value) => {
          // The whole record goes back, so an effect still in the old flat
          // shape is upgraded rather than left half of each.
          doc.update('vfx', index, { ...def, kind: value });
          onReplay();
        }}
      />

      {(partsOf(def.kind) as string[]).map((part) => {
        const spec = SECTIONS[part];
        const values = (def[part] as Record_) ?? {};
        const table = spec.fields as Record<string, Record<string, unknown>>;
        const hint = spec.hintFor(values);

        return (
          <Section key={part} id={`vfx:${part}`} title={spec.title}>
            {hint && <p className={styles.hint}>{hint}</p>}
            {spec.keysFor(values).map((key) =>
              table[key] ? (
                <Field
                  key={key}
                  field={field({ key, ...(table[key] as { kind: string; label: string }) })}
                  value={values[key] as FieldValue}
                  onInput={(value) => patch(part, { [key]: value }, false)}
                  onChange={(value) => patch(part, { [key]: value })}
                />
              ) : null,
            )}
            <Modifiers part={part} values={values} onPatch={patch} />
          </Section>
        );
      })}
    </div>
  );
}

/**
 * What changes over the life of an emitter or a particle.
 *
 * Which kinds may be added depends on the section — a sheet cannot be given a
 * spin that only a particle has — and `modifiersFor` is what knows. A modifier's
 * own rows depend on its kind and sometimes its type, which `modifierFields`
 * knows. Neither is decided here.
 */
function Modifiers({
  part,
  values,
  onPatch,
}: {
  part: string;
  values: Record_;
  onPatch: (part: string, patch: Record_, checkpointed?: boolean) => void;
}) {
  const modifiers = (values.modifiers as Record_[]) ?? [];
  const table = MODIFIER_FIELDS as Record<string, Record<string, unknown>>;
  const kinds = modifiersFor(part) as [string, string][];

  const write = (next: Record_[], checkpointed = true) =>
    onPatch(part, { modifiers: next }, checkpointed);

  return (
    <RowList
      title="Over their lives"
      count={modifiers.length}
      empty="Nothing changes."
      // Which kinds are on offer is the section's business, so what you add is
      // a choice rather than a button that guesses — and it lives in the header
      // so it is reachable while the list is still empty.
      action={
        <DropdownMenu trigger={<Button variant="quiet">Add a change…</Button>} align="end">
          {kinds.map(([kind, label]) => (
            <MenuItem
              key={kind}
              onClick={() => {
                const made = defaultModifier(kind) as Record_ | null;
                if (made) write([...modifiers, made]);
              }}
            >
              {label}
            </MenuItem>
          ))}
        </DropdownMenu>
      }
    >
      {modifiers.map((modifier, at) => {
        const spec = (MODIFIER_TYPES as Record<string, { label: string }>)[String(modifier.kind)];
        return (
          <Row
            key={at}
            label={spec?.label ?? 'modifier'}
            onRemove={() => write(modifiers.filter((_, other) => other !== at))}
          >
            <p className={styles.modKind}>{spec?.label ?? String(modifier.kind)}</p>
            {(modifierFields(modifier) as string[]).map((key) =>
              table[key] ? (
                <Field
                  key={key}
                  field={field({ key, ...(table[key] as { kind: string; label: string }) })}
                  value={modifier[key] as FieldValue}
                  onInput={(value) =>
                    write(
                      modifiers.map((other, i) => (i === at ? { ...other, [key]: value } : other)),
                      false,
                    )
                  }
                  onChange={(value) =>
                    write(modifiers.map((other, i) => (i === at ? { ...other, [key]: value } : other)))
                  }
                />
              ) : null,
            )}
          </Row>
        );
      })}
    </RowList>
  );
}
