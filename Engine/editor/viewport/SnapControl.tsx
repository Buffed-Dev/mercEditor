import { Popover } from '@base-ui/react/popover';
import { IconChevronDown, IconMagnet } from '@tabler/icons-react';
import { IconButton } from '../ui/Button';
import { useTools } from '../state/tools';
import styles from './SnapControl.module.css';

/**
 * Snapping: on or off with one click, and what it snaps to behind a chevron.
 *
 * Three figures, one per handle: how far a move steps, how many degrees a
 * turn, how much a scale. Kept in the tool store with the tool, so the map
 * and the prefab screens share one setting.
 */
const STEPS = {
  move: { label: 'Move', unit: 'tiles', choices: [0.1, 0.25, 0.5, 1] },
  turn: { label: 'Turn', unit: '°', choices: [5, 15, 45, 90] },
  scale: { label: 'Scale', unit: '×', choices: [0.05, 0.1, 0.25, 0.5] },
} as const;

export function SnapControl() {
  const snap = useTools((state) => state.snap);
  const setSnap = useTools((state) => state.setSnap);

  return (
    <span className={styles.group}>
      <IconButton
        label={snap.on ? 'Snapping on' : 'Snapping off'}
        active={snap.on}
        onClick={() => setSnap({ on: !snap.on })}
      >
        <IconMagnet size={17} />
      </IconButton>
      <Popover.Root>
        <Popover.Trigger className={styles.more} aria-label="Snap settings">
          <IconChevronDown size={13} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="end" sideOffset={6}>
            <Popover.Popup className={styles.popup}>
              {(Object.keys(STEPS) as (keyof typeof STEPS)[]).map((key) => (
                <label key={key} className={styles.row}>
                  <span className={styles.label}>{STEPS[key].label}</span>
                  <select
                    className={styles.select}
                    value={snap[key]}
                    onChange={(event) => setSnap({ [key]: Number(event.target.value) })}
                  >
                    {STEPS[key].choices.map((step) => (
                      <option key={step} value={step}>
                        {step}
                        {STEPS[key].unit === '°' ? '°' : ` ${STEPS[key].unit}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
