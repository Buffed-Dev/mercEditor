import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { IconFolder, IconPlus } from '@tabler/icons-react';
import { copyGame, countMaps, listGames, servedGame, type GameSummary } from '../state/games';
import { say } from '../state/status';
import styles from './Home.module.css';

/**
 * Which game do you want to work on.
 *
 * The editor is a tool over a shelf of folders under Games/, and until one is
 * picked there is nothing for a map view or a rules list to be about — so this
 * comes before any of it, and none of the editor is loaded while it is up.
 */
export function Home() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let live = true;
    void listGames().then((found: GameSummary[]) => {
      if (!live) return;
      setGames(found);
      // Asked for after the cards are up rather than before: the list is one
      // request and a count for each of them is one more apiece, and the screen
      // should not wait on the second lot to draw the first.
      for (const game of found) {
        void countMaps(game.id).then((count) => {
          if (live) setCounts((all) => ({ ...all, [game.id]: count }));
        });
      }
    });
    return () => {
      live = false;
    };
  }, []);

  async function onNew() {
    const id = window.prompt('New game id (letters, digits, dashes):', '')?.trim();
    if (!id) return;
    const from = games?.[0]?.id ?? servedGame;
    const error = await copyGame(id, from);
    if (error) return say(error, 'error');
    void navigate(`/${id}/map`);
  }

  return (
    <div className={styles.home}>
      <header className={styles.header}>
        <h1 className={styles.title}>Editor</h1>
        <p className={styles.lede}>
          Maps and rules for the games in <code>Games/</code>. Pick one to open it.
        </p>
      </header>

      <div className={styles.grid}>
        {games?.map((game) => (
          <button
            key={game.id}
            type="button"
            className={styles.card}
            onClick={() => void navigate(`/${game.id}/map`)}
          >
            <IconFolder size={18} className={styles.glyph} />
            <span className={styles.name}>{game.label ?? game.id}</span>
            <span className={styles.path}>Games/{game.id}</span>
            <span className={styles.meta}>
              {counts[game.id] == null
                ? '\u00a0'
                : `${counts[game.id]} map${counts[game.id] === 1 ? '' : 's'}`}
            </span>
          </button>
        ))}

        <button type="button" className={`${styles.card} ${styles.new}`} onClick={() => void onNew()}>
          <IconPlus size={18} className={styles.glyph} />
          <span className={styles.name}>New game</span>
          <span className={styles.path}>a copy of one you have</span>
        </button>
      </div>

      {games?.length === 0 && (
        <p className={styles.empty}>No game folders found. Is the dev server running?</p>
      )}
    </div>
  );
}
