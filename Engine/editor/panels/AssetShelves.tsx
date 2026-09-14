import {
  IconBox,
  IconPencil,
  IconDoor,
  IconPackage,
  IconSparkles,
  IconStack2,
  IconSun,
  IconTargetArrow,
} from '@tabler/icons-react';
import { LIGHT_TYPES } from '../../src/data/lights.ts';
import { BRUSHES, BRUSH_GROUPS } from '../document.ts';
import { Field } from '../fields/Field';
import type { FieldSpec, FieldValue } from '../fields/types';
import { Section } from '../ui/Section';
import { Tooltip } from '../ui/Tooltip';
import { SLOT_KEYS, useTools } from '../state/tools';
import styles from './AssetShelves.module.css';

/**
 * What can be put on the map.
 *
 * Swatches rather than a list of names: picking a brush is recognising a thing,
 * and at three to a row you can see the whole shelf at once. The shelf headings
 * are how they are arranged and nothing more — two brushes in one group have
 * nothing in common but a heading.
 *
 * The chosen brush's own settings sit underneath rather than in the inspector,
 * because they are about what the *next* click will place, not about anything
 * that exists yet. The inspector is for things that are already on the map.
 */

const GLYPHS: Record<string, typeof IconBox> = {
  door: IconDoor,
  light: IconSun,
  vfx: IconSparkles,
  prop: IconBox,
  prefab: IconPackage,
  chunk: IconStack2,
  spawn: IconTargetArrow,
};

/** What a brush needs answering before it can be put down. */
function optionsFor(brush: string): FieldSpec[] {
  if (brush === 'light') {
    return [
      {
        key: 'lightType',
        kind: 'select',
        label: 'Type',
        options: Object.entries(LIGHT_TYPES).map(
          ([id, spec]) => [id, (spec as { label: string }).label] as const,
        ),
      },
    ];
  }
  return [];
}

/** What a ground swatch needs of a terrain. See dataDocument's RuleRecord. */
export type TerrainRecord = { id: string; label?: string; char?: string };

/** What a prefab swatch needs of a prefab. The same shape, for the same reason. */
export type PrefabRecord = { id: string; label?: string };

export function AssetShelves({
  prefabs = [],
  onEditPrefab,
  brushes = true,
  without,
}: {
  /**
   * The prefabs this game has, which on the map screen is the whole shelf.
   *
   * A map is built out of prefabs and nothing else, so this is the palette:
   * picking one is picking up the brush for it, the same way picking a terrain
   * used to be.
   */
  prefabs?: readonly PrefabRecord[];
  /** Open a prefab's own screen, where what it is made of is decided. */
  onEditPrefab?: (id: string) => void;
  /**
   * Whether the brush shelves are offered at all.
   *
   * The map has no use for them — it places prefabs — and the prefab screen is
   * where they belong, because a prefab is what they are for. That is the whole
   * of the split: a map is made of prefabs, a prefab is made of objects.
   */
  brushes?: boolean;
  /** Brushes this screen has no business offering. See PrefabWorkspace. */
  without?: readonly string[];
}) {
  const brush = useTools((state) => state.brush);
  const setBrush = useTools((state) => state.setBrush);
  const setTool = useTools((state) => state.setTool);
  const options = useTools((state) => state.options);
  const setOption = useTools((state) => state.setOption);

  const fields = brushes && brush ? optionsFor(brush) : [];
  const heldPrefab = brush === 'prefab' ? String(options.prefab?.prefabId ?? '') : '';

  return (
    <div className={styles.shelves}>
      {prefabs.length > 0 && (
        <Section id="assets:prefabs" title="Prefabs" count={prefabs.length}>
          <div className={styles.grid}>
            {prefabs.map((prefab) => {
              const name = prefab.label ?? prefab.id;
              const on = heldPrefab === prefab.id;
              return (
                <Tooltip key={prefab.id} label={on ? `${name} — click again to put it down` : name}>
                  <button
                    type="button"
                    className={`${styles.swatch} ${on ? styles.on : ''}`}
                    aria-pressed={on}
                    onClick={() => {
                      // The same bargain the brush shelves strike: picking the
                      // one already in hand puts it down, because there has to
                      // be a way to stop placing that is not "place something
                      // else instead".
                      if (on) {
                        setBrush(null);
                        setTool('select');
                        return;
                      }
                      // Which prefab is an option on the prefab brush, which is
                      // where placing already reads it from -- so choosing here
                      // needs nothing new underneath.
                      setOption('prefab', 'prefabId', prefab.id);
                      setBrush('prefab');
                      setTool('place');
                    }}
                    onDoubleClick={() => onEditPrefab?.(prefab.id)}
                  >
                    <IconPackage size={20} />
                    <span className={styles.label}>{name}</span>
                    {onEditPrefab && (
                      <span
                        className={styles.edit}
                        role="button"
                        tabIndex={0}
                        aria-label={`Edit ${name}`}
                        title="Edit this prefab"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditPrefab(prefab.id);
                        }}
                        onKeyDown={(event) => event.key === 'Enter' && onEditPrefab(prefab.id)}
                      >
                        <IconPencil size={12} />
                      </span>
                    )}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </Section>
      )}

      {brushes &&
        (BRUSH_GROUPS as [string, string][]).map(([group, label]) => {
        const inGroup = (BRUSHES as { id: string; label: string; group: string }[]).filter(
          (asset) => asset.group === group && !without?.includes(asset.id),
        );
        // A shelf with nothing on it is not drawn, so adding a group costs
        // nothing until something is put in it.
        if (!inGroup.length) return null;

        return (
          <Section key={group} id={`assets:${group}`} title={label} count={inGroup.length}>
            <div className={styles.grid}>
              {inGroup.map((asset) => {
                const Glyph = GLYPHS[asset.id] ?? IconBox;
                // Where a brush sits in the catalogue is the digit it answers
                // to; past the tenth there is no digit left to give.
                const slot = SLOT_KEYS[
                  (BRUSHES as { id: string }[]).findIndex((entry) => entry.id === asset.id)
                ];
                return (
                  <Tooltip
                    key={asset.id}
                    label={
                      brush === asset.id
                        ? `${asset.label} — click again to put it down`
                        : asset.label
                    }
                  >
                  <button
                    type="button"
                    className={`${styles.swatch} ${brush === asset.id ? styles.on : ''}`}
                    aria-pressed={brush === asset.id}
                    onClick={() => {
                      // Picking the brush already in hand puts it down: there
                      // has to be a way to stop placing that is not "choose
                      // something else to place instead".
                      if (brush === asset.id) {
                        setBrush(null);
                        setTool('select');
                        return;
                      }
                      setBrush(asset.id);
                      // Picking something to place is saying you want to place
                      // it: reaching for the tool as well would be a second
                      // step that only ever has one answer.
                      setTool('place');
                    }}
                  >
                    {slot && (
                      <span className={styles.slot} aria-hidden="true">
                        {slot}
                      </span>
                    )}
                    <Glyph size={20} />
                    <span className={styles.label}>{asset.label}</span>
                  </button>
                  </Tooltip>
                );
              })}
            </div>
          </Section>
        );
      })}

      {fields.length > 0 && brush && (
        <div className={styles.options}>
          <span className={styles.optionsHead}>{brush} settings</span>
          {fields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={options[brush]?.[field.key] as FieldValue}
              onInput={() => {}}
              onChange={(value) => setOption(brush, field.key, value as string | number)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
