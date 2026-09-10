import { useCallback, useEffect, useState } from 'react';
import type { LibraryScan } from '../rules/libraryTree.ts';

/**
 * What is actually in a game's assets folder, asked of the dev server.
 *
 * The document knows what records it holds; only the filesystem knows what is
 * on disk beside them. This is the second half, and it is a fetch rather than
 * something derived because a file somebody dropped in the folder by hand is a
 * thing the editor should see without being told.
 *
 * Re-read rather than patched after a change. A move, an upload or a delete
 * touches a folder the editor does not model — the whole point is that the disk
 * is the truth — so the cheap correct answer is to ask again, and the answer is
 * a few hundred rows.
 */
export function useLibrary(game: string) {
  const [scan, setScan] = useState<LibraryScan | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!game) return;
    try {
      const response = await fetch(`/__library?game=${encodeURIComponent(game)}`);
      const body = (await response.json()) as LibraryScan & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not read the library');
      setScan({ tree: body.tree ?? [], records: body.records ?? [], errors: body.errors ?? [] });
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
      setScan({ tree: [], records: [], errors: [] });
    }
  }, [game]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { scan, error, refresh };
}
