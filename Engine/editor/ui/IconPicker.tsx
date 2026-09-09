import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { RPG_GLYPHS } from '../rpgGlyphs.ts';
import styles from './IconPicker.module.css';

/**
 * The picture an item or a category wears.
 *
 * Icon values are namespaced — `ra:sword` — because the vocabulary could grow a
 * second set and a bare name would then be ambiguous. RPG Awesome is what the
 * game's own data uses, all 494 of it, so that is what the grid offers.
 *
 * A name is not a picture: "ra:crystal-cluster" tells you nothing about what
 * will be drawn, which is the whole reason this is a grid of glyphs and not the
 * text box it replaced.
 */

const NAMES = Object.keys(RPG_GLYPHS as Record<string, string>);

/** Split `ra:sword` into its set and its name. */
const parse = (value: string) => {
  const at = value.indexOf(':');
  return at < 0 ? { set: '', name: value } : { set: value.slice(0, at), name: value.slice(at + 1) };
};

/**
 * One icon, drawn.
 *
 * Anything this does not recognise is shown as its own text rather than as
 * nothing — a value the picker cannot draw is still a value the record holds,
 * and silently showing an empty box would hide it.
 */
export function Glyph({ value, size = 15 }: { value: string; size?: number }) {
  const { set, name } = parse(value ?? '');
  if (!value) return <span className={styles.none} style={{ fontSize: size }} aria-hidden="true" />;
  if (set === 'ra' && name in (RPG_GLYPHS as Record<string, string>)) {
    return <i className={`ra ra-${name}`} style={{ fontSize: size }} aria-hidden="true" />;
  }
  return (
    <span className={styles.unknown} title={`Unknown icon "${value}"`}>
      {value}
    </span>
  );
}

export function IconPicker({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = needle ? NAMES.filter((name) => name.includes(needle)) : NAMES;

  return (
    <Popover.Root>
      <Popover.Trigger className={styles.trigger} aria-label={`${label}: ${value || 'none'}`}>
        <Glyph value={value} />
        <span className={styles.name}>{value || '— none —'}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4}>
          <Popover.Popup className={styles.popup}>
            <input
              className={styles.filter}
              placeholder={`Filter ${NAMES.length} icons`}
              aria-label="Filter icons"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />

            <div className={styles.grid}>
              {/* Clearing is a choice like any other, so it sits with them. */}
              <button
                type="button"
                className={`${styles.cell} ${value ? '' : styles.on}`}
                title="No icon"
                aria-label="No icon"
                onClick={() => onChange('')}
              >
                —
              </button>
              {shown.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`${styles.cell} ${value === `ra:${name}` ? styles.on : ''}`}
                  title={name}
                  aria-label={name}
                  onClick={() => onChange(`ra:${name}`)}
                >
                  <i className={`ra ra-${name}`} aria-hidden="true" />
                </button>
              ))}
            </div>

            {shown.length === 0 && <p className={styles.empty}>Nothing matches.</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
