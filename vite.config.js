import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { mapIo } from './vite-plugin-map-io.js';

/**
 * Which game folder this server or build is for.
 *
 * `#game` is how the engine asks for its content, and this is the only place
 * that answers — so a second game is `GAME=other npm run dev`, not a second
 * copy of the engine. package.json's `imports` answers the same question for
 * plain Node, which is what lets the test run without Vite.
 */
const GAME = process.env.GAME || 'Merc';

export default defineConfig({
  // Dev-only: the editor reads and writes game folders through this. React is
  // the editor's interface and nothing else's — the game entry has no React in
  // it, and the build below only ever inputs the game.
  plugins: [react(), mapIo()],
  resolve: {
    // Two entries, because the specifier means two things: `#game` on its own
    // is the manifest, and `#game/…` is a file in the folder beside it. A
    // single prefix alias would rewrite the second into a path through the
    // first. package.json's `imports` says the same in Node's own spelling.
    alias: [
      { find: /^#game$/, replacement: resolve(import.meta.dirname, `Games/${GAME}/game.js`) },
      { find: /^#game\//, replacement: resolve(import.meta.dirname, `Games/${GAME}`) + '/' },
    ],
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    /*
     * The editor uploads models, textures and sprite sheets into
     * Games/<game>/assets/ through the dev server. Vite watches everything it
     * serves, so without this the upload lands, the watcher fires a full
     * reload, and the editor comes back from disk having thrown away the
     * unsaved work that the upload was part of — the asset record itself
     * included, which is why the file would be there and the asset would not.
     *
     * Only the binaries. The rules and maps beside them are real modules, and
     * a game page open in another tab should still pick them up when a save
     * rewrites them.
     */
    watch: { ignored: ['**/Games/*/assets/**'] },
  },
  build: {
    target: 'es2022',
    // The game, and only the game. The editor is a development tool that writes
    // files through the dev server; there is nothing for it to do in a
    // published build, and this is what keeps it out of one.
    rollupOptions: { input: resolve(import.meta.dirname, 'index.html') },
  },
});
