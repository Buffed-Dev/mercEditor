import { IconPlus } from '@tabler/icons-react';
import { MAPS, mapIds } from '../../src/data/maps/index.ts';
import { Button } from '../ui/Button';
import styles from './MapList.module.css';

/** Which map you are editing, and the way to start another. */
export function MapList({
  current,
  onOpen,
  onNew,
}: {
  current?: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className={styles.list}>
      {mapIds().map((id: string) => (
        <button
          key={id}
          type="button"
          className={`${styles.row} ${id === current ? styles.on : ''}`}
          aria-current={id === current}
          onClick={() => onOpen(id)}
        >
          <span className={styles.name}>{(MAPS[id]?.name as string) ?? id}</span>
          <span className={styles.id}>{id}</span>
        </button>
      ))}
      <Button variant="quiet" className={styles.add} onClick={onNew}>
        <IconPlus size={13} />
        New map
      </Button>
    </div>
  );
}
