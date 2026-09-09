import {
  IconBox,
  IconPencil,
  IconDoor,
  IconFlame,
  IconGhost,
  IconHammer,
  IconSparkles,
  IconStack2,
  IconSun,
  IconTargetArrow,
} from '@tabler/icons-react';
import { destinationIds } from '../../src/data/maps/index.js';
import { LIGHT_TYPES } from '../../src/data/lights.ts';
import { ASSETS, ASSET_GROUPS } from '../document.js';
import { Field } from '../fields/Field';
import type { FieldSpec, FieldValue } from '../fields/types';
import { Section } from '../ui/Section';
import { Tooltip } from '../ui/Tooltip';
import { SLOT_KEYS, TOOLS_BY_TERRAIN, isTerrainTool, toolById, useTools } from '../state/tools';
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
  wall: IconStack2,
  door: IconDoor,
  portal: IconDoor,
  grunt: IconGhost,
  brute: IconGhost,
  vase: IconBox,
  light: IconSun,
  torch: IconFlame,
  vfx: IconSparkles,
  station: IconHammer,
  prop: IconBox,
  chunk: IconStack2,
  spawn: IconTargetArrow,
};

const FACES: readonly (readonly [string, string])[] = [
  ['+x', '+x'],
  ['+y', '+y'],
  ['-x', '-x'],
  ['-y', '-y'],
];

/** What a brush needs answering before it can be put down. */
function optionsFor(brush: string): FieldSpec[] {
  if (brush === 'portal') {
    return [
      {
        key: 'to',
        kind: 'select',
        label: 'Goes to',
        options: destinationIds().map((id: string) => [id, id] as const),
      },
      { key: 'spawn', kind: 'text', label: 'Arrive at' },
    ];
  }
  if (brush === 'torch') {
    return [{ key: 'face', kind: 'select', label: 'Mounted facing', options: FACES }];
  }
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

type TerrainRecord = { id: string; label?: string; char?: string };

export function AssetShelves({
  terrains,
  onEditTerrain,
}: {
  terrains: TerrainRecord[];
  /** Open a terrain's own record, where what it is made of is decided. */
  onEditTerrain: (id: string) => void;
}) {
  const tool = useTools((state) => state.tool);
  const terrainId = useTools((state) => state.terrainId);
  const setTerrainId = useTools((state) => state.setTerrainId);
  const terrainOptions = useTools((state) => state.terrainOptions);
  const setTerrainOption = useTools((state) => state.setTerrainOption);
  const brush = useTools((state) => state.brush);
  const setBrush = useTools((state) => state.setBrush);
  const setTool = useTools((state) => state.setTool);
  const options = useTools((state) => state.options);
  const setOption = useTools((state) => state.setOption);

  const fields = brush ? optionsFor(brush) : [];

  // What a terrain tool needs answering — a brush width, a height to level to.
  // Read off the tool itself, so a new terrain tool brings its own settings.
  const terrainSpec = isTerrainTool(tool) ? toolById(tool).terrainTool : null;
  const terrainFields = (terrainSpec ? TOOLS_BY_TERRAIN[terrainSpec]?.fields : null) ?? [];

  return (
    <div className={styles.shelves}>
      {/*
        The ground is one of the things you put on the map, so it is a shelf
        here rather than a panel somewhere else. Picking one is also picking up
        the brush for it — the terrain tools are useless without a terrain, and
        making that two steps only ever had one answer.
      */}
      {terrains.length > 0 && (
        <Section id="assets:ground" title="Ground" count={terrains.length}>
          <div className={styles.grid}>
            {terrains.map((terrain) => (
              <Tooltip key={terrain.id} label={terrain.label ?? terrain.id}>
              <button
                type="button"
                className={`${styles.swatch} ${terrainId === terrain.id ? styles.on : ''}`}
                aria-pressed={terrainId === terrain.id}
                onClick={() => {
                  setTerrainId(terrain.id);
                  if (!isTerrainTool(tool)) setTool('terrain.paint');
                }}
                // The way through to the record itself. Paired with a visible
                // affordance below, because a double-click nobody has been told
                // about is a feature nobody has.
                onDoubleClick={() => onEditTerrain(terrain.id)}
              >
                <span className={styles.chip} aria-hidden="true">
                  {terrain.char ?? terrain.id.slice(0, 2)}
                </span>
                <span className={styles.label}>{terrain.label ?? terrain.id}</span>
                <span
                  className={styles.edit}
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit ${terrain.label ?? terrain.id}`}
                  title="Edit this terrain"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditTerrain(terrain.id);
                  }}
                  onKeyDown={(event) => event.key === 'Enter' && onEditTerrain(terrain.id)}
                >
                  <IconPencil size={12} />
                </span>
              </button>
              </Tooltip>
            ))}
          </div>
        </Section>
      )}

      {terrainFields.length > 0 && terrainSpec && (
        <div className={styles.options}>
          <span className={styles.optionsHead}>{toolById(tool).label} settings</span>
          {terrainFields.map((field) => (
            <Field
              key={field.key}
              field={field as FieldSpec}
              value={
                (terrainOptions[terrainSpec]?.[field.key] ?? field.default) as FieldValue
              }
              onInput={(value) =>
                setTerrainOption(terrainSpec, field.key, value as string | number)
              }
              onChange={(value) =>
                setTerrainOption(terrainSpec, field.key, value as string | number)
              }
            />
          ))}
        </div>
      )}

      {(ASSET_GROUPS as [string, string][]).map(([group, label]) => {
        const inGroup = (ASSETS as { id: string; label: string; group: string }[]).filter(
          (asset) => asset.group === group,
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
                  (ASSETS as { id: string }[]).findIndex((entry) => entry.id === asset.id)
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
