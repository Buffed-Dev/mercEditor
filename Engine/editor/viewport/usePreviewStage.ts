import { useEffect, useRef, useState } from 'react';
import { createPreviewStage } from '../previewStage.ts';

export type Preview = {
  /** How wide a view it opens on, in world units. */
  frustum: number;
  mount: (scene: unknown) => void;
  unmount: () => void;
};

/**
 * A canvas of one's own for a record being looked at.
 *
 * A second engine rather than a corner of the map's. The previews used to
 * borrow the one scene, which meant hiding the map to look at a crate and
 * pointing the camera back afterwards — a whole dance to answer "what does this
 * look like". Two canvases is a graphics device the browser was always willing
 * to give.
 *
 * `preview` must be stable across renders, or the stage is torn down and built
 * again on every keystroke. Build it with `useMemo`.
 */
export function usePreviewStage(preview: Preview | null) {
  const host = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = host.current;
    if (!preview || !canvas) return;

    const stage = createPreviewStage({
      frustum: preview.frustum,
      onMount: (scene: unknown) => {
        preview.mount(scene);
        setReady(true);
      },
      onUnmount: () => {
        setReady(false);
        preview.unmount();
      },
    });

    stage.mount(canvas);
    // Give the device back. A browser has only so many of them.
    return () => stage.unmount();
  }, [preview]);

  return { host, ready };
}
