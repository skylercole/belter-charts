/** Shared plan-building and pacing helpers for story scenarios. */
import type { Ephemeris } from "../../ephemeris";
import { planFlight, type FlightPlan } from "../../planner";
import { EVENTS } from "../../timeline";

/**
 * Plan a flight whose arrival lands within an hour of a timeline event
 * (plus an optional day offset). Iterates the departure: travel time varies
 * slowly with the departure date, so a few cheap re-plans converge.
 */
export function planArrivingAt(
  eph: Ephemeris,
  originId: string,
  destId: string,
  eventId: string,
  accelG: number,
  arriveOffsetDays = 0
): FlightPlan {
  const event = EVENTS.find((e) => e.id === eventId);
  if (!event) throw new Error(`missing timeline event: ${eventId}`);
  const targetMs = event.dateMs + arriveOffsetDays * 86_400_000;
  let departMs = targetMs - 7 * 86_400_000;
  let plan = planFlight(eph, originId, destId, new Date(departMs), accelG);
  for (let i = 0; i < 8; i++) {
    const miss = plan.arrive.getTime() - targetMs;
    if (Math.abs(miss) < 3_600_000) break;
    departMs -= miss;
    plan = planFlight(eph, originId, destId, new Date(departMs), accelG);
  }
  return plan;
}

/**
 * Ride pacing used by the ride button: quick hops play out in ~30 s, long
 * hauls stretch toward 2.5 min so the scale of the trip registers.
 */
export function standardRideSpeed(plan: FlightPlan): number {
  const days = plan.travelTimeSec / 86_400;
  return days / Math.min(Math.max(days * 9, 30), 150);
}
