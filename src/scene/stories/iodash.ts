/**
 * The Io dash — Caliban's War. Chrisjen Avasarala, effectively a prisoner
 * on a yacht, transfers to Julie Mao's old racing pinnace and burns for Io
 * hard enough that the juice is the only thing keeping her alive, running
 * the whole system's politics from a crash couch on the way.
 */
import { effectiveAccelG } from "../../planner";
import type { CommLine } from "../commlog";
import { planArrivingAt } from "./helpers";
import type { FlightStory } from "./types";

const IODASH_G = 5;

const IODASH_SCRIPT: CommLine[] = [
  { at: 0.001, text: "Luna control: Razorback, you are... already gone. Copy." },
  { at: 0.004, text: "medical: juice administered. Try to breathe normal, sasa ke?" },
  { at: 0.03, text: "Avasarala: I am eighty-two years old and this g*ddamn couch is trying to kill me." },
  { at: 0.15, text: "Bobbie: she'll hold together. Mao built her to win races, not to be comfortable." },
  { at: 0.3, text: "Avasarala: half the fleet answers to a man I am going to bury. Keep burning." },
  { at: 0.46, text: "Bobbie: turnover. This is the easy part, ma'am. Enjoy the float." },
  { at: 0.485, text: "ALL HANDS: brace for flip." },
  { at: 0.515, text: "Bobbie: flip done. Braking at the same g. Sorry." },
  { at: 0.7, text: "comms: UN and MCR hulls converging on Io. Nobody's blinking." },
  { at: 0.9, text: "Avasarala: patch me through to every captain out there. Time to ruin some careers." },
  { at: 0.96, text: "Io approach: Razorback, hold your vector. You're flying into a war zone." },
  { at: 0.999, text: "Bobbie: skids down. Welcome to Io, madam secretary." },
];

export const IODASH: FlightStory = {
  kind: "flight",
  id: "iodash",
  label: "➤ The Io dash",
  spoiler: 2,
  build: (eph, { honesty }) =>
    planArrivingAt(eph, "luna", "io", "io", effectiveAccelG(IODASH_G, honesty)),
  script: IODASH_SCRIPT,
  shipId: "pinnace",
  statedG: IODASH_G,
  syncConsole: true,
  errorText: "Couldn't plan the Io dash on this ephemeris.",
};
