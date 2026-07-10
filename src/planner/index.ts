/**
 * Epstein flight planner: brachistochrone math and moving-target intercept.
 * Spec: Plan.md section 5.
 *
 * Trajectories are "boosted brachistochrones": the ship departs carrying the
 * origin's orbital velocity and arrives matching the destination's. The path
 * decomposes into a constant-acceleration drift baseline (g = (v1-v0)/T,
 * which morphs the departure orbit into the arrival orbit) plus the classic
 * accelerate/flip/decelerate brachistochrone along a fixed thrust axis c:
 *
 *   r(t) = departPos + v0*t + g*t^2/2 + s(t)*c
 *   v(t) = v0 + g*t + s'(t)*c
 *
 * Total thrust is constant per phase (g + a*c burning, g - a*c braking), so
 * this is an exact one-flip torchship trajectory, closed-form throughout.
 * The true |thrust| exceeds the displayed accelG by up to a few percent
 * (|g| is small next to a); we display the drive's rated g.
 */
import type { Ephemeris } from "../ephemeris";
import type { Vec3 } from "../ephemeris/vec";
import { distance, length, sub } from "../ephemeris/vec";

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

/**
 * Distance covered (and rate) along the brachistochrone axis at time t:
 * half the burn out, mirrored back in. D in km, accel km/s^2, T total sec.
 */
export function brachDistance(
  D: number,
  accel: number,
  T: number,
  t: number
): { s: number; sdot: number } {
  const half = T / 2;
  if (t <= half) {
    return { s: 0.5 * accel * t * t, sdot: accel * t };
  }
  const r = T - t;
  return { s: D - 0.5 * accel * r * r, sdot: accel * r };
}

export interface FlightPlan {
  originId: string;
  destId: string;
  depart: Date;
  arrive: Date;
  accelG: number;
  /** straight-line chord departPos->arrivePos, km (display/scaling) */
  distanceKm: number;
  travelTimeSec: number;
  flipTimeSec: number;
  /** peak speed along the thrust axis, sqrt(D*a), km/s */
  vPeakKmS: number;
  departPos: Vec3;
  arrivePos: Vec3;
  /** heliocentric orbital velocity at departure, km/s */
  departVel: Vec3;
  /** heliocentric orbital velocity at arrival (destination's), km/s */
  arriveVel: Vec3;
  /** unit thrust axis of the brachistochrone component */
  thrustAxis: Vec3;
  /** residual distance covered by the brachistochrone term, km */
  burnDistanceKm: number;
  /** length of the curved path, km */
  arcLengthKm: number;
  /** one-way light lag origin->destination at departure, seconds */
  lightLagSec: number;
  iterations: number;
}

// Tight tolerance: at ~25 km/s target speed, 1 s of travel-time error is
// ~25 km of rendezvous miss — invisible even at dock zoom.
const CONVERGE_SEC = 1;
const MAX_ITER = 30;
// Fine-pinning tolerance: shrink the drift/endpoint inconsistency to
// centimeters-per-second scale so shipPosition(T) lands on arrivePos.
const PIN_SEC = 1e-3;

/** Drift baseline endpoint: departPos + (v0+v1)*t/2. */
function driftEnd(departPos: Vec3, v0: Vec3, v1: Vec3, t: number): Vec3 {
  const h = t / 2;
  return {
    x: departPos.x + (v0.x + v1.x) * h,
    y: departPos.y + (v0.y + v1.y) * h,
    z: departPos.z + (v0.z + v1.z) * h,
  };
}

/**
 * Moving-target intercept (Plan.md 5.3): the destination moves during the
 * flight, so iterate travel time against the destination state at arrival
 * until the estimate stabilizes. The burn distance D is measured from the
 * drift baseline endpoint, not the departure point.
 */
