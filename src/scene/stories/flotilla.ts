/**
 * To the Ring — Abaddon's Gate. The Rocinante, with a documentary crew
 * aboard nobody wanted, joins the combined Earth-Mars-OPA flotilla out to
 * the structure hanging beyond the orbit of Uranus. The ride ends at the
 * threshold: nothing in this chart crosses it.
 */
import { effectiveAccelG } from "../../planner";
import type { CommLine } from "../commlog";
import { planArrivingAt } from "./helpers";
import type { FlightStory } from "./types";

const FLOTILLA_G = 1;

const FLOTILLA_SCRIPT: CommLine[] = [
  { at: 0.001, text: "Tycho control: Rocinante away. You're really going out there, kopeng?" },
  { at: 0.04, text: "Holden: full house this trip. Documentary crew. Cameras in my galley." },
  { at: 0.15, text: "Alex: flotilla's forming up. Behemoth's on the board — biggest thing humans ever built." },
  { at: 0.3, text: "Naomi: two years since Venus went quiet. Now this. Nobody knows what it is." },
  { at: 0.46, text: "Alex: turnover. Long fall the rest of the way out." },
  { at: 0.485, text: "ALL HANDS: brace for flip." },
  { at: 0.515, text: "Alex: flip done. Braking for the Ring." },
  { at: 0.7, text: "comms: UN, MCR and OPA hulls all holding formation. First time for everything." },
  { at: 0.88, text: "Amos: so what happens if something goes through it?" },
  { at: 0.93, text: "Holden: a kid on a slingshot run already found out. Nobody wants to be second." },
  { at: 0.96, text: "nav: slow approach. Nobody knows what that thing does, sasa ke?" },
  { at: 0.999, text: "nav: all stop. Station-keeping at the threshold." },
];

export const FLOTILLA: FlightStory = {
  kind: "flight",
  id: "flotilla",
  label: "◎ To the Ring",
  spoiler: 3,
  build: (eph, { honesty }) =>
    planArrivingAt(eph, "tycho", "ring", "ring-flotilla", effectiveAccelG(FLOTILLA_G, honesty)),
  script: FLOTILLA_SCRIPT,
  shipId: "corvette",
  statedG: FLOTILLA_G,
  syncConsole: true,
  errorText: "Couldn't plan the flotilla run on this ephemeris.",
};
