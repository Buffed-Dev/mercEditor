import { id as servedGame } from '#game';

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
export async function listGames() {
  try {
    const response = await fetch('/__games');
    if (response.ok) return (await response.json()).games ?? [];
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
export function loadGame(id) {
  if (id === servedGame) return import('#game');
  return import(/* @vite-ignore */ `/Games/${id}/game.js`);
}

/**
 * Open a game folder, or — with no id — the home screen.
 *
 * A whole page load, because a game folder is a whole project: its maps, its
 * rules, its ids. Opening one is opening a document, not switching a tab, so it
 * comes up fresh rather than being migrated into the workspace around it.
 */
export function open(id) {
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
export async function newGame(from) {
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
    return `Could not make that game: ${error.message}. Is the dev server running?`;
  }
}
