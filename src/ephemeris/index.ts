/**
 * Unified ephemeris facade: one `stateOf(bodyId, date)` for planets
 * (astronomy-engine), small bodies (packed Horizons files) and fictional
 * stations (offset from their parent's orbit).
 *
 * Station model, Phase 0 approximation: rotate the parent's state about the
 * ecliptic pole by the station's offset angle. For near-circular, low-e
 * orbits like Ceres (e≈0.08) this differs from a true mean-anomaly offset by
 * well under the visual scale of the map. Logged in ASSUMPTIONS.md; replace
 * with Keplerian propagation if it ever matters.
 */
import { BODY_BY_ID } from "../data/bodies";
import { planetState, type PlanetName } from "./planets";
import { SmallBodyEphemeris, type StateVector } from "./smallbody";
import { rotateZ } from "./vec";

export type { StateVector };

const SMALL_BODY_IDS = ["ceres", "eros", "vesta", "pallas", "hygiea", "juno"] as const;
export type SmallBodyId = (typeof SMALL_BODY_IDS)[number];

const DEG = Math.PI / 180;

export class Ephemeris {
  constructor(private readonly small: Map<string, SmallBodyEphemeris>) {}

  stateOf(bodyId: string, date: Date): StateVector {
    const def = BODY_BY_ID.get(bodyId);
    if (!def) throw new Error(`unknown body: ${bodyId}`);

    switch (def.kind) {
      case "star":
        return { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
      case "planet":
        return planetState(bodyId as PlanetName, date);
      case "smallbody": {
        const eph = this.small.get(bodyId);
        if (!eph) throw new Error(`ephemeris not loaded for ${bodyId}`);
        return eph.stateAt(date);
      }
      case "station": {
        const { parent, offsetDeg } = def.station!;
        const parentState = this.stateOf(parent, date);
        return {
          pos: rotateZ(parentState.pos, offsetDeg * DEG),
          vel: rotateZ(parentState.vel, offsetDeg * DEG),
        };
      }
      case "construct": {
        // fixed circular heliocentric orbit in the ecliptic
        const { radiusAu, phaseDeg } = def.construct!;
        const r = radiusAu * 149_597_870.7;
        const n = (2 * Math.PI) / (def.periodDays * 86_400); // rad/s
        const t = date.getTime() / 1000;
        const a = phaseDeg * DEG + n * t;
        const v = n * r;
        return {
          pos: { x: r * Math.cos(a), y: r * Math.sin(a), z: 0 },
          vel: { x: -v * Math.sin(a), y: v * Math.cos(a), z: 0 },
        };
      }
    }
  }

  /** Whether a body exists at the given time (timeline layer overrides). */
  exists(_bodyId: string, _date: Date): boolean {
    return true;
  }

  /** Inclusive JD range covered by every loaded small body. */
  coveredRange(): { jdStart: number; jdEnd: number } {
    let jdStart = -Infinity;
    let jdEnd = Infinity;
    for (const eph of this.small.values()) {
      jdStart = Math.max(jdStart, eph.jdStart);
      jdEnd = Math.min(jdEnd, eph.jdEnd);
    }
    return { jdStart, jdEnd };
  }
}

/** Browser entry point: load all packed small-body files. */
export async function loadEphemeris(baseUrl: string): Promise<Ephemeris> {
  const entries = await Promise.all(
    SMALL_BODY_IDS.map(async (id) => {
      const res = await fetch(`${baseUrl}/${id}.fnb`);
      if (!res.ok) throw new Error(`failed to load ${id}.fnb: HTTP ${res.status}`);
      return [id, new SmallBodyEphemeris(await res.arrayBuffer())] as const;
    })
  );
  return new Ephemeris(new Map(entries));
}