export function planFlight(
  eph: Ephemeris,
  originId: string,
  destId: string,
  depart: Date,
  accelG: number
): FlightPlan {
  const accel = accelG * G0;
  const origin = eph.stateOf(originId, depart);
  const departPos = origin.pos;
  const departVel = origin.vel;
  const destAtDeparture = eph.stateOf(destId, depart).pos;

  let t = brachistochrone(distance(departPos, destAtDeparture), accel).t;
  let iterations = 0;
  let prevSign = 0;
  let flips = 0;

  for (let i = 0; i < MAX_ITER; i++) {
    iterations++;
    const arrive = new Date(depart.getTime() + t * 1000);
    const dest = eph.stateOf(destId, arrive);
    const D = distance(dest.pos, driftEnd(departPos, departVel, dest.vel, t));
    let tNext = 2 * Math.sqrt(D / accel);
    // Damp oscillation: with slow drives the update can ping-pong around
    // the fixed point; average the step once it alternates sign twice.
    const sign = Math.sign(tNext - t);
    if (sign !== 0 && sign === -prevSign && ++flips >= 2) {
      tNext = (t + tNext) / 2;
      flips = 0;
    }
    prevSign = sign;
    const dt = Math.abs(tNext - t);
    t = tNext;
    if (dt < CONVERGE_SEC) break;
  }

  // Fine pinning (uncounted): tighten t until the drift/endpoint pair is
  // self-consistent, so r(T) lands on arrivePos to sub-km precision.
  let arrivePos = destAtDeparture;
  let arriveVel = departVel;
  for (let i = 0; i < 8; i++) {
    const arrive = new Date(depart.getTime() + t * 1000);
    const dest = eph.stateOf(destId, arrive);
    arrivePos = dest.pos;
    arriveVel = dest.vel;
    const D = distance(dest.pos, driftEnd(departPos, departVel, dest.vel, t));
    const tNext = 2 * Math.sqrt(D / accel);
    const dt = Math.abs(tNext - t);
    t = tNext;
    if (dt < PIN_SEC) break;
  }

  const drift = driftEnd(departPos, departVel, arriveVel, t);
  const residual = sub(arrivePos, drift);
  let D = length(residual);
  let thrustAxis: Vec3;
  if (D > 1e-6) {
    thrustAxis = { x: residual.x / D, y: residual.y / D, z: residual.z / D };
  } else {
    // Degenerate: destination sits on the drift baseline. Point along the
    // chord, or +X if the chord is degenerate too.
    D = 0;
    const chord = sub(arrivePos, departPos);
    const c = length(chord);
    thrustAxis =
      c > 1e-6
        ? { x: chord.x / c, y: chord.y / c, z: chord.z / c }
        : { x: 1, y: 0, z: 0 };
  }
  const b = brachistochrone(D, accel);

  const plan: FlightPlan = {
    originId,
    destId,
    depart,
    arrive: new Date(depart.getTime() + b.t * 1000),
    accelG,
    distanceKm: distance(departPos, arrivePos),
    travelTimeSec: b.t,
    flipTimeSec: b.tFlip,
    vPeakKmS: b.vPeak,
    departPos,
    arrivePos,
    departVel,
    arriveVel,
    thrustAxis,
    burnDistanceKm: D,
    arcLengthKm: 0,
    lightLagSec: distance(departPos, destAtDeparture) / C_KM_S,
    iterations,
  };
  plan.arcLengthKm = measureArcLength(plan);
  return plan;
}

/** One-way light lag between two bodies at a given instant, seconds. */
export function lightLag(eph: Ephemeris, aId: string, bId: string, date: Date): number {
  const a = eph.stateOf(aId, date).pos;
  const b = eph.stateOf(bId, date).pos;
  return distance(a, b) / C_KM_S;
}

/**
 * Ship position along a flight plan at time t seconds after departure:
 * drift baseline plus brachistochrone displacement along the thrust axis.
 */
export function shipPosition(plan: FlightPlan, tSec: number): Vec3 {
  const T = plan.travelTimeSec;
  const t = Math.min(Math.max(tSec, 0), T);
  const accel = plan.accelG * G0;
  const { departPos, departVel, arriveVel, thrustAxis } = plan;
  const gh = T === 0 ? 0 : (0.5 * t * t) / T; // g*t^2/2 scalar factor
  const { s } = brachDistance(plan.burnDistanceKm, accel, T, t);
  return {
    x: departPos.x + departVel.x * t + (arriveVel.x - departVel.x) * gh + s * thrustAxis.x,
    y: departPos.y + departVel.y * t + (arriveVel.y - departVel.y) * gh + s * thrustAxis.y,
    z: departPos.z + departVel.z * t + (arriveVel.z - departVel.z) * gh + s * thrustAxis.z,
  };
}

