import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Regenerate Engine/editor/rpgGlyphs.ts from the installed rpg-awesome.
 *
 * Run with `node scripts/genRpgGlyphs.ts` — Node strips the types itself, so
 * there is no build step between this file and running it.
 */

const css = readFileSync('node_modules/rpg-awesome/css/rpg-awesome.min.css', 'utf8');
const re = /\.ra-([a-z0-9-]+):before\{content:"(.)"\}/g;

const out: [string, string][] = [];
let m: RegExpExecArray | null;
while ((m = re.exec(css))) {
  const codePoint = m[2].codePointAt(0);
  if (codePoint === undefined) continue;
  out.push([m[1], codePoint.toString(16)]);
}
out.sort((a, b) => a[0].localeCompare(b[0]));

const header = `/**
 * RPG Awesome's glyph table: ${out.length} fantasy and game icons, name to codepoint.
 *
 * Generated from node_modules/rpg-awesome/css/rpg-awesome.min.css by
 * scripts/genRpgGlyphs.ts. Bumping the package means regenerating it — the
 * codepoints are private-use and are not stable across major versions.
 *
 * The whole set is declared rather than the handful the editor happens to use:
 * the point is that an author can pick any of them, so there is no "used"
 * subset to know in advance.
 *
 * Typed as a plain lookup rather than \`as const\`: five hundred literal keys
 * would be five hundred types for the checker to carry, and every reader here
 * asks with a name it was given rather than one it wrote down.
 *
 * RPG Awesome is CC BY 3.0 (Daniela Howe, Ivan Montiel); the glyphs derive from
 * game-icons.net.
 */

export const RPG_GLYPHS: Record<string, string> = {
`;

const body = out.map(([name, code]) => `  '${name}': '${code}',`).join('\n');
writeFileSync('Engine/editor/rpgGlyphs.ts', `${header}${body}\n};\n`, 'utf8');
console.log('wrote', out.length, 'glyphs');
