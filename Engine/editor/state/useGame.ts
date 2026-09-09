import { useEffect, useState } from 'react';
import { resetMaps } from '../../src/data/maps/index.ts';
import { createDataDocument } from '../dataDocument.js';
import { loadGame } from '../games.js';
import { say } from './status';

export type LoadedGame = {
  id: string;
  label: string;
  /** Every rules list, as one document — they cross-reference, so one history. */
  rules: ReturnType<typeof createDataDocument>;
};

/**
 * Open a game folder: its manifest, its map registry and its rules document.
 *
 * Loading a game *replaces* the map registry rather than adding to it. The
 * registry was filled from whichever game this page was built against, so
 * without that the map list, the portal destinations and everything else that
 * reads MAPS would be a mixture of two games.
 *
 * Both workspaces use this, which is what keeps "which game am I in" from
 * being answered two slightly different ways.
 */
export function useGame(id: string): LoadedGame | null {
  const [game, setGame] = useState<LoadedGame | null>(null);

  useEffect(() => {
    let live = true;
    setGame(null);

    void loadGame(id)
      .then((module: { label?: string; rules?: object; maps?: Parameters<typeof resetMaps>[0] }) => {
        if (!live) return;
        resetMaps(module.maps ?? []);
        setGame({
          id,
          label: module.label ?? id,
          rules: createDataDocument(module.rules ?? {}),
        });
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
