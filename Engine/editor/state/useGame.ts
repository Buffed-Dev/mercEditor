import { useEffect, useState } from 'react';
import { resetMaps } from '../../src/data/maps/index.ts';
import { createDataDocument } from '../dataDocument.ts';
import { loadGame } from '../games.ts';
import { say } from './status';

export type LoadedGame = {
  id: string;
  label: string;
  /** Every rules list, as one document — they cross-reference, so one history. */
  rules: ReturnType<typeof createDataDocument>;
};

/**
 * The games opened this session, by id.
 *
 * A game is opened once and kept, because its rules document is a document:
 * it holds your unsaved work and its own undo history. Built fresh on every
 * mount -- which is what this did -- crossing between the map, the library and
 * a prefab threw both away without a word. Renaming a material and walking
 * next door to look at the terrain wearing it lost the rename.
 *
 * Kept in a module rather than in state because the point is to outlive the
 * component: every workspace mounts its own `useGame`, and they must be
 * handed the same document or "unsaved" means a different thing in each.
 */
const opened = new Map<string, { game: LoadedGame; maps: Parameters<typeof resetMaps>[0] }>();

/**
 * Open a game folder: its manifest, its map registry and its rules document.
 *
 * Loading a game *replaces* the map registry rather than adding to it. The
 * registry was filled from whichever game this page was built against, so
 * without that the map list, the portal destinations and everything else that
 * reads MAPS would be a mixture of two games. Which is why the registry is
 * reset even for a game already open: another one may have been opened since.
 *
 * Every workspace uses this, which is what keeps "which game am I in" from
 * being answered several slightly different ways.
 */
export function useGame(id: string): LoadedGame | null {
  const [game, setGame] = useState<LoadedGame | null>(() => opened.get(id)?.game ?? null);

  useEffect(() => {
    let live = true;

    const already = opened.get(id);
    if (already) {
      resetMaps(already.maps);
      setGame(already.game);
      return;
    }

    setGame(null);
    void loadGame(id)
      .then((module: { label?: string; rules?: object; maps?: Parameters<typeof resetMaps>[0] }) => {
        if (!live) return;
        const maps = module.maps ?? [];
        resetMaps(maps);
        // Checked again rather than assumed: two workspaces mounting at once
        // would otherwise each build a document and the second would win.
        const made = opened.get(id)?.game ?? {
          id,
          label: module.label ?? id,
          rules: createDataDocument(module.rules ?? {}),
        };
        opened.set(id, { game: made, maps });
        setGame(made);
      })
      .catch((error: unknown) => {
        if (live) say(`Could not open ${id}: ${(error as Error).message}`, 'error');
      });

    return () => {
      live = false;
    };
  }, [id]);

  return game;
}
