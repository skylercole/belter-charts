/**
 * Assemble the Donnager from the single-print plate mesh (CC-BY 3.0,
 * thingiverse.com/thing:1249800, a plate remix of the SYFY Donnager v2.0).
 *
 * The plate STL is a print layout, not an assembled ship: packed verbatim
 * by build-model.ts it yields 19 disconnected components sitting in their
 * print positions. This tool splits the packed plate mesh into connected
 * components, identifies the parts by vertex count (stable for a fixed
 * input file), and re-poses them with a hand-tuned transform table into
 * the assembled ship: bow at +Z, four engine nacelles fanned at the
 * stern, twin dorsal railgun turrets — then welds, centers, normalizes
 * length to 3.0 (nose +Z, the ship-visual convention) and writes
 * public/models/donnager.fnm.
 *
 * Usage: tsx tools/assemble-donnager.ts [--in <plate.fnm>] [--out <fnm>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// the packed plate mesh is the only surviving form of the source STLs, so
// it is kept in the repo; the shipped model is derived from it
const DEFAULT_IN = join(ROOT, "tools", "raw", "donnager-plate.fnm");
const DEFAULT_OUT = join(ROOT, "public", "models", "donnager.fnm");

// ---------------------------------------------------------------- transforms

type Vec3 = [number, number, number];
/** rotation steps applied in order, each about a ship-frame axis, degrees */
type Rot = Array<["x" | "y" | "z", number]>;

interface Place {
  /** part id = rank by vertex count, descending (see inventory below) */
  part: number;
  rot: Rot;
  pos: Vec3;
  mirror?: "x"; // mirror in ship X after rotation (for paired parts)
}

/**
 * Part inventory of donnager-plate.fnm (rank by vertex count):
 *  0  ~9759 verts  2.05x1.25x1.24  forward hull, tapers to bow at +X
 *  1  ~6769 verts  2.46x1.00x1.01  mid/aft hull, drive cluster at -X
 *  2  ~5398 verts  0.69x1.25x1.24  stern plate, 4 diagonal pylon stubs
 *  3-6 ~4700 verts 1.84x0.92x0.92  engine nacelles (4 identical)
 *  7  ~2172 verts  1.44x0.49x0.38  dorsal superstructure / hangar spine
 *  8,9 ~750 verts  0.23x0.23x1.12  twin-barrel railgun turrets
 *  10  ~540 verts  0.27x0.32x0.26  joint peg (unused)
 * Anything smaller is print debris and is dropped.
 */
const MIN_PART_VERTS = 600;

// Ship frame: +Z = nose, +Y = dorsal. Hull parts have their long axis on
// local X; ["y", -90] maps local +X onto ship +Z.
const NACELLE_R = 0.95; // radial offset of nacelle centers from the spine
const PLACES: Place[] = [
  { part: 0, rot: [["y", -90]], pos: [0, 0, 1.45] }, // forward hull, bow +Z
  { part: 1, rot: [["y", -90], ["y", 180]], pos: [0, 0, -0.8] }, // mid/aft hull, drives aft
  { part: 2, rot: [["y", -90]], pos: [0, 0, -1.7] }, // stern plate
  // nacelles: part 3 cloned onto all four stern diagonals (the four print
  // copies are identical but sit at different yaws on the plate, so one
  // canonical part keeps the fan symmetric). At roll 0 the mounting pylon
  // points to 135 deg, so a nacelle at polar angle t rolls t+45.
  { part: 3, rot: [["y", -90], ["z", 90]], pos: polar(45, NACELLE_R, -2.0) },
  { part: 3, rot: [["y", -90], ["z", 180]], pos: polar(135, NACELLE_R, -2.0) },
  { part: 3, rot: [["y", -90], ["z", 270]], pos: polar(225, NACELLE_R, -2.0) },
  { part: 3, rot: [["y", -90]], pos: polar(315, NACELLE_R, -2.0) },
  // dorsal superstructure amidships
  { part: 7, rot: [["y", -90]], pos: [0, 0.55, 0.3] },
  // twin dorsal railgun turrets, barrels forward
  { part: 8, rot: [], pos: [-0.26, 0.66, 0.85] },
  { part: 9, rot: [], pos: [0.26, 0.66, 0.85] },
];

function polar(deg: number, r: number, z: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r, z];
}

function rotMat(rot: Rot): number[] {
  // 3x3 row-major, composed left-to-right (first step applied first)
  let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const [axis, deg] of rot) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let r: number[];
    if (axis === "x") r = [1, 0, 0, 0, c, -s, 0, s, c];
    else if (axis === "y") r = [c, 0, s, 0, 1, 0, -s, 0, c];
    else r = [c, -s, 0, s, c, 0, 0, 0, 1];
    const o = new Array(9).fill(0);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) o[i * 3 + j] += r[i * 3 + k] * m[k * 3 + j];
    m = o;
  }
  return m;
}

// ---------------------------------------------------------------- fnm i/o

function readFnm(path: string) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "FNM1") throw new Error(`${path}: bad magic`);
  const V = buf.readUInt32LE(4);
  const T = buf.readUInt32LE(8);
  const pos = new Float32Array(buf.buffer, buf.byteOffset + 12, V * 3);
  const tri = new Uint32Array(buf.buffer, buf.byteOffset + 12 + V * 12, T * 3);
  return { pos, tri, V, T };
}

