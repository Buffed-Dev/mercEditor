import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

/**
 * Every relative import specifier points at a file that exists.
 *
 * This exists because nothing else in the gate can prove it. When a module is
 * renamed from `.js` to `.ts`, an importer left saying `'./x.js'` is a hard
 * failure in Node — type stripping deliberately refuses to rewrite the
 * extension — but *both* `tsc` and Vite resolve it anyway, silently: tsc maps
 * the specifier to its source, and Vite's resolver tries the TypeScript
 * outputs of any `.js` path unconditionally. So `npm run typecheck` stays
 * green, `npm run build` stays green, and the break only surfaces when Node
 * loads that module. Directories with no tests of their own — `render/`,
 * `gui/` — could sit broken indefinitely.
 *
 * A `.js` specifier is therefore checked as `.js` and never allowed to fall
 * back to a `.ts` file. That refusal is the entire point: matching Node, not
 * the bundler, is what makes this catch the mistake the other tools hide.
 */

const ROOT = resolve(import.meta.dirname, '..');
const ROOTS = ['Engine/src', 'Engine/editor', 'test'];
const SOURCE = /\.(js|jsx|ts|tsx)$/;

// Extensionless imports are legal for modules only Vite ever loads (the React
// editor UI), so they resolve the way a bundler would. Anything Node loads
// carries its extension and is checked literally.
const GUESSES = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(entry)) out.push(path);
  }
  return out;
};

// `from '…'`, `import '…'`, `export … from '…'` and dynamic `import('…')`.
// The dynamic form matters: test/crafting.test.js reaches game/items that way,
// and a `from`-only regex would miss it.
const SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

test('every relative import specifier resolves to a file on disk', () => {
  const broken = [];
  let checked = 0;

  for (const root of ROOTS) {
    for (const file of walk(resolve(ROOT, root))) {
      const source = readFileSync(file, 'utf8');
      for (const [, spec] of source.matchAll(SPECIFIER)) {
        if (!spec.startsWith('.')) continue;
        checked++;
        const target = resolve(dirname(file), spec);
        if (existsSync(target) && statSync(target).isFile()) continue;
        if (!SOURCE.test(spec) && GUESSES.some((ext) => existsSync(target + ext))) continue;
        broken.push(`${relative(ROOT, file)} -> ${spec}`);
      }
    }
  }

  assert.ok(checked > 200, `expected to check many specifiers, checked ${checked}`);
  assert.deepEqual(broken, [], `${broken.length} import(s) point at nothing:\n  ${broken.join('\n  ')}`);
});
