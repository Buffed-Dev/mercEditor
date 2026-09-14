import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/**
 * The shape of the codebase, asserted: no cycles, and the layers only point
 * one way.
 *
 * Both are invariants nothing else can catch. A cycle is not a type error and
 * not a test failure — it is a module that reads `undefined` off a half-built
 * import at exactly the wrong moment, months later, under a bundler that
 * happened to order things differently. A layer violation is worse than that
 * because it never fails at all: it just quietly makes the headless half of
 * the engine need a browser, or the game need the editor, and by the time
 * anyone notices, a hundred imports have followed the first one through.
 *
 * The rules below are the ones the code already keeps. This is what stops the
 * next import from being the one that stops keeping them.
 */

const ROOT = resolve(import.meta.dirname, '..');
const ROOTS = ['Engine/src', 'Engine/editor'];
const SOURCE = /\.(js|jsx|ts|tsx)$/;

// Extensionless imports are legal for modules only Vite loads; see
// specifiers.test.js, which is what checks that a specifier resolves at all.
const GUESSES = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

/** `from '…'`, `import '…'`, `export … from '…'` and dynamic `import('…')`. */
const SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(entry)) out.push(path);
  }
  return out;
}

/** Every local module, and the local modules it imports. */
function importGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const root of ROOTS) {
    for (const file of walk(resolve(ROOT, root))) {
      const from = relative(ROOT, file);
      const into: string[] = [];
      for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        const spec = match[1];
        // A package is somebody else's graph.
        if (!spec?.startsWith('.')) continue;
        const target = resolve(dirname(file), spec);
        const found = existsSync(target)
          ? target
          : GUESSES.map((ext) => target + ext).find((path) => existsSync(path));
        // A specifier that points at nothing is specifiers.test.js's failure
        // to report, not this one's.
        if (found) into.push(relative(ROOT, found));
      }
      graph.set(from, into);
    }
  }
  return graph;
}

/**
 * The first cycle reachable from `start`, as the path round it.
 *
 * Type-only imports are erased before anything runs, so a cycle made only of
 * them cannot break at runtime — but it is still two modules that cannot be
 * read, moved or understood apart, which is the thing worth refusing. They
 * count.
 */
function cycleFrom(graph: Map<string, string[]>, start: string): string[] | null {
  const path: string[] = [];
  const onPath = new Set<string>();
  const done = new Set<string>();

  const visit = (node: string): string[] | null => {
    if (onPath.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (done.has(node)) return null;
    path.push(node);
    onPath.add(node);
    for (const next of graph.get(node) ?? []) {
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    onPath.delete(node);
    done.add(node);
    return null;
  };

  return visit(start);
}

test('no module imports itself, however far round', () => {
  const graph = importGraph();
  assert.ok(graph.size > 150, `expected the whole tree, walked ${graph.size} files`);

  for (const file of graph.keys()) {
    const cycle = cycleFrom(graph, file);
    assert.equal(cycle, null, cycle ? `import cycle:\n  ${cycle.join('\n  → ')}` : '');
  }
});

/**
 * Which layer a file is in, and what that layer is allowed to reach.
 *
 * Read down: each layer may import itself and anything below it, and nothing
 * above. The order is the dependency graph, written once.
 *
 *   editor/    the map and rules editor — a separate program, a separate page
 *   src/       main.ts, which wires the rest together
 *   gui/       the in-game HUD, drawn over the scene with Babylon GUI
 *   render/    Babylon: meshes, materials, the scene itself
 *   ui/        the DOM interface — the character sheet, the bag, the cursor
 *   game/      the rules as they run: actors, abilities, inventory, crafting
 *   data/      what a map and a rules file say. The vocabulary everything shares
 *   util/      errors and logging. Depends on nothing, so anything may use it
 *
 * The two that matter most are the ends. `data/` at the bottom is what lets
 * the editor and the game agree about a map without either owning the other.
 * `game/` above it and below the renderer is what keeps the rules headless —
 * every test of an ability, a bag or a recipe runs without a browser because
 * of this line, and one import of `render/` from `game/` ends that.
 */
const LAYERS = [
  'Engine/editor',
  'Engine/src',
  'Engine/src/gui',
  'Engine/src/render',
  'Engine/src/ui',
  'Engine/src/game',
  'Engine/src/data',
  'Engine/src/util',
] as const;

/** The most specific layer a file is in. `Engine/src` is the catch-all. */
const layerOf = (file: string): string =>
  LAYERS.filter((layer) => file.startsWith(`${layer}/`)).sort((a, b) => b.length - a.length)[0] ??
  'Engine/src';

const rank = (layer: string) => LAYERS.indexOf(layer as (typeof LAYERS)[number]);

test('the layers only point one way', () => {
  const broken: string[] = [];
  for (const [file, into] of importGraph()) {
    const from = layerOf(file);
    for (const target of into) {
      const to = layerOf(target);
      // Downward or sideways is the whole point; upward is the violation.
      if (from === to || rank(to) > rank(from)) continue;
      broken.push(`${file} (${from}) -> ${target} (${to})`);
    }
  }
  assert.deepEqual(broken, [], `${broken.length} import(s) point up the stack:\n  ${broken.join('\n  ')}`);
});
