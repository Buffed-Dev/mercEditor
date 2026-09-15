import { useEffect, useState } from 'react';
import { resetMaps } from '../../src/data/maps/index.ts';
import type { GameMap } from '../../src/data/mapFormat.ts';
import { createDataDocument } from '../dataDocument.ts';
import { loadGame } from '../games.ts';
import { globalHistory } from '../globalHistory.ts';
import {
  autosaveLibrary,
  autosaveRules,
  fetchTree,
  listsFromTree,
  refreshTree,
  takeTree,
  type DraftTree,
} from '../assets/session.ts';
import { say } from './status';

export type LoadedGame = {
  id: string;
  label: string;
  /** Every rules list and the asset records, as one document. */
  rules: ReturnType<typeof createDataDocument>;
};

/**
 * The games opened this session, by id.
 *
 * Opened once and kept, because the document holds work and its history, and
 * every workspace must be handed the same one.
 */
const opened = new Map<string, { game: LoadedGame; maps: readonly GameMap[] }>();

/** A map module's text, run as a module, and the map it exports. */
async function mapFromSource(text: string): Promise<GameMap | null> {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  try {
    const module = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
    return (Object.values(module).find((value) => (value as GameMap)?.id && (value as GameMap)?.terrain) ??
      null) as GameMap | null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The maps as the draft has them: a drafted map file is read from the draft,
 * a published one is taken from the game module, and one the draft deleted is
 * left out.
 */
async function draftMaps(game: string, tree: DraftTree, published: readonly GameMap[]): Promise<GameMap[]> {
  const byId = new Map(published.map((map) => [map.id, map]));
  const out: GameMap[] = [];
  for (const entry of tree.entries) {
    if (entry.dir || !entry.path.startsWith('maps/') || !entry.path.endsWith('.js')) continue;
    const id = entry.path.slice('maps/'.length, -'.js'.length);
    if (!entry.draft && byId.has(id)) {
      out.push(byId.get(id)!);
      continue;
    }
    try {
      const response = await fetch(`/__draft/file?game=${encodeURIComponent(game)}&path=${encodeURIComponent(entry.path)}`);
      const map = response.ok ? await mapFromSource(await response.text()) : null;
      if (map) out.push(map);
    } catch (error) {
      say(`Could not read the draft of ${id}: ${(error as Error).message}`, 'error');
    }
  }
  return out;
}

/**
 * Open a game folder: its manifest, its maps and its document, all as the
 * draft has them, with autosave running from then on.
 */
export function useGame(id: string): LoadedGame | null {
  const [game, setGame] = useState<LoadedGame | null>(() => opened.get(id)?.game ?? null);

  useEffect(() => {
    let live = true;

    const already = opened.get(id);
    if (already) {
      // The registry already holds this game's maps, drafts written since
      // included; resetting it to the list read at opening would lose those.
      setGame(already.game);
      return;
    }

    setGame(null);
    void (async () => {
      const module = (await loadGame(id)) as { label?: string; rules?: Record<string, unknown>; maps?: GameMap[] };
      let tree: DraftTree | null = null;
      try {
        tree = await fetchTree(id);
      } catch (error) {
        say(`Could not read the draft, showing what is published: ${(error as Error).message}`, 'error');
      }
      const maps = tree ? await draftMaps(id, tree, module.maps ?? []) : (module.maps ?? []);
      if (!live) return;
      resetMaps(maps);
      if (tree) takeTree(tree);

      const made = opened.get(id)?.game ?? {
        id,
        label: module.label ?? id,
        rules: createDataDocument({
          ...(module.rules as object),
          ...(tree ? listsFromTree(tree) : {}),
        } as Parameters<typeof createDataDocument>[0]),
      };
      if (!opened.has(id)) {
        globalHistory.attach(made.rules, 'asset');
        autosaveLibrary(id, made.rules, () => void refreshTree(id));
        autosaveRules(id, made.rules);
      }
      opened.set(id, { game: made, maps });
      setGame(made);
    })().catch((error: unknown) => {
      if (live) say(`Could not open ${id}: ${(error as Error).message}`, 'error');
    });

    return () => {
      live = false;
    };
  }, [id]);

  return game;
}
