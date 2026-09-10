/**
 * Move a game's library out of rules/*.js and into the assets folder, one
 * record per folder.
 *
 *   node scripts/migrateLibrary.mjs Merc --dry
 *   node scripts/migrateLibrary.mjs Merc
 *
 * A material used to be a row in rules/materials.js naming two asset records,
 * which named two files in a flat assets/ folder. Three places to look and
 * three to keep in step, and they had already drifted: thirty-three files,
 * fourteen records, nineteen files nothing pointed at. Afterwards a material is
 * `assets/Materials/Wood/`, holding `material.json` beside the pictures it
 * names — one place, and copying the folder copies the material.
 *
 * Run it once, on a clean tree. Git is the backup; this writes no .bak files
 * and makes no attempt to be undoable. `--dry` prints what it would do, checks
 * that every reference it is about to write resolves to a file it is about to
 * place, and touches nothing.
 *
 * Only Games/<game>/ is rewritten here. The Engine-side changes that make the
 * new layout the one being read are an ordinary commit, not something a script
 * should be doing behind your back.
 */

import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , GAME = 'Merc', ...flags] = process.argv;
const DRY = flags.includes('--dry');

const root = process.cwd();
const gameDir = resolve(root, 'Games', GAME);
const assetsDir = resolve(gameDir, 'assets');
const rulesDir = resolve(gameDir, 'rules');

/** The folders a game's library is arranged in. */
const TOP = {
  materials: 'Materials',
  props: 'Objects',
  vfx: 'Effects',
  terrains: 'Terrain',
  prefabs: 'Prefabs',
};

/** Which file a record of each kind is written to. */
const RECORD_FILE = {
  materials: 'material.json',
  props: 'object.json',
  terrains: 'terrain.json',
  vfx: 'effect.json',
  prefabs: 'prefab.json',
};

