/**
 * Offline pipeline: download planet textures, the Milky Way skybox, the
 * Ceres global mosaic, and the NEAR Shoemaker Eros plate model; pack the
 * Eros mesh as binary (.fnm) for direct BufferGeometry upload.
 *
 * Usage: npm run fetch-assets
 *
 * Sources (record in CREDITS.md):
 * - Solar System Scope texture pack, CC BY 4.0
 * - NASA/JPL Photojournal PIA19606 (Dawn Ceres global map)
 * - PDS SBN, NEAR collected models: 433 Eros plate model MSI 89398 (km,
 *   body-fixed frame, +Z = north spin pole)
 *
 * .fnm layout (little-endian):
 *   0  u8[4]  magic "FNM1"
 *   4  u32    vertex count V
 *   8  u32    triangle count T
 *   12 f32[V*3] vertex positions, km
 *   .. u32[T*3] triangle indices, 0-based
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEX_DIR = join(ROOT, "public", "textures");
const MODEL_DIR = join(ROOT, "public", "models");

const SSS = "https://www.solarsystemscope.com/textures/download";
const TEXTURES: Array<{ file: string; url: string }> = [
  { file: "sun.jpg", url: `${SSS}/2k_sun.jpg` },
  { file: "mercury.jpg", url: `${SSS}/2k_mercury.jpg` },
  { file: "venus.jpg", url: `${SSS}/2k_venus_atmosphere.jpg` },
  { file: "earth.jpg", url: `${SSS}/2k_earth_daymap.jpg` },
  { file: "mars.jpg", url: `${SSS}/2k_mars.jpg` },
  { file: "moon.jpg", url: `${SSS}/2k_moon.jpg` },
  { file: "earth_clouds.jpg", url: `${SSS}/2k_earth_clouds.jpg` },
  { file: "jupiter.jpg", url: `${SSS}/2k_jupiter.jpg` },
  { file: "saturn.jpg", url: `${SSS}/2k_saturn.jpg` },
  { file: "saturn_ring.png", url: `${SSS}/2k_saturn_ring_alpha.png` },
  { file: "uranus.jpg", url: `${SSS}/2k_uranus.jpg` },
  { file: "neptune.jpg", url: `${SSS}/2k_neptune.jpg` },
  { file: "skybox_milky_way.jpg", url: `${SSS}/8k_stars_milky_way.jpg` },
  // Dawn framing camera global mosaic of Ceres, via NASA Photojournal.
  { file: "ceres.jpg", url: "https://photojournal.jpl.nasa.gov/jpeg/PIA19606.jpg" },
];

const EROS_TAB_URL =
  "https://sbnarchive.psi.edu/pds3/near/NEAR_A_5_COLLECTED_MODELS_V1_0/data/msi/eros089398.tab";

async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.arrayBuffer();
}

async function fetchTextures() {
  mkdirSync(TEX_DIR, { recursive: true });
  for (const t of TEXTURES) {
    const dest = join(TEX_DIR, t.file);
    if (existsSync(dest)) {
      console.log(`skip ${t.file} (exists)`);
      continue;
    }
    console.log(`fetching ${t.file}...`);
    const buf = await download(t.url);
    writeFileSync(dest, Buffer.from(buf));
    console.log(`  ${(buf.byteLength / 1024).toFixed(0)} KB`);
  }
}

function packPlateModel(text: string): ArrayBuffer {
  const verts: number[] = [];
  const tris: number[] = [];
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "v") {
      verts.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (parts[0] === "f") {
      tris.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    }
  }
  const v = verts.length / 3;
  const t = tris.length / 3;
  // PDS plate models are inconsistently indexed across products: the MSI
  // 89398 model is 0-based, older ones are 1-based. Detect from the range.
  let minI = Infinity;
  let maxI = -Infinity;
  for (const i of tris) {
    if (i < minI) minI = i;
    if (i > maxI) maxI = i;
  }
  if (minI === 1 && maxI === v) {
    for (let i = 0; i < tris.length; i++) tris[i] -= 1;
  } else if (!(minI === 0 && maxI === v - 1)) {
    throw new Error(`ambiguous face indexing: min ${minI}, max ${maxI}, verts ${v}`);
  }
  for (const x of verts) {
    if (!Number.isFinite(x)) throw new Error("non-finite vertex coordinate");
  }
  console.log(`  parsed ${v} vertices, ${t} triangles (${minI === 0 ? "0" : "1"}-indexed)`);
  const buf = new ArrayBuffer(12 + verts.length * 4 + tris.length * 4);
  const view = new DataView(buf);
  view.setUint8(0, 0x46); // F
  view.setUint8(1, 0x4e); // N
  view.setUint8(2, 0x4d); // M
  view.setUint8(3, 0x31); // 1
  view.setUint32(4, v, true);
  view.setUint32(8, t, true);
  new Float32Array(buf, 12, verts.length).set(verts);
  new Uint32Array(buf, 12 + verts.length * 4, tris.length).set(tris);
  return buf;
}

async function fetchEros() {
  mkdirSync(MODEL_DIR, { recursive: true });
  const dest = join(MODEL_DIR, "eros.fnm");
  if (existsSync(dest)) {
    console.log("skip eros.fnm (exists)");
    return;
  }
  console.log("fetching Eros plate model (~6 MB)...");
  const buf = await download(EROS_TAB_URL);
  const packed = packPlateModel(new TextDecoder().decode(buf));
  writeFileSync(dest, Buffer.from(packed));
  console.log(`  wrote eros.fnm (${(packed.byteLength / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  await fetchTextures();
  await fetchEros();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
