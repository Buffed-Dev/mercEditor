import { id as gameId } from '#game';
import type { GameMap } from '../src/data/mapFormat.ts';

/**
 * Which game this dev server is serving.
 *
 * `#game` is content, outside the type checker, so its exports arrive as
 * `any`. Naming the shape here keeps that from spreading.
 */
const servedGame = gameId as string;

/** One game folder, as the shelf lists it. */
export type GameSummary = { id: string; label?: string };

/**
 * A game's manifest, as the editor reads it.
 *
 * `#game` and the dynamic import below are both content outside the type
 * checker, so this says what is actually reached for rather than letting `any`
 * spread into whatever opens a game.
 */
export type GameModule = {
  id?: string;
  label?: string;
  rules?: object;
  maps?: readonly GameMap[];
};

/**
 * The shelf: what games there are, and how to open, start and address one.
 *
 * A game is a folder under Games/ — a manifest, a `maps/` folder and a `rules/`
 * folder. Everything here is about picking one; nothing here knows what is
 * inside it. Both the home screen and the workspace import this, which is what
 * keeps "which game" from being answered two slightly different ways.
 */

export { servedGame };

/** Every game folder the dev server can see, freshly asked each time. */
export async function listGames(): Promise<GameSummary[]> {
  try {
    const response = await fetch('/__games');
    if (response.ok) {
      const body = (await response.json()) as { games?: GameSummary[] };
      return body.games ?? [];
    }
  } catch {
    // No dev server: the one this page was built against is still openable,
    // because its manifest came in with the bundle.
  }
  return [];
}

/**
 * Load a game folder's manifest.
 *
 * By path rather than by import specifier: `#game` is fixed at build time and
 * names one game, which is exactly what a tool over several of them cannot be
 * limited to.
 */
export function loadGame(id: string): Promise<GameModule> {
  if (id === servedGame) return import('#game') as Promise<GameModule>;
  return import(/* @vite-ignore */ `/Games/${id}/game.js`) as Promise<GameModule>;
}

/**
 * Open a game folder, or — with no id — the home screen.
 *
 * A whole page load, because a game folder is a whole project: its maps, its
 * rules, its ids. Opening one is opening a document, not switching a tab, so it
 * comes up fresh rather than being migrated into the workspace around it.
 */
export function open(id: string | null | undefined): void {
  location.search = id ? `?game=${encodeURIComponent(id)}` : '';
}

/**
 * Start a game by copying one you have, and open it.
 *
 * A blank folder would be a game with no attributes and no maps, which is not
 * something the editor can open — every list in it would be empty and there
 * would be nothing to hang a first ability off. Copying a working game is the
 * shortest route to a second one you can actually play.
 *
 * @returns {Promise<string|null>} what went wrong, or null if it is opening.
 */
export async function newGame(from: string): Promise<string | null> {
  const id = prompt('New game id (letters, digits, dashes):', '')?.trim();
  if (!id) return null;
  try {
    const response = await fetch('/__games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, from }),
    });
    const body = await response.json();
    if (!response.ok) return body.error ?? 'Could not make that game';
    open(id);
    return null;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return `Could not make that game: ${why}. Is the dev server running?`;
  }
}
