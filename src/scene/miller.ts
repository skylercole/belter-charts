/**
 * Miller's ride — story scenario after Leviathan Wakes. Detective Miller,
 * off the Star Helix payroll and unable to drop the Julie Mao case, buys
 * one-way passage from Ceres to Eros. The flight is timed so the transport
 * docks right as the Eros incident begins (timeline event, day 75).
 *
 * Mechanically a normal flight plan (real intercept, real docking) — only
 * the comm chatter is scripted.
 */
import type { Ephemeris } from "../ephemeris";
import { effectiveAccelG, planFlight, type FlightPlan, type HonestyMode } from "../planner";
import { EVENTS } from "../timeline";
import type { CommLine } from "./commlog";

/** budget-transport burn: Miller flew coach */
export const MILLER_G = 0.3;

/**
 * Plan Ceres -> Eros arriving at the Eros incident. Iterates the departure
 * so the docking lands within an hour of the event (a few cheap re-plans).
 */
export function millerPlan(eph: Ephemeris, honesty: HonestyMode): FlightPlan {
  const incidentMs = EVENTS.find((e) => e.id === "eros-incident")!.dateMs;
  const accelG = effectiveAccelG(MILLER_G, honesty);
  let departMs = incidentMs - 7 * 86_400_000;
  let plan = planFlight(eph, "ceres", "eros", new Date(departMs), accelG);
  for (let i = 0; i < 6; i++) {
    const miss = plan.arrive.getTime() - incidentMs;
    if (Math.abs(miss) < 3_600_000) break;
    departMs -= miss;
    plan = planFlight(eph, "ceres", "eros", new Date(departMs), accelG);
  }
  return plan;
}

export const MILLER_SCRIPT: CommLine[] = [
  { at: 0.001, text: "Ceres dock: transport away, on the drift for Eros." },
  { at: 0.03, text: "Miller: cheap seat, recycled air. Been on worse boats." },
  { at: 0.18, text: "Miller: Star Helix took the badge back. Nobody asked for the case files." },
  { at: 0.35, text: "purser: straps stay on through the burn, kopeng. Juice costs extra back here." },
  { at: 0.46, text: "nav: turnover in a few minutes. Stow anything that floats." },
  { at: 0.485, text: "ALL HANDS: brace for flip." },
  { at: 0.515, text: "nav: flip done. Tail to Eros, braking." },
  { at: 0.75, text: "Miller: kept telling myself I'd drop it. Some cases hold on to you." },
  { at: 0.96, text: "Eros approach: hold your vector, transport. Busy day out here." },
  { at: 0.999, text: "dock: clamps on. Eros station. Everybody out." },
];
