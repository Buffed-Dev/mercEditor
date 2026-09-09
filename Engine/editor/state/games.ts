import { listGames, loadGame, servedGame } from '../games.ts';

export type { GameSummary } from '../games.ts';

export { listGames, loadGame, servedGame };

/**
 * Start a game by copying one you have.
 *
 * Separate from `newGame` in games.js, which asks for the id with a prompt and
 * then navigates by rewriting `location.search`. Both of those belong to the
 * screen rather than to the shelf: the id is asked for by a dialog and the
 * navigation is the router's. This does the one part that is neither.
 *
 * A blank folder is not something the editor can open — every rules list would
 * be empty and there would be nothing to hang a first ability off — so a new
 * game is always a copy of a working one.
 *
 * @returns what went wrong, or null if the game was made.
 */
export async function copyGame(id: string, from: string): Promise<string | null> {
  try {
    const response = await fetch('/__games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, from }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) return body.error ?? 'Could not make that game';
    return null;
  } catch (error) {
    return `Could not make that game: ${(error as Error).message}. Is the dev server running?`;
  }
}

/** How many maps a game has, so a card on the shelf says more than a name. */
export async function countMaps(id: string): Promise<number | null> {
  try {
    const response = await fetch(`/__maps?game=${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    return ((await response.json()) as { files?: unknown[] }).files?.length ?? null;
  } catch {
    return null;
  }
}
