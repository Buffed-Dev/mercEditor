// Writes tiny test GLBs matching the edge-profile kit (inset 0.25, level 0.5).
const fs = require('fs');
const path = require('path');
const out = process.argv[2];

function glb(triangles) {
  const positions = new Float32Array(triangles.flat(2));
  const count = positions.length / 3;
  const indices = new Uint16Array([...Array(count).keys()]);
  const min = [0, 1, 2].map((a) => Math.min(...[...Array(count).keys()].map((i) => positions[i * 3 + a])));
  const max = [0, 1, 2].map((a) => Math.max(...[...Array(count).keys()].map((i) => positions[i * 3 + a])));
  const pad = (n) => (4 - (n % 4)) % 4;
  const posBytes = Buffer.from(positions.buffer);
  const idxBytes = Buffer.concat([Buffer.from(indices.buffer), Buffer.alloc(pad(indices.byteLength))]);
  const bin = Buffer.concat([posBytes, idxBytes]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'piece' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'side', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.6, 0.45, 0.3, 1] } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
      { buffer: 0, byteOffset: posBytes.length, byteLength: indices.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5123, count, type: 'SCALAR' },
    ],
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc(pad(text.length), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, bin)]);
}

// Whole-tile test pieces: a flat top with a soft slope falling one level over
// the outer quarter of the tile, in the edge-profile kit's canonical places.
const I = 0.25;
const H = 0.5;
/** A tile's surface as a height field y = h(x, z), triangulated on an 8x8 grid. */
function tile(h) {
  const n = 8;
  const at = (i) => -0.5 + i / n;
  const tris = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const p = (x, z) => [x, h(x, z), z];
      const a = p(at(i), at(j));
      const b = p(at(i), at(j + 1));
      const c = p(at(i + 1), at(j + 1));
      const d = p(at(i + 1), at(j));
      tris.push([a, b, c], [a, c, d]);
    }
  }
  return tris;
}
/** 0 inside, 1 at the tile edge, across the outer band. */
const fall = (t) => Math.min(1, Math.max(0, (t - (0.5 - I)) / I));
const east = (x) => fall(x);
const north = (z) => fall(-z);
// Edge: east side exposed.
const edge = tile((x) => -H * east(x));
// Outer corner: east and north exposed.
const outer = tile((x, z) => -H * Math.max(east(x), north(z)));
// Inner corner: only the north-east diagonal drops.
const inner = tile((x, z) => -H * Math.min(east(x), north(z)));
fs.writeFileSync(path.join(out, 'slope-edge.glb'), glb(edge));
fs.writeFileSync(path.join(out, 'slope-outer.glb'), glb(outer));
fs.writeFileSync(path.join(out, 'slope-inner.glb'), glb(inner));
console.log('written');
