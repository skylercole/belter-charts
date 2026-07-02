/**
 * Validate astronomy-engine planet states against Horizons spot checks in
 * the 2340-2365 era, in the shared frame (heliocentric ecliptic J2000).
 * astronomy-engine is arcminute-class; 0.1% of radius is a generous band.
 */
import { describe, expect, it } from "vitest";
import spots from "./__fixtures__/horizons-spots.json";
import { planetState, type PlanetName } from "./planets";
import { jdToDate } from "./time";
import { length, distance } from "./vec";

describe("astronomy-engine vs Horizons in the 2350s era", () => {
  for (const slug of ["earth", "mars"] as PlanetName[]) {
    it(`${slug}: position within 0.1% of Horizons`, () => {
      const rows = (spots.bodies as Record<string, typeof spots.bodies.earth>)[slug];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const truth = { x: row.pos[0], y: row.pos[1], z: row.pos[2] };
        // Fixture JD is TDB; we feed it as UT. The ~69 s scale offset is far
        // inside the 0.1% band (documented in ASSUMPTIONS.md).
        const got = planetState(slug, jdToDate(row.jdTdb));
        const err = distance(got.pos, truth) / length(truth);
        expect(err, `${slug} at JD ${row.jdTdb}`).toBeLessThan(1e-3);
      }
    });
  }
});
