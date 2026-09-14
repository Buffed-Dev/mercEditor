import { useEffect, useState } from 'react';
import { createPreviewStage } from '../previewStage.ts';
import { createMaterialPreview } from './materialPreview.ts';
import type { MaterialInput } from '../../src/data/materials.ts';
import type { UrlOf } from '../../src/render/materials.ts';
import type { Scene } from '@babylonjs/core/scene.js';
import { fileUrl } from '../../src/data/assets.ts';

/**
 * How a file path becomes a url, one function per game.
 *
 * Kept rather than built per render because `useMaterialThumb` watches it: a
 * fresh function every render would be a fresh reason to redraw every sphere.
 */
const URL_OF = new Map<string, UrlOf>();
export const urlOfGame = (game: string): UrlOf => {
  const held = URL_OF.get(game) ?? ((path: string) => fileUrl(path, game));
  URL_OF.set(game, held);
  return held;
};

/**
 * A material's thumbnail: the material itself, on a sphere.
 *
 * The library used to show a material's colour map, which is honest about the
 * picture and says nothing about the material — a rough grey stone and a wet
 * black metal made from the same map are the same swatch. A sphere has every
 * angle of the light in it, so roughness, metal and the normal map are all
 * visible in one small circle, and it is the shape the detail view already
 * offers for the same reason.
 *
 * One stage for the whole panel, drawn once per material and kept. The obvious
 * build is a canvas per card, and it does not survive contact with a folder of
 * forty: `usePreviewStage`'s own comment says a browser hands out only so many
 * graphics devices, and past that the older cards silently go blank. So there
 * is one 128px canvas parked off-screen, materials go through it one at a time,
 * and what each card holds afterwards is a PNG.
 *
 * The stage is never taken down. It is built the first time a material is
 * asked for and outlives the panel, because coming back to the library is the
 * common case and a second teardown-and-rebuild costs more than the one device
 * it gives back.
 */

/** Big enough to read at any card size the panel can be dragged to. */
const SIZE = 128;

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

let canvas: HTMLCanvasElement | null = null;
let stage: ReturnType<typeof createPreviewStage> | null = null;
let preview: ReturnType<typeof createMaterialPreview> | null = null;
let scene: Scene | null = null;

/** The one stage, built on demand. */
function ensure(): void {
  if (stage) return;
  canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  // In the document but out of the way: Babylon sizes its buffer from the
  // canvas's laid-out size, and a canvas nobody has attached lays out at zero.
  canvas.style.cssText = `position:fixed;left:-9999px;top:0;width:${SIZE}px;height:${SIZE}px`;
  document.body.append(canvas);

  preview = createMaterialPreview();
  stage = createPreviewStage({
    // Tight to the sphere: this is one shape looked at straight on, not a
    // record standing in a room.
    frustum: 1.9,
    loop: false,
    onMount: (made) => {
      scene = made;
      preview?.mount(made);
    },
  });
  stage.mount(canvas);
}

/**
 * The picture for one material, drawn if it has not been drawn before.
 *
 * One at a time, chained: there is a single sphere and a single canvas, so two
 * materials drawn at once would be one material photographed twice.
 */
let queue: Promise<unknown> = Promise.resolve();

function draw(key: string, record: MaterialInput, urlOf: UrlOf): Promise<string> {
  const held = cache.get(key);
  if (held) return Promise.resolve(held);

  const already = pending.get(key);
  if (already) return already;

  const job = queue.then(async () => {
    ensure();
    preview?.draw(record, { shape: 'sphere', urlOf });
    // Textures load over the network. Drawn before they arrive, the picture is
    // of an untextured sphere -- and it would be cached as one.
    await scene?.whenReadyAsync();
    stage?.render();
    const made = canvas?.toDataURL('image/png') ?? '';
    cache.set(key, made);
    pending.delete(key);
    return made;
  });
  queue = job;
  pending.set(key, job);
  return job;
}

/**
 * What the material looks like, once it has been drawn.
 *
 * Empty until then, which the card shows as its glyph. Keyed on the record's
 * own contents rather than its id, so an edit redraws it and nothing has to
 * remember to say the picture is stale.
 */
export function useMaterialThumb(record: Record<string, unknown> | null, urlOf: UrlOf): string {
  const key = record ? JSON.stringify(record) : '';
  const [made, setMade] = useState(() => (key && cache.get(key)) || '');

  useEffect(() => {
    if (!key || !record) return setMade('');
    const held = cache.get(key);
    if (held) return setMade(held);

    let alive = true;
    void draw(key, record as unknown as MaterialInput, urlOf).then((url) => {
      if (alive) setMade(url);
    });
    return () => {
      alive = false;
    };
    // `record` is the object `key` was made from: keying the effect on both
    // would rerun it for a record edited into the same shape it already had.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, urlOf]);

  return made;
}
