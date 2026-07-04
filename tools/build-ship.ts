/**
 * Assemble the official SYFY Rocinante v2.0 print sections (CC-BY 3.0,
 * thingiverse.com/thing:2060060) into one indexed mesh for the app.
 *
 * The zip ships four print-plate STLs (Front/Mid/Back/Booster), each resting
 * on z=0. We stack them Booster -> Back -> Mid -> Front, aligning each joint
 * by the XY centroid of the mating faces, weld duplicate vertices, center
 * the hull, and normalize the length to 3.0 units with the nose at +Z
 * (the ship-visual convention). Output: public/models/rocinante.fnm (FNM1,
 * same layout as the Eros pack).
 *
 * Usage: tsx tools/build-ship.ts <dir-with-stls>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "models", "rocinante.fnm");

const SECTIONS = [
  "Rocinante_Booster_11.4in_01.stl",
  "Rocinante_Back_11.4in_02.stl",
  "Rocinante_Mid_11.4in_02.stl",
  "Rocinante_Front_11.4in_02.stl",
];
/** joint mating-face slice thickness, mm */
const SLICE = 2.0;
/** section overlap at each joint, mm (peg sockets mate flush-ish) */
const OVERLAP = 1.0;

interface Mesh {
  verts: Float64Array; // xyz triplets, one per triangle corner (unindexed)
  tris: number;
}

function parseStl(path: string): Mesh {
  const buf = readFileSync(path);
  const n = buf.readUInt32LE(80);
  const verts = new Float64Array(n * 9);
  for (let i = 0; i < n; i++) {
    const off = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) verts[i * 9 + k] = buf.readFloatLE(off + k * 4);
  }
  return { verts, tris: n };
}

function bounds(m: Mesh) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.verts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = m.verts[i + k];
      if (x < mn[k]) mn[k] = x;
      if (x > mx[k]) mx[k] = x;
    }
  }
  return { mn, mx };
}

/** XY centroid of vertices within `SLICE` of the given z plane. */
function sliceCentroid(m: Mesh, z: number): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i < m.verts.length; i += 3) {
    if (Math.abs(m.verts[i + 2] - z) < SLICE) {
      sx += m.verts[i];
      sy += m.verts[i + 1];
      n++;
    }
  }
  if (n === 0) return { x: 0, y: 0 };
  return { x: sx / n, y: sy / n };
}

function translate(m: Mesh, dx: number, dy: number, dz: number) {
  for (let i = 0; i < m.verts.length; i += 3) {
    m.verts[i] += dx;
    m.verts[i + 1] += dy;
    m.verts[i + 2] += dz;
  }
}

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: tsx tools/build-ship.ts <dir-with-stls>");

  const parts = SECTIONS.map((f) => parseStl(join(dir, f)));
  console.log("parsed", parts.map((p) => p.tris), "tris");

  // Stack: part[0] stays; each next part's bottom joint face aligns to the
  // previous part's top face centroid, z flush minus overlap.
  let zTop = bounds(parts[0]).mx[2];
  let below = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const b = bounds(part);
    const topC = sliceCentroid(below, zTop);
    const botC = sliceCentroid(part, b.mn[2]);
    translate(part, topC.x - botC.x, topC.y - botC.y, zTop - b.mn[2] - OVERLAP);
    zTop = bounds(part).mx[2];
    below = part;
  }

  // Merge + weld. The grid doubles as vertex-cluster decimation: the ship
  // renders at tens of pixels, so a 0.6 mm cluster on a 316 mm model is
  // invisible and cuts the file ~5x.
  const weldMm = Number(process.argv[3] ?? 0.6);
  const Q = 1 / weldMm;
  const index = new Map<string, number>();
  const outVerts: number[] = [];
  const outIdx: number[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.verts.length; i += 3) {
      const x = part.verts[i];
      const y = part.verts[i + 1];
      const z = part.verts[i + 2];
      const key = `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
      let vi = index.get(key);
      if (vi === undefined) {
        vi = outVerts.length / 3;
        index.set(key, vi);
        outVerts.push(x, y, z);
      }
      outIdx.push(vi);
    }
  }
  // drop degenerate tris created by welding
  const finalIdx: number[] = [];
  for (let i = 0; i < outIdx.length; i += 3) {
    const [a, b, c] = [outIdx[i], outIdx[i + 1], outIdx[i + 2]];
    if (a !== b && b !== c && a !== c) finalIdx.push(a, b, c);
  }
  console.log(
    `welded: ${outVerts.length / 3} verts, ${finalIdx.length / 3} tris (from ${outIdx.length / 3})`
  );

  // Center XY on the spine, center Z, normalize length to 3.0, nose at +Z.
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < outVerts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (outVerts[i + k] < mn[k]) mn[k] = outVerts[i + k];
      if (outVerts[i + k] > mx[k]) mx[k] = outVerts[i + k];
    }
  }
  const cx = (mn[0] + mx[0]) / 2;
  const cy = (mn[1] + mx[1]) / 2;
  const cz = (mn[2] + mx[2]) / 2;
  const scale = 3.0 / (mx[2] - mn[2]);
  const packed = new Float32Array(outVerts.length);
  for (let i = 0; i < outVerts.length; i += 3) {
    packed[i] = (outVerts[i] - cx) * scale;
    packed[i + 1] = (outVerts[i + 1] - cy) * scale;
    packed[i + 2] = (outVerts[i + 2] - cz) * scale;
  }

  const v = packed.length / 3;
  const t = finalIdx.length / 3;
  const buf = new ArrayBuffer(12 + packed.length * 4 + finalIdx.length * 4);
  const view = new DataView(buf);
  view.setUint8(0, 0x46);
  view.setUint8(1, 0x4e);
  view.setUint8(2, 0x4d);
  view.setUint8(3, 0x31);
  view.setUint32(4, v, true);
  view.setUint32(8, t, true);
  new Float32Array(buf, 12, packed.length).set(packed);
  new Uint32Array(buf, 12 + packed.length * 4, finalIdx.length).set(finalIdx);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(buf));
  console.log(`wrote ${OUT} (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

main();
