/**
 * Acceptance (Plan.md 6): Ceres and Eros positions match Horizons spot
 * checks within 0.1%. Spot checks are off-grid instants fetched separately
 * from the packed daily samples, so this exercises real interpolation error.
 */
import { describe, expect, it } from "vitest";
import spots from "./__fixtures__/horizons-spots.json";
import { loadSmallBodyFromDisk } from "./testutil";
import { length, distance } from "./vec";

const SMALL_BODIES = ["ceres", "eros", "vesta", "pallas", "hygiea", "juno"] as const;

describe("packed small-body ephemeris vs Horizons spot checks", () => {
  for (const slug of SMALL_BODIES) {
    it(`${slug}: position within 0.1%, velocity within 0.1%`, () => {
      const eph = loadSmallBodyFromDisk(slug);
      const rows = (spots.bodies as Record<string, typeof spots.bodies.ceres>)[slug];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const truthPos = { x: row.pos[0], y: row.pos[1], z: row.pos[2] };
        const truthVel = { x: row.vel[0], y: row.vel[1], z: row.vel[2] };
        const got = eph.stateAtJd(row.jdTdb);

        const posErr = distance(got.pos, truthPos) / length(truthPos);
        const velErr = distance(got.vel, truthVel) / length(truthVel);
        expect(posErr, `${slug} pos err at JD ${row.jdTdb}`).toBeLessThan(1e-3);
        expect(velErr, `${slug} vel err at JD ${row.jdTdb}`).toBeLessThan(1e-3);
      }
    });
  }

  it("rejects dates outside the packed range", () => {
    const eph = loadSmallBodyFromDisk("ceres");
    expect(() => eph.stateAt(new Date("2339-12-01"))).toThrow(RangeError);
    expect(() => eph.stateAt(new Date("2365-06-01"))).toThrow(RangeError);
  });

  it("covers the target era 2340..2365", () => {
    const eph = loadSmallBodyFromDisk("eros");
    expect(eph.covers(2575726.5)).toBe(true); // 2340-01-01 TDB
    expect(eph.covers(2584858.5)).toBe(true); // 2365-01-01 TDB
  });
});