function writeFnm(path: string, verts: Float32Array, tris: number[]) {
  const V = verts.length / 3;
  const T = tris.length / 3;
  const buf = new ArrayBuffer(12 + verts.length * 4 + tris.length * 4);
  const view = new DataView(buf);
  view.setUint8(0, 0x46);
  view.setUint8(1, 0x4e);
  view.setUint8(2, 0x4d);
  view.setUint8(3, 0x31);
  view.setUint32(4, V, true);
  view.setUint32(8, T, true);
  new Float32Array(buf, 12, verts.length).set(verts);
  new Uint32Array(buf, 12 + verts.length * 4, tris.length).set(tris);
  writeFileSync(path, Buffer.from(buf));
  console.log(`wrote ${path}: ${V} verts, ${T} tris`);
}

// ---------------------------------------------------------------- main

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const inPath = get("--in") ?? DEFAULT_IN;
  const outPath = get("--out") ?? DEFAULT_OUT;

  const { pos, tri, V } = readFnm(inPath);

  // connected components via union-find over triangle vertices
  const parent = new Int32Array(V);
  for (let i = 0; i < V; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < tri.length; i += 3) {
    const a = find(tri[i]);
    parent[find(tri[i + 1])] = a;
    parent[find(tri[i + 2])] = a;
  }
  const byRoot = new Map<number, { tris: number[]; verts: Set<number> }>();
  for (let i = 0; i < tri.length; i += 3) {
    const r = find(tri[i]);
    let c = byRoot.get(r);
    if (!c) {
      c = { tris: [], verts: new Set() };
      byRoot.set(r, c);
    }
    c.tris.push(tri[i], tri[i + 1], tri[i + 2]);
    for (let k = 0; k < 3; k++) c.verts.add(tri[i + k]);
  }
  const comps = [...byRoot.values()].sort((a, b) => b.verts.size - a.verts.size);
  console.log(
    `${comps.length} components:`,
    comps.map((c) => c.verts.size).filter((n) => n >= MIN_PART_VERTS)
  );

  // re-pose each placed part into the ship frame
  const outVerts: number[] = [];
  const outTris: number[] = [];
  for (const place of PLACES) {
    const c = comps[place.part];
    if (!c || c.verts.size < MIN_PART_VERTS) {
      throw new Error(`part ${place.part} missing or too small — input changed?`);
    }
    // local frame: bbox center
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const v of c.verts) {
      for (let k = 0; k < 3; k++) {
        const p = pos[v * 3 + k];
        if (p < mn[k]) mn[k] = p;
        if (p > mx[k]) mx[k] = p;
      }
    }
    const ctr = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const m = rotMat(place.rot);
    const remap = new Map<number, number>();
    for (const v of c.verts) {
      const l: Vec3 = [pos[v * 3] - ctr[0], pos[v * 3 + 1] - ctr[1], pos[v * 3 + 2] - ctr[2]];
      let x = m[0] * l[0] + m[1] * l[1] + m[2] * l[2];
      const y = m[3] * l[0] + m[4] * l[1] + m[5] * l[2];
      const z = m[6] * l[0] + m[7] * l[1] + m[8] * l[2];
      if (place.mirror === "x") x = -x;
      remap.set(v, outVerts.length / 3);
      outVerts.push(x + place.pos[0], y + place.pos[1], z + place.pos[2]);
    }
    const flip = place.mirror === "x"; // mirroring inverts winding
    for (let i = 0; i < c.tris.length; i += 3) {
      const a = remap.get(c.tris[i])!;
      const b = remap.get(c.tris[i + 1])!;
      const d = remap.get(c.tris[i + 2])!;
      if (flip) outTris.push(a, d, b);
      else outTris.push(a, b, d);
    }
  }

  // weld on a grid (also removes coincident joint faces)
  const WELD = 0.008; // ship units; hull is ~5 units long here
  const Q = 1 / WELD;
  const index = new Map<string, number>();
  const wVerts: number[] = [];
  const wIdx = new Int32Array(outVerts.length / 3);
  for (let v = 0; v < outVerts.length / 3; v++) {
    const x = outVerts[v * 3];
    const y = outVerts[v * 3 + 1];
    const z = outVerts[v * 3 + 2];
    const key = `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
    let vi = index.get(key);
    if (vi === undefined) {
      vi = wVerts.length / 3;
      index.set(key, vi);
      wVerts.push(x, y, z);
    }
    wIdx[v] = vi;
  }
  const wTris: number[] = [];
  for (let i = 0; i < outTris.length; i += 3) {
    const a = wIdx[outTris[i]];
    const b = wIdx[outTris[i + 1]];
    const c = wIdx[outTris[i + 2]];
    if (a !== b && b !== c && a !== c) wTris.push(a, b, c);
  }

  // center, normalize length to 3.0 with the nose at +Z
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < wVerts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (wVerts[i + k] < mn[k]) mn[k] = wVerts[i + k];
      if (wVerts[i + k] > mx[k]) mx[k] = wVerts[i + k];
    }
  }
  const scale = 3.0 / (mx[2] - mn[2]);
  const packed = new Float32Array(wVerts.length);
  for (let i = 0; i < wVerts.length; i += 3) {
    packed[i] = (wVerts[i] - (mn[0] + mx[0]) / 2) * scale;
    packed[i + 1] = (wVerts[i + 1] - (mn[1] + mx[1]) / 2) * scale;
    packed[i + 2] = (wVerts[i + 2] - (mn[2] + mx[2]) / 2) * scale;
  }
  console.log(
    `assembled: ${packed.length / 3} verts, ${wTris.length / 3} tris, ` +
      `size ${((mx[0] - mn[0]) * scale).toFixed(2)} x ${((mx[1] - mn[1]) * scale).toFixed(2)} x 3.00`
  );
  writeFnm(outPath, packed, wTris);
}

main();
