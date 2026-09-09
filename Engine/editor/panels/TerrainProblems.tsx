import { IconAlertTriangle } from '@tabler/icons-react';
import { validateTerrain } from '../terrain/validate.ts';
import type { TerrainGrid } from '../../src/data/terrain/grid.ts';
import { Section } from '../ui/Section';
import styles from './TerrainProblems.module.css';

type MapDoc = {
  terrain: TerrainGrid;
  terrainIds: readonly string[];
  problems: readonly string[];
};

/**
 * What is wrong with this map's terrain, as sentences naming where.
 *
 * Reported rather than repaired. A map that quietly fixes itself on load is a
 * map whose file and whose contents disagree, and the next save writes the
 * repair back over whatever the author actually meant.
 *
 * Absent when there is nothing to say. A panel that reports "no problems" every
 * time is one you stop reading, and then it is no use on the day there is one.
 */
export function TerrainProblems({
  doc,
  terrains,
}: {
  doc: MapDoc;
  terrains: readonly { id: string }[];
}) {
  const problems = validateTerrain(doc.terrain, doc.terrainIds, terrains as never, doc.problems);
  if (!problems.length) return null;

  return (
    <Section id="inspector:problems" title={`Problems · ${problems.length}`}>
      {problems.map((problem, index) => (
        <p key={index} className={`${styles.problem} ${problem.fatal ? styles.fatal : ''}`}>
          <IconAlertTriangle size={13} className={styles.glyph} />
          {problem.text}
        </p>
      ))}
    </Section>
  );
}
