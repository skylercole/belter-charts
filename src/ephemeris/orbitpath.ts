/**
 * Orbit polyline sampling shared by the 2D and 3D views: trace one trailing
 * orbital period ending "now", clamped to packed data coverage for small
 * bodies and stations. Heliocentric ecliptic J2000, km, Float64.
 */
import type { BodyDef } from "../data/bodies";
import type { Ephemeris } from "./index";
import { jdToDate } from "./time";

export interface OrbitPath {
  /** flat [x0,y0,z0, x1,y1,z1, ...] km */
  pts: Float64Array;
  closed: boolean;
  jdCenter: number;
}

export function sampleOrbitPath(
  eph: Ephemeris,
  body: BodyDef,
  jdNow: number,
  samples: number
): OrbitPath {
  let jd0 = jdNow - body.periodDays;
  let jd1 = jdNow;
  let closed = true;
  if (body.kind === "smallbody" || body.station) {
    const range = eph.coveredRange();
    const lo = range.jdStart + 0.01;
    const hi = range.jdEnd - 0.01;
    if (jd0 < lo) {
      jd0 = lo;
      jd1 = Math.min(lo + body.periodDays, hi);
      closed = jd1 - jd0 >= body.periodDays * 0.999;
    }
    jd1 = Math.min(jd1, hi);
  }
  const pts = new Float64Array(samples * 3);
  for (let i = 0; i < samples; i++) {
    const jd = jd0 + ((jd1 - jd0) * i) / (samples - 1);
    const s = eph.stateOf(body.id, jdToDate(jd));
    pts[i * 3] = s.pos.x;
    pts[i * 3 + 1] = s.pos.y;
    pts[i * 3 + 2] = s.pos.z;
  }
  return { pts, closed, jdCenter: jdNow };
}
