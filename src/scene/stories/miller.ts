/**
 * Miller's ride — story scenario after Leviathan Wakes. Detective Miller,
 * off the Star Helix payroll and unable to drop the Julie Mao case, buys
 * one-way passage from Ceres to Eros. The flight is timed so the transport
 * docks right as the Eros incident begins (timeline event, day 75).
 *
 * Mechanically a normal flight plan (real intercept, real docking) — only
 * the comm chatter is scripted.
 */
import { effectiveAccelG } from "../../planner";
import type { CommLine } from "../commlog";
import { planArrivingAt } from "./helpers";
import type { FlightStory } from "./types";

/** budget-transport burn: Miller flew coach */
export const MILLER_G = 0.3;

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

export const MILLER: FlightStory = {
  kind: "flight",
  id: "miller",
  label: "◍ Miller's ride to Eros",
  spoiler: 1,
  build: (eph, { honesty }) =>
    planArrivingAt(eph, "ceres", "eros", "eros-incident", effectiveAccelG(MILLER_G, honesty)),
  script: MILLER_SCRIPT,
  statedG: MILLER_G,
  syncConsole: true,
  // Close to the vessel and high above the ecliptic — a top-and-side view
  // of the transport instead of the far route-framing chart seat.
  seat: { pitch: 0.55, distKm: 6e6 },
  errorText: "Couldn't plan Miller's ride on this ephemeris.",
};
