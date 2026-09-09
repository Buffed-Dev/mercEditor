import { useEffect, useRef, useState } from 'react';
import { createRenderer } from '../../src/render/engine.ts';
import { createInput } from '../../src/ui/input.ts';
import { createEditor } from '../editor.ts';
import { say } from '../state/status';

export type Stage = {
  renderer: ReturnType<typeof createRenderer>;
  editor: ReturnType<typeof createEditor>;
  input: ReturnType<typeof createInput>;
};

/**
 * Babylon, mounted into a React tree and taken down again with it.
 *
 * The canvas is a child of the layout now rather than a fixed-position sibling
 * of the whole interface, so nothing computes its size: the grid cell it lives
 * in has a size, and the renderer already watches its host for changes. That is
 * what replaces the arithmetic on the bar and status-bar heights, and the class
 * on <html> that used to re-flow it when a panel folded away.
 *
 * React never renders a frame. Babylon owns the loop, the editor draws into it,
 * and this hook exists only to start the two and to stop them.
 *
 * @param content what the map view should be built from, asked for at the
 *   moment of a rebuild — these are the rules being edited, and a copy taken
 *   when the page loaded would be the rules as they were.
 */
export function useStage(
  host: React.RefObject<HTMLDivElement | null>,
  content: () => Record<string, unknown>,
): Stage | null {
  const [stage, setStage] = useState<Stage | null>(null);

  // Read through a ref so a new closure on every render does not tear the
  // renderer down and build it again.
  const latest = useRef(content);
  latest.current = content;

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const renderer = createRenderer(element);
    const input = createInput({ world: `#${element.id}` });
    const editor = createEditor({
      scene: renderer.scene,
      camera: renderer.camera,
      setFrustum: renderer.setFrustum,
      setAmbientOcclusion: renderer.setAmbientOcclusion,
      content: () => latest.current(),
    });

    renderer.run(
      (dt: number) => {
        editor.update(dt, input.keys);
        return true;
      },
      // A throw used to end the loop outright, leaving the window frozen on its
      // last picture with nothing on screen to say why. It is a failure, so it
      // goes where failures go.
      (error: unknown) => say(String((error as Error)?.message ?? error), 'error'),
    );

    setStage({ renderer, editor, input });

    return () => {
      setStage(null);
      editor.close();
      input.dispose();
      renderer.dispose();
    };
  }, [host]);

  return stage;
}