/** `grass-sand corner` → `GrassSandCorner`: a label as a folder name. */
const folderName = (label, fallback) => {
  const name = String(label ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
  return /^[A-Za-z0-9]/.test(name) ? name : folderName(fallback, 'Record');
};

// ------------------------------------------------------------------ the plan
//
// Nothing is written until every step has been worked out and checked, so that
// --dry and the real run are the same walk and the second cannot discover a
// problem the first was quiet about.

const plan = { moves: [], copies: [], writes: [], deletes: [], notes: [], problems: [] };
const taken = new Map(); // folder path -> what claimed it, so two records cannot collide

/** Claim a folder for one record, or complain if something already has it. */
function claim(top, label, fallback, what) {
  let name = folderName(label, fallback);
  const path = `${top}/${name}`;
  const already = taken.get(path.toLowerCase());
  if (already) {
    plan.problems.push(`${what} and ${already} both want ${path}`);
    return null;
  }
  taken.set(path.toLowerCase(), what);
  return path;
}

async function main() {
  const files = await readdir(assetsDir).catch(() => []);
  // Windows is case-insensitive and the records drifted from the filesystem
  // years ago: rules/assets.js says `block-corner.glb`, the disk says
  // `Block-corner.glb`, and only the case-blind lookup the engine already
  // carries has been holding those together. Resolve through the same rule.
  const onDisk = new Map(files.map((name) => [name.toLowerCase(), name]));
  const claimed = new Set(); // real filenames this migration accounts for

  const rules = {};
  for (const kind of ['assets', 'materials', 'terrains', 'props', 'vfx']) {
    const file = resolve(rulesDir, `${kind}.js`);
    const module = await import(pathToFileURL(file).href);
    rules[kind] = Object.values(module)[0] ?? [];
  }

  /** The file an asset id names, as it is actually spelled on disk. */
  const assets = new Map(rules.assets.map((asset) => [asset.id, asset]));
  const fileOf = (assetId) => {
    if (!assetId) return null;
    const asset = assets.get(assetId);
    if (!asset) return { missing: `no asset record "${assetId}"` };
    const real = onDisk.get(String(asset.file ?? '').toLowerCase());
    if (!real) return { missing: `asset "${assetId}" names ${asset.file}, which is not there` };
    return { asset, name: real };
  };

  // ------------------------------------------------------------- materials
  //
  // The asset record's own tiling settings fold into the material here. They
  // were always the same four numbers said twice -- MATERIAL_FIELDS has
  // uScale/vScale/uOffset/vOffset and so did every texture asset -- and the
  // duplication is what this layout removes. The material's own value wins
  // unless it is sitting at the default and the asset's is not.
  for (const material of rules.materials) {
    const path = claim(TOP.materials, material.label, material.id, `material "${material.id}"`);
    if (!path) continue;

    const record = { ...material };
    for (const slot of ['texture', 'bump']) {
      const found = fileOf(material[slot]);
      if (!found) {
        record[slot] = '';
        continue;
      }
      if (found.missing) {
        plan.problems.push(`material "${material.id}": ${found.missing}`);
        continue;
      }
      record[slot] = found.name;
      moveInto(found.name, path, claimed);
      if (slot !== 'texture') continue;
      for (const key of ['uScale', 'vScale', 'uOffset', 'vOffset']) {
        const fallback = key.endsWith('Scale') ? 1 : 0;
        if (record[key] === fallback && found.asset[key] !== undefined) {
          record[key] = found.asset[key];
        }
      }
      if (found.asset.transparent && !record.transparent) record.transparent = true;
    }
    plan.writes.push([`${path}/${RECORD_FILE.materials}`, record]);
  }

  // ----------------------------------------------------------------- objects
  //
  // rules/props.js is empty, so every mesh asset becomes the object it was
  // always going to have to become before anything could be placed. Its scale,
  // turn and lift come across; PROP_FIELDS has no rotX or rotZ, so a mesh
  // leaning on either of those is called out rather than quietly straightened.
  for (const asset of rules.assets) {
    if (asset.kind !== 'mesh') continue;
    const real = onDisk.get(String(asset.file ?? '').toLowerCase());
    if (!real) {
      plan.problems.push(`mesh "${asset.id}" names ${asset.file}, which is not there`);
      continue;
    }
    const path = claim(TOP.props, asset.label, asset.id, `mesh "${asset.id}"`);
    if (!path) continue;
    if (asset.rotX || asset.rotZ) {
      plan.notes.push(
        `object "${asset.id}" had rotX ${asset.rotX ?? 0} / rotZ ${asset.rotZ ?? 0}; an object turns about Y only, so those are dropped`,
      );
    }
    moveInto(real, path, claimed);
    plan.writes.push([
      `${path}/${RECORD_FILE.props}`,
      {
        id: asset.id,
        label: asset.label ?? asset.id,
        mesh: real,
        material: '',
        texture: '',
        sheet: '',
        billboard: true,
        tint: 0xffffff,
        scale: asset.scale ?? 1,
        rotY: asset.rotY ?? 0,
        lift: asset.lift ?? 0,
        blocks: false,
        top: 0,
        shadow: true,
      },
    ]);
  }

  // ---------------------------------------------------------------- terrains
  // Material ids untouched: a terrain names materials, and an id is still an id.
  for (const terrain of rules.terrains) {
    const path = claim(TOP.terrains, terrain.label, terrain.id, `terrain "${terrain.id}"`);
    if (path) plan.writes.push([`${path}/${RECORD_FILE.terrains}`, { ...terrain }]);
  }

  // ----------------------------------------------------------------- effects
  //
  // The whole reason this file is 1.1 MB: one sprite sheet, 838 KB of it, as a
  // base64 data URL inside a JavaScript array. Written out as the .png it
  // always was, it becomes a file you can open in an image editor and a record
  // you can read in a diff.
  for (const effect of rules.vfx) {
    const path = claim(TOP.vfx, effect.label, effect.id, `effect "${effect.id}"`);
    if (!path) continue;
    const record = { ...effect };
    for (const [slot, name] of [
      ['particle', 'particle.png'],
      ['sheet', 'sheet.png'],
    ]) {
      const part = record[slot];
      const image = part?.image;
      if (typeof image !== 'string' || !image.startsWith('data:')) continue;
      const comma = image.indexOf(',');
      const bytes = Buffer.from(image.slice(comma + 1), 'base64');
      if (!bytes.length) {
        plan.problems.push(`effect "${effect.id}" ${slot} image is empty`);
        continue;
      }
      record[slot] = { ...part, image: name };
      plan.writes.push([`${path}/${name}`, bytes]);
      plan.notes.push(
        `effect "${effect.id}" ${slot}: ${(image.length / 1024).toFixed(0)} KB of base64 → ${name} (${(bytes.length / 1024).toFixed(0)} KB)`,
      );
    }
    plan.writes.push([`${path}/${RECORD_FILE.vfx}`, record]);
  }

  // ---------------------------------------------------------------- leftovers
  for (const name of files) {
    if (name.startsWith('.') || claimed.has(name)) continue;
    const asset = rules.assets.find(
      (entry) => String(entry.file ?? '').toLowerCase() === name.toLowerCase(),
    );
    if (asset) {
      // A file with a record that nothing consumes. Not a test leftover, so it
      // stays where it is and shows in the browser as unimported -- which is
      // the whole point of that badge.
      plan.notes.push(`${name} has a record ("${asset.id}") but no material or object uses it; left at the root, unimported`);
      continue;
    }
    plan.deletes.push(name);
  }

  // The five folders a game's library is arranged in, whether or not this
  // migration had anything to put in them.
  for (const top of Object.values(TOP)) plan.writes.push([`${top}/.gitkeep`, Buffer.alloc(0)]);

  // Every reference about to be written must resolve to a file about to be
  // placed. This is the check that fails loudly if the id-to-path mapping is
  // wrong, and it is why --dry is worth running first.
  const landing = new Set(plan.moves.concat(plan.copies).map(([, to]) => to));
  for (const [where, body] of plan.writes) if (Buffer.isBuffer(body)) landing.add(where);
  for (const [where, body] of plan.writes) {
    if (Buffer.isBuffer(body)) continue;
    const folder = where.slice(0, where.lastIndexOf('/'));
    for (const key of ['texture', 'bump', 'mesh']) {
      const named = body[key];
      if (!named) continue;
      if (!landing.has(`${folder}/${named}`)) {
        plan.problems.push(`${where} names ${key} "${named}", which nothing puts in ${folder}`);
      }
    }
    for (const slot of ['particle', 'sheet']) {
      const named = body[slot]?.image;
      if (!named || named.startsWith('data:')) continue;
      if (!landing.has(`${folder}/${named}`)) {
        plan.problems.push(`${where} names ${slot} image "${named}", which nothing puts in ${folder}`);
      }
    }
  }

  report();
  if (plan.problems.length) {
    console.error('\nRefusing to write: fix the above first.');
    process.exit(1);
  }
  if (DRY) {
    console.log('\n--dry: nothing was written.');
    return;
  }
  await apply();
  console.log('\nDone. rules/{assets,materials,terrains,props,vfx}.js are gone;');
  console.log('the library is in assets/ and library/*.js finds it.');
}

/** Move a file into a record's folder, or copy it if something already claimed it. */
function moveInto(name, folder, claimed) {
  const to = `${folder}/${name}`;
  if (claimed.has(name)) {
    // Two records made of the same picture. Copied rather than moved, because
    // a folder that is missing half of what it names is not a folder you can
    // hand to somebody.
    plan.copies.push([name, to]);
    plan.notes.push(`${name} is used twice; copied into ${folder} rather than moved`);
    return;
  }
  claimed.add(name);
  plan.moves.push([name, to]);
}

function report() {
  const say = (label, rows) => {
    if (!rows.length) return;
    console.log(`\n${label} (${rows.length})`);
    for (const row of rows) console.log(`  ${row}`);
  };
  say('move', plan.moves.map(([from, to]) => `${from} → ${to}`));
  say('copy', plan.copies.map(([from, to]) => `${from} → ${to}`));
  say(
    'write',
    plan.writes
      .filter(([where]) => !where.endsWith('.gitkeep'))
      .map(([where, body]) => (Buffer.isBuffer(body) ? `${where} (${(body.length / 1024).toFixed(0)} KB)` : where)),
  );
  say('delete', plan.deletes);
  say('note', plan.notes);
  say('PROBLEM', plan.problems);
}

async function apply() {
  for (const top of Object.values(TOP)) await mkdir(resolve(assetsDir, top), { recursive: true });
  for (const [where] of plan.writes) {
    await mkdir(resolve(assetsDir, where, '..'), { recursive: true });
  }
  for (const [from, to] of plan.moves) {
    await rename(resolve(assetsDir, from), resolve(assetsDir, to));
  }
  for (const [from, to] of plan.copies) {
    await copyFile(resolve(assetsDir, from), resolve(assetsDir, to));
  }
  for (const [where, body] of plan.writes) {
    await writeFile(
      resolve(assetsDir, where),
      Buffer.isBuffer(body) ? body : `${JSON.stringify(body, null, 2)}\n`,
    );
  }
  for (const name of plan.deletes) await rm(resolve(assetsDir, name), { force: true });
  for (const kind of ['assets', 'materials', 'terrains', 'props', 'vfx']) {
    await rm(resolve(rulesDir, `${kind}.js`), { force: true });
  }
}

await stat(assetsDir).catch(() => {
  console.error(`No assets folder at ${assetsDir}`);
  process.exit(1);
});
await main();
