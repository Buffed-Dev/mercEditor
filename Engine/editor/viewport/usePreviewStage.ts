import type { Scene } from '@babylonjs/core/scene.js';
import { useEffect, useRef, useState } from 'react';
import { createPreviewStage, type PreviewStage } from '../previewStage.ts';

export type Preview = {
  /** How wide a view it opens on, in world units. */
  frustum: number;
  mount: (scene: Scene) => void;
  unmount: () => void;
};

/**
 * A canvas of one's own for an asset being looked at: a second engine rather
 * than a corner of the map's.
 *
 * `preview` must be stable across renders, or the stage is torn down and built
 * again on every keystroke. Build it with `useMemo`.
 */
export function usePreviewStage(preview: Preview | null) {
  const host = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<PreviewStage | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = host.current;
    if (!preview || !canvas) return;

    const stage = createPreviewStage({
      frustum: preview.frustum,
      onMount: (scene) => {
        preview.mount(scene);
        setReady(true);
      },
      onUnmount: () => {
        setReady(false);
        preview.unmount();
      },
    });

    stage.mount(canvas);
    stageRef.current = stage;
    // Give the device back. A browser has only so many of them.
    return () => {
      stageRef.current = null;
      stage.unmount();
    };
  }, [preview]);

  const orbit = (dx: number, dy: number) => stageRef.current?.orbit(dx, dy);

  return { host, ready, orbit };
}
