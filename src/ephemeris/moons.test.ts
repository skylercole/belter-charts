/**
 * Moon sanity: engine-modeled moons land in their real orbital-radius
 * bands around the parent; Kepler moons match their configured radius by
 * construction (checked anyway to guard the math).
 */
import { describe, expect, it } from "vitest";
import { loadEphemerisFromDisk } from "./testutil";
import { distance } from "./vec";

const eph = loadEphemerisFromDisk();
const DATES = [new Date("2350-06-01"), new Date("2357-11-15")];

function sep(moonId: string, parentId: string, date: Date): number {
  return distance(eph.stateOf(moonId, date).pos, eph.stateOf(parentId, date).pos);
}

describe("moons orbit their parents at the right distance", () => {
  it("Luna: 356k-407k km from Earth", () => {
    for (const d of DATES) {
      const r = sep("luna", "earth", d);
      expect(r).toBeGreaterThan(350_000);
      expect(r).toBeLessThan(410_000);
    }
  });

  const GALILEANS: Array<[string, number]> = [
    ["io", 421_800],
    ["europa", 671_100],
    ["ganymede", 1_070_400],
    ["callisto", 1_882_700],
  ];
  for (const [id, a] of GALILEANS) {
    it(`${id}: ~${Math.round(a / 1000)}k km from Jupiter (±3%)`, () => {
      for (const d of DATES) {
        const r = sep(id, "jupiter", d);
        expect(Math.abs(r - a) / a).toBeLessThan(0.03);
      }
    });
  }

  it("Titan and Phoebe: configured Kepler radii", () => {
    for (const d of DATES) {
      expect(sep("titan", "saturn", d)).toBeCloseTo(1_221_870, -3);
      expect(sep("phoebe", "saturn", d)).toBeCloseTo(12_960_000, -4);
    }
  });

  it("moon velocities are finite and parent-relative sane", () => {
    for (const d of DATES) {
      const luna = eph.stateOf("luna", d);
      const earth = eph.stateOf("earth", d);
      const relV = distance(luna.vel, earth.vel);
      // Luna orbital speed ~1.0 km/s
      expect(relV).toBeGreaterThan(0.8);
      expect(relV).toBeLessThan(1.2);
    }
  });
});
