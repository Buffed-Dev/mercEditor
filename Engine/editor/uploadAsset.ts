import { ASSET_EXTENSIONS, assetRewritten } from '../src/data/assets.ts';

/**
 * Which kind a file is, by its extension.
 *
 * Re-exported rather than written again: `data/assets` already answers this
 * for the game, and two copies of the same rule are two things to keep in step
 * the next time a format is added.
 */
export { kindOfFile } from '../src/data/assets.ts';

/**
 * Getting a file into a game folder.
 *
 * The file goes into the folder of whatever will name it —
 * `Games/<game>/assets/Materials/Grass/`, say — and the record there names it
 * by filename alone. A model is not something a rules file can hold, and the
 * effects editor proved what happens when you try: a megabyte of base64 for
 * pictures a hundred pixels across.
 *
 * Lifted out of the old assets mode so both editors write files the same way.
 */

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('That file did not read back as text'));
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
export function safeFileName(name = ''): string {
  const dot = name.lastIndexOf('.');
  const ext = (dot > 0 ? name.slice(dot + 1) : '').toLowerCase();
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9 _-]/g, '_').slice(0, 63);
  const safe = /^[A-Za-z0-9]/.test(stem) ? stem : `asset ${stem}`.trim();
  return ASSET_EXTENSIONS.includes(ext) ? `${safe}.${ext}` : '';
}

/** What a file's extension says it is. There is nothing to ask about a .glb. */
/** The name without its extension, which is what the record is called. */
export const stemOf = (name: string): string => name.replace(/\.[^.]+$/, '');

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
/**
 * What storing a file gave back: the name it was stored under, or why not.
 *
 * Two shapes rather than one with both optional, because the caller already
 * asks `'error' in result` -- and only a union makes that question settle what
 * the other half holds.
 */
export type UploadResult = { name: string } | { error: string };

export async function uploadAsset(
  game: string,
  file: File,
  folder = '',
): Promise<UploadResult> {
  const name = safeFileName(file.name);
  if (!name) return { error: `${file.name} is not a kind of file this can use` };
  const path = folder ? `${folder}/${name}` : name;

  try {
    const response = await fetch('/__assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, path, data: await readFile(file) }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) return { error: body.error ?? `Could not store ${file.name}` };
    // Keyed by the path, which is what the caches downstream are keyed by: two
    // folders may each hold a `base_color.png` and they are different pictures.
    assetRewritten(path);
    return { name };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { error: `Could not store ${file.name}: ${why}. Is the dev server running?` };
  }
}
