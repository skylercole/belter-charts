/**
 * Offline pipeline: fetch daily state vectors for small bodies from JPL Horizons,
 * pack as Float32 binary (.fnb) for client-side cubic Hermite interpolation.
 *
 * Also fetches off-grid spot-check vectors (small bodies + Earth/Mars) as JSON
 * test fixtures.
 *
 * Usage: npm run fetch-horizons
 *
 * Frame: heliocentric (500@10), ecliptic J2000 (Horizons "ECLIPTIC" ref plane
 * with J2000 ref system), km and km/s. Times are JD TDB.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EPHEM_DIR = join(ROOT, "public", "ephem");
const FIXTURE_DIR = join(ROOT, "src", "ephemeris", "__fixtures__");

const START = "2340-01-01";
const STOP = "2365-01-01";
const STEP = "1d";

// Horizons small-body lookup: "<number>;" selects the asteroid record.
const SMALL_BODIES = [
  { slug: "ceres", command: "1;" },
  { slug: "pallas", command: "2;" },
  { slug: "juno", command: "3;" },
  { slug: "vesta", command: "4;" },
  { slug: "hygiea", command: "10;" },
  { slug: "eros", command: "433;" },
];

// Major bodies for validating astronomy-engine against Horizons.
const PLANET_CHECKS = [
  { slug: "earth", command: "399" },
  { slug: "mars", command: "499" },
];

// Off-grid instants (mid-day, not on the daily sample grid) for interpolation
// accuracy fixtures, spread across the packed era.
const SPOT_TIMES = [
  "2342-03-07 07:13",
  "2350-01-01 00:00",
  "2351-06-15 11:47",
  "2359-11-30 18:30",
  "2364-12-01 05:05",
];

interface StateRow {
  jdTdb: number;
  pos: [number, number, number]; // km
  vel: [number, number, number]; // km/s
}

async function queryHorizons(params: Record<string, string>): Promise<string> {
  const url = new URL("https://ssd.jpl.nasa.gov/api/horizons.api");
  url.searchParams.set("format", "text");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, `'${v}'`);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Horizons HTTP ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  if (!text.includes("$$SOE")) {
    throw new Error(`Horizons returned no ephemeris data:\n${text.slice(0, 2000)}`);
  }
  return text;
}

function parseVectorCsv(text: string): StateRow[] {
  const soe = text.indexOf("$$SOE");
  const eoe = text.indexOf("$$EOE");
  const body = text.slice(soe + 5, eoe).trim();
  const rows: StateRow[] = [];
  for (const line of body.split("\n")) {
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length < 8) continue;
    // VEC_TABLE=2 CSV: JDTDB, CalendarDate, X, Y, Z, VX, VY, VZ,
    rows.push({
      jdTdb: Number(cols[0]),
      pos: [Number(cols[2]), Number(cols[3]), Number(cols[4])],
      vel: [Number(cols[5]), Number(cols[6]), Number(cols[7])],
    });
  }
  return rows;
}

function vectorParams(command: string, extra: Record<string, string>): Record<string, string> {
  return {
    COMMAND: command,
    OBJ_DATA: "NO",
    MAKE_EPHEM: "YES",
    EPHEM_TYPE: "VECTORS",
    CENTER: "500@10",
    REF_PLANE: "ECLIPTIC",
    REF_SYSTEM: "J2000",
    OUT_UNITS: "KM-S",
    VEC_TABLE: "2",
    CSV_FORMAT: "YES",
    ...extra,
  };
}

async function fetchRange(command: string): Promise<StateRow[]> {
  const text = await queryHorizons(
    vectorParams(command, { START_TIME: START, STOP_TIME: STOP, STEP_SIZE: STEP })
  );
  return parseVectorCsv(text);
}

async function fetchSpots(command: string): Promise<StateRow[]> {
  const text = await queryHorizons(
    vectorParams(command, { TLIST: SPOT_TIMES.map(horizonsTimeToTlist).join(" ") })
  );
  return parseVectorCsv(text);
}

// TLIST wants JD or calendar; calendar strings with spaces are awkward in TLIST,
// so convert "YYYY-MM-DD HH:MM" (as TDB) to JD.
function horizonsTimeToTlist(t: string): string {
  const [date, time] = t.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return julianDay(y, m, d, hh, mm).toFixed(6);
}

function julianDay(y: number, m: number, d: number, hh: number, mm: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mmn = m + 12 * a - 3;
  const jdn =
    d +
    Math.floor((153 * mmn + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045;
  return jdn + (hh - 12) / 24 + mm / 1440;
}

function pack(rows: StateRow[]): ArrayBuffer {
  const stepDays = rows[1].jdTdb - rows[0].jdTdb;
  // Verify uniform grid; Hermite reader assumes it.
  for (let i = 1; i < rows.length; i++) {
    const dt = rows[i].jdTdb - rows[i - 1].jdTdb;
    if (Math.abs(dt - stepDays) > 1e-6) {
      throw new Error(`non-uniform step at row ${i}: ${dt} vs ${stepDays}`);
    }
  }
  const buf = new ArrayBuffer(24 + rows.length * 6 * 4);
  const view = new DataView(buf);
  view.setUint8(0, 0x46); // F
  view.setUint8(1, 0x4e); // N
  view.setUint8(2, 0x42); // B
  view.setUint8(3, 0x31); // 1
  view.setFloat64(4, rows[0].jdTdb, true);
  view.setFloat64(12, stepDays, true);
  view.setUint32(20, rows.length, true);
  let off = 24;
  for (const r of rows) {
    for (const v of [...r.pos, ...r.vel]) {
      view.setFloat32(off, v, true);
      off += 4;
    }
  }
  return buf;
}

async function main() {
  mkdirSync(EPHEM_DIR, { recursive: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const spotFixture: Record<string, StateRow[]> = {};

  for (const body of SMALL_BODIES) {
    console.log(`fetching ${body.slug} range...`);
    const rows = await fetchRange(body.command);
    console.log(`  ${rows.length} samples, ${rows[0].jdTdb} .. ${rows[rows.length - 1].jdTdb}`);
    const buf = pack(rows);
    writeFileSync(join(EPHEM_DIR, `${body.slug}.fnb`), Buffer.from(buf));
    console.log(`  wrote ${body.slug}.fnb (${(buf.byteLength / 1024).toFixed(0)} KB)`);

    console.log(`fetching ${body.slug} spot checks...`);
    spotFixture[body.slug] = await fetchSpots(body.command);
  }

  for (const body of PLANET_CHECKS) {
    console.log(`fetching ${body.slug} spot checks...`);
    spotFixture[body.slug] = await fetchSpots(body.command);
  }

  writeFileSync(
    join(FIXTURE_DIR, "horizons-spots.json"),
    JSON.stringify({ times: SPOT_TIMES, note: "heliocentric ecliptic J2000, km, km/s, JD TDB", bodies: spotFixture }, null, 2)
  );
  console.log("wrote horizons-spots.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