/** Heliocentric ship velocity at t seconds after departure, km/s. */
export function shipVelocity(plan: FlightPlan, tSec: number): Vec3 {
  const T = plan.travelTimeSec;
  const t = Math.min(Math.max(tSec, 0), T);
  const accel = plan.accelG * G0;
  const { departVel, arriveVel, thrustAxis } = plan;
  const f = T === 0 ? 0 : t / T; // g*t scalar factor
  const { sdot } = brachDistance(plan.burnDistanceKm, accel, T, t);
  return {
    x: departVel.x + (arriveVel.x - departVel.x) * f + sdot * thrustAxis.x,
    y: departVel.y + (arriveVel.y - departVel.y) * f + sdot * thrustAxis.y,
    z: departVel.z + (arriveVel.z - departVel.z) * f + sdot * thrustAxis.z,
  };
}

/** Position and velocity bundle. */
export function shipState(plan: FlightPlan, tSec: number): { pos: Vec3; vel: Vec3 } {
  return { pos: shipPosition(plan, tSec), vel: shipVelocity(plan, tSec) };
}

/**
 * Unit total-thrust direction at time t: constant per phase,
 * unit(g + a*c) while burning, unit(g - a*c) while braking.
 */
export function thrustDir(plan: FlightPlan, tSec: number): Vec3 {
  const T = plan.travelTimeSec;
  const accel = plan.accelG * G0;
  const { departVel, arriveVel, thrustAxis } = plan;
  const sign = tSec <= plan.flipTimeSec ? 1 : -1;
  const gx = T === 0 ? 0 : (arriveVel.x - departVel.x) / T;
  const gy = T === 0 ? 0 : (arriveVel.y - departVel.y) / T;
  const gz = T === 0 ? 0 : (arriveVel.z - departVel.z) / T;
  const x = gx + sign * accel * thrustAxis.x;
  const y = gy + sign * accel * thrustAxis.y;
  const z = gz + sign * accel * thrustAxis.z;
  const n = Math.hypot(x, y, z);
  if (n < 1e-12) return { ...plan.thrustAxis };
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Fraction of travel time for path sample i of n: cosine-spaced, so samples
 * crowd the endpoints. Near departure/arrival the ship is slow and the
 * inherited orbital velocity bends the path hard (turn radius ~v^2/a can be
 * a few million km); mid-route the path is nearly straight and needs little.
 */
export function samplePathFrac(i: number, n: number): number {
  return (1 - Math.cos((Math.PI * i) / (n - 1))) / 2;
}

/** Inverse of samplePathFrac: the last sample index at or before frac f. */
export function samplePathIndex(f: number, n: number): number {
  const clamped = Math.min(Math.max(f, 0), 1);
  return Math.min(Math.floor(((n - 1) * Math.acos(1 - 2 * clamped)) / Math.PI), n - 1);
}

/**
 * Sample the flight path at n cosine-spaced points (see samplePathFrac),
 * heliocentric km, flat xyz triplets.
 */
export function samplePath(plan: FlightPlan, n: number, out?: Float64Array): Float64Array {
  const pts = out ?? new Float64Array(n * 3);
  const T = plan.travelTimeSec;
  for (let i = 0; i < n; i++) {
    const p = shipPosition(plan, T * samplePathFrac(i, n));
    pts[i * 3] = p.x;
    pts[i * 3 + 1] = p.y;
    pts[i * 3 + 2] = p.z;
  }
  return pts;
}

const ARC_SAMPLES = 129;

function measureArcLength(plan: FlightPlan): number {
  const pts = samplePath(plan, ARC_SAMPLES);
  let arc = 0;
  for (let i = 3; i < pts.length; i += 3) {
    arc += Math.hypot(pts[i] - pts[i - 3], pts[i + 1] - pts[i - 2], pts[i + 2] - pts[i - 1]);
  }
  return arc;
}
