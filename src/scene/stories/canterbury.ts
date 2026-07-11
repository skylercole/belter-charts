/**
 * The Canterbury's last haul — Leviathan Wakes ch. 1-4. The ice hauler
 * Canterbury runs Saturn ice to Ceres and answers a distress call from the
 * Scopuli — a legal obligation and a trap. There is no explosion to render;
 * the ride cuts to an epitaph as the torpedoes arrive, the way the book
 * cuts away from the light.
 *
 * Editorial: the diversion to CA-2216862 isn't modeled — the flight flies
 * the Saturn-Ceres line and ends where the timeline says the Cant died.
 */
import { effectiveAccelG } from "../../planner";
import type { CommLine } from "../commlog";
import { planArrivingAt } from "./helpers";
import type { FlightStory } from "./types";

const CANT_G = 0.3;

const CANTERBURY_SCRIPT: CommLine[] = [
  { at: 0.001, text: "Saturn ops: Canterbury away, full racks of ice. See you next season." },
  { at: 0.05, text: "McDowell: steady as she goes. Fifty thousand tons of water for Ceres." },
  { at: 0.25, text: "Holden: XO's log. Nothing to report. That's how we like it out here." },
  { at: 0.46, text: "nav: turnover coming up. Secure the racks, ke?" },
  { at: 0.485, text: "ALL HANDS: brace for flip." },
  { at: 0.515, text: "nav: flip done. Tail-first for Ceres, braking." },
  { at: 0.72, text: "comms: Ceres traffic has our vector. Right down the well-worn groove." },
  { at: 0.86, text: "comms: distress beacon. Light freighter Scopuli, off asteroid CA-2216862." },
  { at: 0.885, text: "McDowell: we're the closest hull. Law says we look. Holden, log it." },
  { at: 0.91, text: "Holden: taking the Knight over. Five of us. Back before the coffee's cold." },
  { at: 0.93, text: "Knight: Cant, we have a contact — ship on the scope that wasn't there. Cant, respond!" },
];

const CANTERBURY_EPITAPH = `
  <h2>Remember the Cant</h2>
  <p>The torpedoes came from a ship that no transponder claimed and no
  scope had seen. The Canterbury and her crew became light and vapor;
  the five aboard the Knight survived to tell the system who fired first
  — and to light the fuse of everything that followed.</p>
  <p class="src">— scenario after Leviathan Wakes ch. 1-4; the diversion to
  CA-2216862 is simplified onto the Saturn-Ceres line, see ASSUMPTIONS.md</p>
`;

export const CANTERBURY: FlightStory = {
  kind: "flight",
  id: "canterbury",
  label: "❆ The Canterbury's last haul",
  spoiler: 1,
  build: (eph, { honesty }) =>
    planArrivingAt(eph, "saturn", "ceres", "canterbury", effectiveAccelG(CANT_G, honesty)),
  script: CANTERBURY_SCRIPT,
  shipId: "hauler",
  statedG: CANT_G,
  syncConsole: true,
  epitaphHtml: CANTERBURY_EPITAPH,
  epitaphAtFrac: 0.94,
  exitFocusId: "ceres",
  errorText: "Couldn't plan the Cant's run on this ephemeris.",
};
