/**
 * Epstein flight planner: brachistochrone math and moving-target intercept.
 * Spec: Plan.md section 5.
 *
 * Gravity and the origin/destination orbital velocities are ignored — ship
 * speeds under sustained thrust dwarf orbital speeds (error negligible above
 * ~0.1 g sustained; surfaced as a UI footnote).
 */
import type { Ephemeris } from "../ephemeris";
import type { Vec3 } from "../ephemeris/vec";
import { distance } from "../ephemeris/vec";

export const G0 = 9.80665e-3; // km/s^2 per g
export const C_KM_S = 299_792.458;

/**
 * Physics honesty toggle (Plan.md 5.5). Fan analysis (Expanse wiki "Travel
 * Time") finds the books' STATED drive accelerations produce trips ~10x
 * faster than the travel times the books actually narrate. "Honest physics"
 * uses the stated g; "canon feel" divides acceleration by 10 so trips take
 * as long as they do on the page. Times scale by sqrt(10) ~ 3.16x.
 */
export const CANON_ACCEL_DIVISOR = 10;

export type HonestyMode = "honest" | "canon";

export function effectiveAccelG(statedG: number, mode: HonestyMode): number {
  return mode === "canon" ? statedG / CANON_ACCEL_DIVISOR : statedG;
}

export interface Brachistochrone {
  /** total travel time, seconds */
  t: number;
  /** time of flip (midpoint), seconds */
  tFlip: number;
  /** peak velocity at flip, km/s */
  vPeak: number;
}

/**
 * No-coast brachistochrone: accelerate to midpoint, flip, decelerate.
 * d in km, accel in km/s^2.
 */
export function brachistochrone(d: number, accel: number): Brachistochrone {
  const t = 2 * Math.sqrt(d / accel);
  return { t, tFlip: t / 2, vPeak: Math.sqrt(d * accel) };
}

export interface FlightPlan {
  originId: string;
  destId: string;
  depart: Date;
  arrive: Date;
  accelG: number;
  /** straight-line chord flown, km */
  distanceKm: number;
  travelTimeSec: number;
  flipTimeSec: number;
  vPeakKmS: number;
  departPos: Vec3;
  arrivePos: Vec3;
  /** one-way light lag origin->destination at departure, seconds */
  lightLagSec: number;
  iterations: number;
}

const CONVERGE_SEC = 60; // iterate until delta-t < 1 minute
const MAX_ITER = 20;

/**
 * Moving-target intercept (Plan.md 5.3): the destination moves during the
 * flight, so iterate travel time against the destination position at
 * arrival until the estimate stabilizes.
 */
export function planFlight(
  eph: Ephemeris,
  originId: string,
  destId: string,
  depart: Date,
  accelG: number
): FlightPlan {
  const accel = accelG * G0;
  const departPos = eph.stateOf(originId, depart).pos;
  const destAtDeparture = eph.stateOf(destId, depart).pos;

  let t = brachistochrone(distance(departPos, destAtDeparture), accel).t;
  let arrivePos = destAtDeparture;
  let iterations = 0;

  for (let i = 0; i < MAX_ITER; i++) {
    iterations++;
    const arrive = new Date(depart.getTime() + t * 1000);
    arrivePos = eph.stateOf(destId, arrive).pos;
    const tNext = brachistochrone(distance(departPos, arrivePos), accel).t;
    const dt = Math.abs(tNext - t);
    t = tNext;
    if (dt < CONVERGE_SEC) break;
  }

  const d = distance(departPos, arrivePos);
  const b = brachistochrone(d, accel);
  return {
    originId,
    destId,
    depart,
    arrive: new Date(depart.getTime() + b.t * 1000),
    accelG,
    distanceKm: d,
    travelTimeSec: b.t,
    flipTimeSec: b.tFlip,
    vPeakKmS: b.vPeak,
    departPos,
    arrivePos,
    lightLagSec: distance(departPos, destAtDeparture) / C_KM_S,
    iterations,
  };
}

/** One-way light lag between two bodies at a given instant, seconds. */
export function lightLag(eph: Ephemeris, aId: string, bId: string, date: Date): number {
  const a = eph.stateOf(aId, date).pos;
  const b = eph.stateOf(bId, date).pos;
  return distance(a, b) / C_KM_S;
}

/**
 * Ship position along a flight plan at time t seconds after departure,
 * for trajectory drawing/animation. Straight chord, brachistochrone speed
 * profile.
 */
export function shipPosition(plan: FlightPlan, tSec: number): Vec3 {
  const { travelTimeSec: T, departPos, arrivePos, distanceKm } = plan;
  const accel = plan.accelG * G0;
  const t = Math.min(Math.max(tSec, 0), T);
  const half = T / 2;
  // distance covered along the chord
  const s =
    t <= half
      ? 0.5 * accel * t * t
      : distanceKm - 0.5 * accel * (T - t) * (T - t);
  const f = distanceKm === 0 ? 0 : s / distanceKm;
  return {
    x: departPos.x + (arrivePos.x - departPos.x) * f,
    y: departPos.y + (arrivePos.y - departPos.y) * f,
    z: departPos.z + (arrivePos.z - departPos.z) * f,
  };
}
