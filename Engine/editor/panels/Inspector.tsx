import { normalizeRim, rimOf } from '../../src/data/terrain/profile.ts';
import { OBJECT_LISTS, fieldsFor } from '../schema.ts';
import { ENV_GROUPS } from '../envGroups.ts';
import { Field } from '../fields/Field';
import { FieldList } from '../fields/FieldList';
import { palette } from '../fields/color';
import type { FieldSpec, FieldValue } from '../fields/types';
import { MapChunks } from './MapChunks';
import { TerrainProblems } from './TerrainProblems';
import { Section } from '../ui/Section';
import { useEdit } from '../state/useEdit';
import { useSelection } from '../state/selection';
import styles from './Inspector.module.css';
import type { DataDocument } from '../dataDocument.ts';
import type { MapDocument } from '../document.ts';
import type { MapEditor } from '../editor.ts';
import type { TerrainRecord } from './AssetShelves';

/**
 * What the inspector is about is whatever is selected — and with nothing
 * selected, the map itself.
 *
 * No tab strip. The old inspector had six tabs, of which Selection was empty
 * most of the time you were on any of the others, and reaching a map setting
 * meant leaving whatever you had picked. Selection state already answers which
 * of the two you want, so it is the switch.
 */
export function Inspector({
  doc,
  editor,
  rules,
  mapId,
  onPlaytest,
}: {
  doc: MapDocument | null;
  editor: MapEditor | null;
  rules: DataDocument | null;
  mapId: string;
  onPlaytest: () => void;
}) {
  const selection = useSelection((state) => state.selection);
  const edit = useEdit(doc, editor);

  if (!doc) return <div className={styles.empty}>No map open.</div>;

  const map = doc.map as unknown as Record<string, unknown>;
  const spec = selection ? OBJECT_LISTS[selection.list] : null;
  const entry = (
    selection
      ? selection.key !== undefined
        ? (map[selection.list] as Record<string, unknown>)?.[selection.key]
        : (map[selection.list] as unknown[])?.[selection.index as number]
      : null
  ) as Record<string, unknown> | null;

  // Offered by the colour picker, because most colour picking is reusing a
  // colour that is already on the map.
  const used = palette(map);

  /**
   * The pickers whose choices are the game's own lists rather than a fixed set.
   * The panel knows the rules document; the field components do not.
   */
  const resolveOptions = (field: FieldSpec): readonly (readonly [string, string])[] => {
    const list = field.kind === 'vfx' ? 'vfx' : 'props';
    return (rules?.list(list) ?? []).map((record) => {
      const id = String(record.id ?? '');
      return [id, String(record.label ?? id)] as const;
    });
  };

  if (selection && spec && entry) {
    const fields = fieldsFor(selection.list, entry) as FieldSpec[];
    const values = entry as Record<string, unknown>;

    return (
      <div className={styles.inspector}>
        <header className={styles.head}>
          <span className={styles.kind}>{spec.label}</span>
          <span className={styles.describes}>{spec.describe(entry, selection.key)}</span>
        </header>

        {fields.length === 0 ? (
          <p className={styles.note}>Nothing to configure.</p>
        ) : (
          <FieldList
            fields={fields}
            values={values}
            used={used}
            resolveOptions={resolveOptions}
            onInput={(key, value) =>
              edit.preview(
                () => write(doc, selection, key, value, false),
                // A light is the one thing that can be shown without rebuilding
                // the map, so it is the one thing that moves under the drag.
                selection.list === 'lights' && selection.index !== undefined
                  ? () => editor?.previewLight?.(selection.index as number, { [key]: value })
                  : undefined,
              )
            }
            onChange={(key, value) => edit.commit(() => write(doc, selection, key, value, false))}
          />
        )}
      </div>
    );
  }

  const rim = normalizeRim(doc.map.terrainRim);

  return (
    <div className={styles.inspector}>
      <Section id="inspector:map" title="Map">
        <Field
          field={{ key: 'name', kind: 'text', label: 'Name' }}
          value={doc.map.name as FieldValue}
          onInput={() => {}}
          onChange={(value) => edit.commit(() => doc.setMeta('name', value))}
        />
        <Field
          field={{ key: 'stepHeight', kind: 'range', label: 'Step height', min: 0.5, max: 12, step: 0.5 }}
          value={(doc.map.stepHeight ?? 1) as FieldValue}
          onInput={(value) => edit.preview(() => doc.setMeta('stepHeight', value, false))}
          onChange={(value) => edit.commit(() => doc.setMeta('stepHeight', value, false))}
        />
      </Section>

      <Section id="inspector:rim" title="Terrain edge">
        {/*
          The rim is stored as eight rings, but it is tuned as two numbers — how
          far in the edge starts and how far it falls. Rebuilding the rings from
          those is what the sliders write, so the shape stays one that the
          geometry can actually bake.
        */}
        <Field
          field={{ key: 'width', kind: 'range', label: 'Edge width', min: 0.02, max: 0.45, step: 0.01 }}
          value={rim[0].inset}
          onInput={(value) =>
            edit.preview(
              () => doc.setMeta('terrainRim', rimOf(Number(value), rim[rim.length - 1].drop), false),
              () => editor?.reprofile?.(doc.map.terrainRim),
            )
          }
          onChange={(value) =>
            edit.commit(() =>
              doc.setMeta('terrainRim', rimOf(Number(value), rim[rim.length - 1].drop), false),
            )
          }
        />
        <Field
          field={{ key: 'depth', kind: 'range', label: 'Edge depth', min: 0, max: 0.4, step: 0.01 }}
          value={rim[rim.length - 1].drop}
          onInput={(value) =>
            edit.preview(
              () => doc.setMeta('terrainRim', rimOf(rim[0].inset, Number(value)), false),
              () => editor?.reprofile?.(doc.map.terrainRim),
            )
          }
          onChange={(value) =>
            edit.commit(() => doc.setMeta('terrainRim', rimOf(rim[0].inset, Number(value)), false))
          }
        />
      </Section>

      {ENV_GROUPS.map((group) => {
        const env = doc.map.env as Record<string, unknown>;
        const body = (
          <FieldList
            fields={group.fields}
            values={env}
            used={used}
            onInput={(key, value) => edit.preview(() => doc.setEnv(key, value, false))}
            onChange={(key, value) => edit.commit(() => doc.setEnv(key, value, false))}
          />
        );

        // The first group is what a map cannot do without — its colours — and
        // the rest are effects it may simply not want. Each of those is a
        // switch and the settings behind it: a map with no fog says so once,
        // and nothing under an unticked switch is drawn or run.
        if (!group.key) {
          return (
            <Section key="colours" id="inspector:colours" title="Colours">
              {body}
            </Section>
          );
        }

        const on = Boolean(env[group.key]);
        return (
          <div key={group.key} className={`${styles.envGroup} ${on ? styles.on : ''}`}>
            <Field
              field={{ key: group.key, kind: 'bool', label: group.label ?? group.key }}
              value={on}
              onInput={() => {}}
              onChange={(value) => edit.commit(() => doc.setEnv(group.key as string, value))}
            />
            {on && body}
          </div>
        );
      })}

      {/* Anything wrong with the ground, before anything about arranging it. */}
      <TerrainProblems
        doc={doc as never}
        terrains={(rules?.list('terrains') ?? []) as TerrainRecord[]}
      />

      {/* The map's structure, after its look: which rectangles of it are
          pieces, and whether a run is assembled from them at all. */}
      <MapChunks
        doc={doc as never}
        editor={editor as never}
        mapId={mapId}
        onPlaytest={onPlaytest}
      />
    </div>
  );
}

/** Write one field of the selected thing, whichever list it is in. */
function write(
  doc: MapDocument,
  selection: NonNullable<ReturnType<typeof useSelection.getState>['selection']>,
  key: string,
  value: FieldValue,
  checkpointed: boolean,
) {
  if (selection.key !== undefined) {
    const spawns = (doc.map as unknown as Record<string, Record<string, Record<string, unknown>>>)
      .spawns;
    spawns[selection.key][key] = value;
    doc.checkpoint(checkpointed);
    return;
  }
  doc.updateObject(selection.list, selection.index as number, { [key]: value }, checkpointed);
}






