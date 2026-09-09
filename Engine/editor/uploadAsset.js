import { ASSET_EXTENSIONS, ASSET_KINDS, assetRewritten } from '../src/data/assets.ts';

/**
 * Getting a file into a game folder.
 *
 * The file goes to `Games/<game>/assets/` and a record names it. A model is not
 * something a rules file can hold, and the effects editor proved what happens
 * when you try: a megabyte of base64 for pictures a hundred pixels across.
 *
 * Lifted out of the old assets mode so both editors write files the same way.
 */

const readFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('That file could not be read'));
    reader.readAsDataURL(file);
  });

/**
 * A filename the server will take: what the browser gave us, with anything it
 * would refuse turned into an underscore.
 *
 * Renamed here rather than rejected, because the name came off a file somebody
 * exported hours ago and "rock (final)(2).glb" is not worth a round trip.
 *
 * @returns the safe name, or '' when the extension is not one we can use.
 */
export function safeFileName(name = '') {
  const dot = name.lastIndexOf('.');
  const ext = (dot > 0 ? name.slice(dot + 1) : '').toLowerCase();
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9 _-]/g, '_').slice(0, 63);
  const safe = /^[A-Za-z0-9]/.test(stem) ? stem : `asset ${stem}`.trim();
  return ASSET_EXTENSIONS.includes(ext) ? `${safe}.${ext}` : '';
}

/** What a file's extension says it is. There is nothing to ask about a .glb. */
export const kindOfFile = (name) =>
  ASSET_KINDS.mesh.extensions.includes(name.split('.').pop().toLowerCase()) ? 'mesh' : 'texture';

/** The name without its extension, which is what the record is called. */
export const stemOf = (name) => name.replace(/\.[^.]+$/, '');

/**
 * Store one file in the game folder.
 *
 * Dropping a file on a name that already exists overwrites it, which makes this
 * a replacement as much as an upload — and why everything drawn from those
 * bytes has to be let go of afterwards. Without `assetRewritten` the map keeps
 * the model and the picture it already had until the page is reloaded.
 *
 * @returns {Promise<{name: string} | {error: string}>}
 */
export async function uploadAsset(game, file) {
  const name = safeFileName(file.name);
  if (!name) return { error: `${file.name} is not a kind of file this can use` };

  try {
    const response = await fetch('/__assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, name, data: await readFile(file) }),
    });
    const body = await response.json();
    if (!response.ok) return { error: body.error ?? `Could not store ${file.name}` };
    assetRewritten(name);
    return { name };
  } catch (error) {
    return { error: `Could not store ${file.name}: ${error.message}. Is the dev server running?` };
  }
}
