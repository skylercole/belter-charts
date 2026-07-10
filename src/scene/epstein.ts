/**
 * Epstein's last flight — story scenario from the "Drive" short story.
 * Solomon Epstein test-fires his modified drive on a small yacht off Mars;
 * the efficiency is beyond anything expected, the acceleration pins him,
 * and he never reaches the cutoff. We ride along until the fuel runs dry.
 *
 * Mechanically: a pseudo flight plan whose flip never comes — constant
 * acceleration from Mars, radially prograde, for 37 hours (approximate
 * figure; see ASSUMPTIONS.md). The ride ends at "fuel exhausted" with an
 * epitaph instead of a docking.
 */
import type { Ephemeris } from "../ephemeris";
import { length, scale } from "../ephemeris/vec";
import { G0, type FlightPlan } from "../planner";
import type { CommLine } from "./commlog";

export const EPSTEIN_G = 6.8; // pinned-to-the-couch, not instantly lethal
export const EPSTEIN_BURN_SEC = 37 * 3600;

export function epsteinPlan(eph: Ephemeris, depart: Date): FlightPlan {
  const mars = eph.stateOf("mars", depart);
  // Direction: along Mars's orbital velocity (prograde), tipped slightly
  // out of the well — the yacht just goes.
  const dir = scale(mars.vel, 1 / length(mars.vel));
  const accel = EPSTEIN_G * G0;
  // Encode as a brachistochrone whose midpoint (flip) is the fuel-out
  // moment: for t <= flip the position law 0.5*a*t^2 matches exactly.
  // The yacht keeps Mars's orbital velocity as its drift baseline
  // (departVel = arriveVel = mars.vel, so the drift accel g is zero).
  const T = 2 * EPSTEIN_BURN_SEC;
  const d = accel * EPSTEIN_BURN_SEC * EPSTEIN_BURN_SEC; // a*(T/2)^2... times 1
  const arrivePos = {
    x: mars.pos.x + mars.vel.x * T + dir.x * d,
    y: mars.pos.y + mars.vel.y * T + dir.y * d,
    z: mars.pos.z + mars.vel.z * T + dir.z * d,
  };
  return {
    originId: "mars",
    destId: "mars", // display only; the HUD is overridden for this scenario
    depart,
    arrive: new Date(depart.getTime() + T * 1000),
    accelG: EPSTEIN_G,
    distanceKm: d,
    travelTimeSec: T,
    flipTimeSec: EPSTEIN_BURN_SEC,
    vPeakKmS: accel * EPSTEIN_BURN_SEC,
    departPos: mars.pos,
    arrivePos,
    departVel: mars.vel,
    arriveVel: mars.vel,
    thrustAxis: dir,
    burnDistanceKm: d,
    arcLengthKm: d,
    lightLagSec: 0,
    iterations: 0,
  };
}

export const EPSTEIN_SCRIPT: CommLine[] = [
  { at: 0.0005, text: "Solomon: drive modification test, take one. Easy little burn." },
  { at: 0.004, text: "Solomon: ...that's not a little burn. These efficiency numbers can't be right." },
  { at: 0.02, text: "Solomon: can't lift my arm to the cutoff. G is climbing." },
  { at: 0.08, text: "yacht: crew health warning. Sustained high-g. No response." },
  { at: 0.18, text: "Mars traffic: unregistered burn, respond. ...Respond." },
  { at: 0.3, text: "yacht: autopilot holding course. Drive nominal. Fuel 40%." },
  { at: 0.42, text: "yacht: fuel 10%. Velocity beyond any crewed record." },
  { at: 0.48, text: "yacht: fuel exhausted. Drive shutdown." },
];

export const EPSTEIN_EPITAPH = `
  <h2>His ship is still out there</h2>
  <p>Solomon Epstein burned for thirty-seven hours at accelerations no one
  had ever survived, and did not survive them either. The drive he lit that
  day gave humanity the solar system.</p>
  <p class="src">— scenario after the short story "Drive"; figures approximate,
  see ASSUMPTIONS.md</p>
`;
