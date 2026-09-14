import { listGames, loadGame, servedGame } from '../games.ts';
import { get, list, post } from '../devServer.ts';
import { message } from '../../src/util/errors.ts';

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
    await post('/__games', `make ${id}`, { id, from });
    return null;
  } catch (error) {
    return message(error);
  }
}

/** How many maps a game has, so a card on the shelf says more than a name. */
export async function countMaps(id: string): Promise<number | null> {
  try {
    return list(await get('/__maps', `count the maps in ${id}`, { game: id }), 'files').length;
  } catch {
    // A card that cannot say how many maps a game has still says its name.
    return null;
  }
}
