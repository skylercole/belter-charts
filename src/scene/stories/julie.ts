/**
 * Julie's last run — the flight that opens Leviathan Wakes' prologue from
 * the other side: an OPA errand out toward Saturn to shadow a ship that
 * wasn't supposed to exist. The comms go silent long before any dock.
 *
 * Editorial: Julie crewed the freighter Scopuli when the Anubis took her;
 * her own racing pinnace stands in for the ride so there's a hull to see.
 */
import { effectiveAccelG } from "../../planner";
import type { CommLine } from "../commlog";
import { planArrivingAt } from "./helpers";
import type { FlightStory } from "./types";

const JULIE_G = 2;

const JULIE_SCRIPT: CommLine[] = [
  { at: 0.001, text: "Ceres dock: cleared for departure. Flight plan says survey run. Sure it does." },
  { at: 0.05, text: "Julie: Dad bought me this boat to keep me quiet. Joke's on him." },
  { at: 0.2, text: "Julie: the cell says a ship came off the books at the Bush yards. We find out why." },
  { at: 0.46, text: "nav: turnover. Stow anything loose, ke?" },
  { at: 0.485, text: "ALL HANDS: brace for flip." },
  { at: 0.515, text: "nav: flip done. Braking toward the rendezvous." },
  { at: 0.68, text: "Julie: contact on the scope — there and gone. Nothing should be able to do that." },
  { at: 0.76, text: "Julie: it's turning toward us. Painting us. Sending our position home—" },
];

const JULIE_EPITAPH = `
  <h2>The silence off Saturn</h2>
  <p>The ship that took her had no transponder and a hold full of something
  that was not cargo. Weeks later an ice hauler answered a distress beacon
  from her stranded freighter, and the system started coming apart. Julie
  Mao fought longer, and mattered more, than anyone knew.</p>
  <p class="src">— scenario after Leviathan Wakes (prologue); Julie flew
  aboard the Scopuli — her Razorback stands in, see ASSUMPTIONS.md</p>
`;

export const JULIE: FlightStory = {
  kind: "flight",
  id: "julie",
  label: "✦ Julie's last run",
  spoiler: 1,
  build: (eph, { honesty }) =>
    // Goes dark days before the Canterbury finds what's left.
    planArrivingAt(eph, "ceres", "saturn", "canterbury", effectiveAccelG(JULIE_G, honesty), -6),
  script: JULIE_SCRIPT,
  shipId: "pinnace",
  statedG: JULIE_G,
  syncConsole: true,
  epitaphHtml: JULIE_EPITAPH,
  epitaphAtFrac: 0.8,
  exitFocusId: "saturn",
  errorText: "Couldn't plan Julie's run on this ephemeris.",
};
