/** Node-side helpers for tests: load packed ephemeris files from disk. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Ephemeris } from "./index";
import { SmallBodyEphemeris } from "./smallbody";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadSmallBodyFromDisk(slug: string): SmallBodyEphemeris {
  const buf = readFileSync(join(ROOT, "public", "ephem", `${slug}.fnb`));
  // Copy into a fresh ArrayBuffer; Buffer views can share a larger pool.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new SmallBodyEphemeris(ab);
}

export function loadEphemerisFromDisk(): Ephemeris {
  const slugs = ["ceres", "eros", "vesta", "pallas", "hygiea", "juno"];
  return new Ephemeris(new Map(slugs.map((s) => [s, loadSmallBodyFromDisk(s)])));
}
