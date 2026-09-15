import { useEffect, useState } from 'react';
import type { Scene } from '@babylonjs/core/scene.js';
import { fileUrl } from '../../src/data/assets.ts';
import type { MaterialInput } from '../../src/data/materials.ts';
import type { PropInput } from '../../src/data/props.ts';
import type { ProfileInput } from '../../src/data/profiles.ts';
import type { UrlOf } from '../../src/render/materials.ts';
import { createPreviewStage } from '../previewStage.ts';
import { createAssetPreview } from '../preview/assetPreview.ts';
import { createMaterialPreview } from '../preview/materialPreview.ts';
import { createVfxPreview } from '../preview/vfxPreview.ts';

/**
 * Thumbnails for every asset type, drawn offscreen and kept as PNGs.
 *
 * A browser hands out only so many graphics devices, so there is one small
 * stage per kind of preview, parked off-screen, and assets go through it one at
 * a time. Keyed on the record's contents, so an edit redraws its card.
 */

const SIZE = 128;

export type ThumbKind = 'material' | 'model' | 'block' | 'prefab' | 'effect' | 'profile';

export type ThumbContext = {
  game: string;
  materials: readonly MaterialInput[];
  props: readonly PropInput[];
  profiles?: readonly ProfileInput[];
};

type Painter = {
  canvas: HTMLCanvasElement;
  stage: ReturnType<typeof createPreviewStage>;
  scene: Scene | null;
  draw: (record: Record<string, unknown>, context: ThumbContext) => void;
};

const painters = new Map<string, Painter>();

const URL_OF = new Map<string, UrlOf>();
export const urlOfGame = (game: string): UrlOf => {
  const held = URL_OF.get(game) ?? ((path: string) => fileUrl(path, game));
  URL_OF.set(game, held);
  return held;
};

function painter(kind: ThumbKind, game: string): Painter {
  const family = kind === 'material' ? 'material' : kind === 'effect' ? 'effect' : 'asset';
  const held = painters.get(`${family}:${game}`);
  if (held) return held;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.style.cssText = `position:fixed;left:-9999px;top:0;width:${SIZE}px;height:${SIZE}px`;
  document.body.append(canvas);

  const made: Painter = { canvas, stage: null as never, scene: null, draw: () => {} };
  if (family === 'material') {
    const preview = createMaterialPreview();
    made.stage = createPreviewStage({ frustum: 1.9, loop: false, onMount: (scene) => { made.scene = scene; preview.mount(scene); } });
    made.draw = (record, context) => preview.draw(record, { shape: 'sphere', urlOf: urlOfGame(context.game) });
  } else if (family === 'effect') {
    const preview = createVfxPreview(game);
    made.stage = createPreviewStage({ frustum: preview.frustum, loop: false, onMount: (scene) => { made.scene = scene; preview.mount(scene); } });
    made.draw = (record) => preview.draw(record);
  } else {
    const preview = createAssetPreview();
    made.stage = createPreviewStage({ frustum: preview.frustum, loop: false, onMount: (scene) => { made.scene = scene; preview.mount(scene); } });
    made.draw = (record, context) =>
      preview.draw(record, {
        kind: kind === 'block' ? 'terrains' : kind === 'prefab' ? 'prefabs' : kind === 'profile' ? 'profiles' : 'props',
        materials: context.materials,
        props: context.props,
        profiles: context.profiles ?? [],
        game: context.game,
      });
  }
  made.stage.mount(canvas);
  painters.set(`${family}:${game}`, made);
  return made;
}

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function paint(key: string, kind: ThumbKind, record: Record<string, unknown>, context: ThumbContext): Promise<string> {
  const held = cache.get(key);
  if (held) return Promise.resolve(held);
  const already = pending.get(key);
  if (already) return already;

  const job = queue.then(async () => {
    try {
      const p = painter(kind, context.game);
      p.draw(record, context);
      // Models and textures load over the network, and an effect needs a
      // moment to have emitted anything worth a picture.
      await p.scene?.whenReadyAsync();
      await wait(kind === 'effect' ? 500 : 150);
      for (let i = 0; i < (kind === 'effect' ? 20 : 1); i += 1) p.stage.render();
      await p.scene?.whenReadyAsync();
      p.stage.render();
      const made = p.canvas.toDataURL('image/png');
      cache.set(key, made);
      return made;
    } catch {
      return '';
    } finally {
      pending.delete(key);
    }
  });
  queue = job;
  pending.set(key, job);
  return job;
}

/** The thumbnail for one asset, once drawn; '' until then. */
export function useThumb(kind: ThumbKind | null, record: Record<string, unknown> | null, context: ThumbContext): string {
  // Everything that can change the picture is in the key: the record, and for
  // anything wearing materials or placing models, those too.
  const key =
    kind && record
      ? `${kind}:${context.game}:${JSON.stringify(record)}${
          kind === 'material' || kind === 'effect' ? '' : JSON.stringify(context.materials)
        }${kind === 'prefab' ? JSON.stringify(context.props) : ''}${
          kind === 'block' || kind === 'profile' ? JSON.stringify(context.profiles ?? []) : ''
        }`
      : '';
  const [made, setMade] = useState(() => (key && cache.get(key)) || '');

  useEffect(() => {
    if (!key || !record || !kind) return setMade('');
    const held = cache.get(key);
    if (held) return setMade(held);
    let alive = true;
    void paint(key, kind, record, context).then((url) => {
      if (alive) setMade(url);
    });
    return () => {
      alive = false;
    };
    // `key` is built from record and context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return made;
}
