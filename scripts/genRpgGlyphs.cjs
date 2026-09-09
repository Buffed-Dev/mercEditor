const fs = require('fs');
const css = fs.readFileSync('node_modules/rpg-awesome/css/rpg-awesome.min.css', 'utf8');
const re = /\.ra-([a-z0-9-]+):before\{content:"(.)"\}/g;
let m;
const out = [];
while ((m = re.exec(css))) out.push([m[1], m[2].codePointAt(0).toString(16)]);
out.sort((a, b) => a[0].localeCompare(b[0]));

const header = `/**
 * RPG Awesome's glyph table: 494 fantasy and game icons, name to codepoint.
 *
 * Generated from node_modules/rpg-awesome/css/rpg-awesome.min.css by
 * scripts/genRpgGlyphs.cjs. Bumping the package means regenerating it — the
 * codepoints are private-use and are not stable across major versions.
 *
 * The whole set is declared rather than the handful the editor happens to use,
 * the way ./icons.js does: here the point is that an author can pick any of
 * them, so there is no "used" subset to know in advance.
 *
 * RPG Awesome is CC BY 3.0 (Daniela Howe, Ivan Montiel); the glyphs derive from
 * game-icons.net.
 */

export const RPG_GLYPHS = {
`;

const body = out.map(([name, code]) => `  '${name}': '${code}',`).join('\n');
fs.writeFileSync('Engine/editor/rpgGlyphs.js', `${header}${body}\n};\n`);
console.log('wrote', out.length, 'glyphs');
