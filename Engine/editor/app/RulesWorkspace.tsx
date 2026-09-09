import { useNavigate, useParams } from 'react-router';
import { writeRules } from '../save.js';
import { Shell } from '../shell/Shell';
import { DockPanel } from '../shell/DockPanel';
import { StatusBar } from '../shell/StatusBar';
import { TopBar } from '../shell/TopBar';
import { RecordDetail } from '../panels/RecordDetail';
import { RecordGrid, type Record_ } from '../panels/RecordGrid';
import { RulesNav } from '../panels/RulesNav';
import { GROUPS, GROUP_OF, LIST_LABELS, type ListId } from '../rules/schema';
import { useDocument } from '../state/useDocument';
import { useGame } from '../state/useGame';
import { useLayout } from '../state/layout';
import { say } from '../state/status';
import styles from './RulesWorkspace.module.css';

/**
 * The rules screen, laid out with the same regions doing the same jobs as the
 * map screen: browse on the left, look in the middle, edit on the right.
 *
 * No tool rail — there is nothing here to point at a map with. The centre holds
 * a grid of record cards rather than a canvas, which is the only difference in
 * what the regions contain, not in what they are for.
 *
 * Which list and which record are in the URL, so a reference link is real
 * navigation: the back button walks back out of the graph you followed.
 */
export function RulesWorkspace() {
  const { gameId = '', list, recordId } = useParams<{ gameId: string; list: ListId; recordId: string }>();
  const navigate = useNavigate();
  const game = useGame(gameId);
  const layout = useLayout(gameId);
  const doc = useDocument(game?.rules ?? null);

  const active: ListId = list ?? 'attributes';
  const records = (doc?.list(active) ?? []) as Record_[];
  const index = records.findIndex((record) => record.id === recordId);
  const selected = index >= 0 ? records[index] : null;

  const counts = Object.fromEntries(
    GROUPS.flatMap((group) => group.lists).map((id) => [id, doc?.list(id).length ?? 0]),
  );

  async function onSave() {
    if (!doc) return;
    try {
      const files = await writeRules(gameId, doc.data);
      doc.markSaved();
      say(`Wrote ${files} rule files`, 'good');
    } catch (error) {
      say(`Save failed: ${(error as Error).message}. Is the dev server running?`, 'error');
    }
  }

  /**
   * What a card shows besides its name.
   *
   * Declared per list rather than guessed from the record, because which two
   * numbers matter is a question about the list — an ability is worth comparing
   * by cost and cooldown, an attribute by its base and its ceiling.
   */
  function summarise(record: Record_) {
    const value = (key: string) => (record[key] === undefined ? null : String(record[key]));
    const stats: [string, string][] = [];
    const chips: string[] = [];

    for (const [key, label] of SUMMARY[active] ?? []) {
      const found = value(key);
      if (found !== null && found !== '') stats.push([label, found]);
    }
    for (const key of CHIPS[active] ?? []) {
      const found = value(key);
      if (found) chips.push(found);
    }
    return { kind: record.id, chips, stats: stats.slice(0, 2) };
  }

  return (
    <Shell
      game={gameId}
      topBar={
        <TopBar
          game={gameId}
          gameLabel={game?.label ?? gameId}
          canUndo={Boolean(doc?.canUndo)}
          canRedo={Boolean(doc?.canRedo)}
          onUndo={() => doc?.undo()}
          onRedo={() => doc?.redo()}
          dirty={Boolean(doc?.dirty)}
          onSave={() => void onSave()}
          onPlaytest={() => window.open('/', '_blank')}
        />
      }
      left={
        <DockPanel
          title="Rules"
          side="left"
          collapsed={layout.leftCollapsed}
          onToggle={layout.toggleLeft}
        >
          <RulesNav game={gameId} counts={counts} />
        </DockPanel>
      }
      viewport={
        // The group's hue rides on the whole middle and right, so the record you
        // are editing is coloured by the part of the game it belongs to.
        <div className={styles.stage} data-group={GROUP_OF[active]}>
          <DockPanel title={LIST_LABELS[active]} side="left">
            <RecordGrid
              list={active}
              records={records}
              selected={recordId}
              summarise={summarise}
              onSelect={(id) => void navigate(`/${gameId}/rules/${active}/${id}`)}
              onAdd={() => {
                const made = doc?.add(active);
                if (made) void navigate(`/${gameId}/rules/${active}/${records[made.index]?.id ?? ''}`);
              }}
              onDelete={(at) => {
                doc?.remove(active, at);
                void navigate(`/${gameId}/rules/${active}`);
              }}
            />
          </DockPanel>
        </div>
      }
      inspector={
        <div className={styles.stage} data-group={GROUP_OF[active]}>
          <DockPanel
            title="Detail"
            side="right"
            collapsed={layout.inspectorCollapsed}
            onToggle={layout.toggleInspector}
          >
            {selected && doc ? (
              <RecordDetail
                game={gameId}
                list={active}
                index={index}
                record={selected as Record<string, unknown>}
                doc={doc}
              />
            ) : (
              <p className={styles.none}>Pick a record to edit it.</p>
            )}
          </DockPanel>
        </div>
      }
      statusBar={<StatusBar />}
    />
  );
}

/** The two numbers worth comparing records of each list by. */
const SUMMARY: Partial<Record<ListId, [string, string][]>> = {
  attributes: [
    ['base', 'base'],
    ['max', 'max'],
  ],
  effects: [
    ['seconds', 'lasts'],
    ['interval', 'every'],
  ],
  abilities: [
    ['cooldown', 'cd'],
    ['range', 'range'],
  ],
  items: [['start', 'start']],
  baseLevels: [['level', 'level']],
};

/** The tags that say what kind of thing a record is at a glance. */
const CHIPS: Partial<Record<ListId, string[]>> = {
  attributes: ['kind'],
  effects: ['duration'],
  abilities: ['shape'],
  items: ['category', 'slot'],
  categories: ['behaviour'],
};
