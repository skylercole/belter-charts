/**
 * Generic STL -> .fnm packer for in-place model parts (no joint alignment;
 * use build-ship.ts for the Rocinante's stacked print sections).
 *
 * - merges the given STLs in their native coordinates
 * - welds on a grid (doubles as vertex-cluster decimation)
 * - rotates the longest axis onto Z (--swap xz|yz if needed is automatic),
 *   optional --flipz when the nose ends up at -Z
 * - centers, normalizes length to 3.0 units, writes FNM1
 *
 * Usage: tsx tools/build-model.ts --out <name> --weld <mm> [--flipz] <stl...>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models");

function parseStl(path: string): Float64Array {
  const buf = readFileSync(path);
  const n = buf.readUInt32LE(80);
  const verts = new Float64Array(n * 9);
  for (let i = 0; i < n; i++) {
    const off = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) verts[i * 9 + k] = buf.readFloatLE(off + k * 4);
  }
  return verts;
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = get("--out");
  const weld = Number(get("--weld") ?? 0.6);
  const flipz = args.includes("--flipz");
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out" && args[i - 1] !== "--weld");
  if (!out || files.length === 0) {
    throw new Error("usage: build-model --out <name> --weld <mm> [--flipz] <stl...>");
  }

  const parts = files.map(parseStl);
  const total = parts.reduce((a, p) => a + p.length, 0);
  const all = new Float64Array(total);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  console.log(`merged ${files.length} files, ${total / 9} tris`);

  // weld / cluster-decimate
  const Q = 1 / weld;
  const index = new Map<string, number>();
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < all.length; i += 3) {
    const x = all[i];
    const y = all[i + 1];
    const z = all[i + 2];
    const key = `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
    let vi = index.get(key);
    if (vi === undefined) {
      vi = verts.length / 3;
      index.set(key, vi);
      verts.push(x, y, z);
    }
    idx.push(vi);
  }
  const tris: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) {
      tris.push(idx[i], idx[i + 1], idx[i + 2]);
    }
  }
  console.log(`welded @${weld}mm: ${verts.length / 3} verts, ${tris.length / 3} tris`);

  // bounds, longest axis -> Z
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < verts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (verts[i + k] < mn[k]) mn[k] = verts[i + k];
      if (verts[i + k] > mx[k]) mx[k] = verts[i + k];
    }
  }
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const longest = size.indexOf(Math.max(...size));
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const scale = 3.0 / size[longest];
  const packed = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i += 3) {
    let p = [
      (verts[i] - c[0]) * scale,
      (verts[i + 1] - c[1]) * scale,
      (verts[i + 2] - c[2]) * scale,
    ];
    if (longest === 0) p = [p[2], p[1], -p[0]]; // x->z
    else if (longest === 1) p = [p[0], p[2], -p[1]]; // y->z
    if (flipz) p = [-p[0], p[1], -p[2]];
    packed[i] = p[0];
    packed[i + 1] = p[1];
    packed[i + 2] = p[2];
  }

  const V = packed.length / 3;
  const T = tris.length / 3;
  const buf = new ArrayBuffer(12 + V * 12 + T * 12);
  const view = new DataView(buf);
  view.setUint8(0, 0x46);
  view.setUint8(1, 0x4e);
  view.setUint8(2, 0x4d);
  view.setUint8(3, 0x31); // FNM1: absolute-ish units, no colors (material tints)
  view.setUint32(4, V, true);
  view.setUint32(8, T, true);
  new Float32Array(buf, 12, packed.length).set(packed);
  new Uint32Array(buf, 12 + packed.length * 4, tris.length).set(tris);
  writeFileSync(join(OUT_DIR, `${out}.fnm`), Buffer.from(buf));
  console.log(`wrote ${out}.fnm (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

main();
