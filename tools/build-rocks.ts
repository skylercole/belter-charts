/**
 * Procedural asteroid/moonlet meshes: displaced UV-spheres with fbm noise,
 * crater dents, per-body elongation, and baked vertex colors (albedo
 * variation + slope darkening). Original geometry — no external assets.
 *
 * Output: public/models/<id>.fnm, format FNM3:
 *   0  u8[4]  magic "FNM3"
 *   4  u32    vertex count V
 *   8  u32    triangle count T
 *   12 f32[V*3] positions (unit ~ mean radius 1.0; scaled in-app)
 *   .. u32[T*3] indices
 *   .. u8[V*3]  vertex RGB
 *   .. f32[V*2] UVs (equirect; regolith detail map tiles over these)
 *
 * Usage: tsx tools/build-rocks.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models");

// deterministic per-seed PRNG (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 3D value noise with smooth interpolation, seeded. */
function makeNoise(seed: number) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    vals[i] = r() * 2 - 1;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const fade = (t: number) => t * t * (3 - 2 * t);
  const val = (xi: number, yi: number, zi: number) =>
    vals[perm[perm[perm[xi & 255] + (yi & 255)] + (zi & 255)]];
  return (x: number, y: number, z: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const xf = x - xi;
    const yf = y - yi;
    const zf = z - zi;
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    let acc = 0;
    for (const [dx, dy, dz] of [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
    ]) {
      const wgt =
        (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
      acc += wgt * val(xi + dx, yi + dy, zi + dz);
    }
    return acc;
  };
}

interface RockSpec {
  id: string;
  seed: number;
  /** ellipsoid axis scale before displacement */
  stretch: [number, number, number];
  /** fbm displacement amplitude (fraction of radius) */
  rough: number;
  craters: number;
  craterDepth: number;
  /** base RGB 0..255 */
  tint: [number, number, number];
  /** one giant basin (Vesta's Rheasilvia) */
  bigBasin?: boolean;
}

const ROCKS: RockSpec[] = [
  { id: "vesta", seed: 11, stretch: [1.06, 1.0, 0.88], rough: 0.05, craters: 26, craterDepth: 0.05, tint: [168, 159, 142], bigBasin: true },
  { id: "pallas", seed: 22, stretch: [1.05, 0.98, 0.94], rough: 0.09, craters: 30, craterDepth: 0.06, tint: [143, 154, 163] },
  { id: "hygiea", seed: 33, stretch: [1.0, 1.0, 0.97], rough: 0.05, craters: 22, craterDepth: 0.045, tint: [125, 122, 116] },
  { id: "juno", seed: 44, stretch: [1.18, 0.95, 0.9], rough: 0.11, craters: 34, craterDepth: 0.07, tint: [163, 145, 124] },
  { id: "phobos", seed: 55, stretch: [1.15, 1.0, 0.88], rough: 0.13, craters: 40, craterDepth: 0.1, tint: [154, 143, 133], bigBasin: true },
  { id: "deimos", seed: 66, stretch: [1.1, 1.0, 0.92], rough: 0.1, craters: 18, craterDepth: 0.06, tint: [168, 157, 146] },
  { id: "phoebe", seed: 77, stretch: [1.02, 1.0, 0.95], rough: 0.12, craters: 44, craterDepth: 0.11, tint: [138, 128, 120] },
];

const SEGS = 96; // UV sphere resolution: 96x48 -> ~4.7k verts

function buildRock(spec: RockSpec) {
  const noise = makeNoise(spec.seed);
  const r = rng(spec.seed * 7919);
  const craters: { dir: [number, number, number]; size: number; depth: number }[] = [];
  const n = spec.craters;
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1;
    const phi = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    craters.push({
      dir: [s * Math.cos(phi), s * Math.sin(phi), u],
      size: 0.08 + r() * 0.22,
      depth: spec.craterDepth * (0.4 + r() * 0.9),
    });
  }
  if (spec.bigBasin) {
    craters.push({ dir: [0, 0, -1], size: 0.75, depth: spec.craterDepth * 3 });
  }

  const rows = SEGS / 2 + 1;
  const verts: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const radiusAt = (dx: number, dy: number, dz: number) => {
    let radius = 1;
    // fbm: 4 octaves
    let amp = spec.rough;
    let freq = 1.6;
    for (let o = 0; o < 4; o++) {
      radius += amp * noise(dx * freq + 9, dy * freq + 9, dz * freq + 9);
      amp *= 0.5;
      freq *= 2.1;
    }
    for (const c of craters) {
      const d = Math.acos(
        Math.min(Math.max(dx * c.dir[0] + dy * c.dir[1] + dz * c.dir[2], -1), 1)
      );
      if (d < c.size * 2.2) {
        const x = d / c.size;
        // bowl with a slight rim
        radius -= c.depth * (Math.exp(-x * x) - 0.25 * Math.exp(-(x - 1.4) * (x - 1.4) * 4));
      }
    }
    return radius;
  };

  for (let iy = 0; iy < rows; iy++) {
    const theta = (iy / (rows - 1)) * Math.PI;
    for (let ix = 0; ix <= SEGS; ix++) {
      const phi = (ix / SEGS) * Math.PI * 2;
      const dx = Math.sin(theta) * Math.cos(phi);
      const dy = Math.sin(theta) * Math.sin(phi);
      const dz = Math.cos(theta);
      const radius = radiusAt(dx, dy, dz);
      verts.push(
        dx * radius * spec.stretch[0],
        dy * radius * spec.stretch[1],
        dz * radius * spec.stretch[2]
      );
      // albedo: base tint modulated by low-freq noise + darkened in dents
      const shade =
        0.82 +
        0.18 * noise(dx * 3 + 40, dy * 3 + 40, dz * 3 + 40) +
        1.15 * (radius - 1); // dents darker, bumps lighter
      const cl = Math.min(Math.max(shade, 0.55), 1.15);
      colors.push(
        Math.min(255, Math.round(spec.tint[0] * cl)),
        Math.min(255, Math.round(spec.tint[1] * cl)),
        Math.min(255, Math.round(spec.tint[2] * cl))
      );
      uvs.push(ix / SEGS, 1 - iy / (rows - 1));
    }
  }

  const idx: number[] = [];
  const stride = SEGS + 1;
  for (let iy = 0; iy < rows - 1; iy++) {
    for (let ix = 0; ix < SEGS; ix++) {
      const a = iy * stride + ix;
      const b = a + stride;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const V = verts.length / 3;
  const T = idx.length / 3;
  // u8 color block padded to 4-byte alignment for the trailing f32 UV block
  const colorBytes = (V * 3 + 3) & ~3;
  const buf = new ArrayBuffer(12 + V * 12 + T * 12 + colorBytes + V * 8);
  const view = new DataView(buf);
  view.setUint8(0, 0x46);
  view.setUint8(1, 0x4e);
  view.setUint8(2, 0x4d);
  view.setUint8(3, 0x33); // FNM3
  view.setUint32(4, V, true);
  view.setUint32(8, T, true);
  new Float32Array(buf, 12, V * 3).set(verts);
  new Uint32Array(buf, 12 + V * 12, T * 3).set(idx);
  new Uint8Array(buf, 12 + V * 12 + T * 12, V * 3).set(colors);
  new Float32Array(buf, 12 + V * 12 + T * 12 + colorBytes, V * 2).set(uvs);
  writeFileSync(join(OUT_DIR, `${spec.id}.fnm`), Buffer.from(buf));
  console.log(`${spec.id}: ${V} verts, ${T} tris, ${(buf.byteLength / 1024).toFixed(0)} KB`);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const spec of ROCKS) buildRock(spec);
