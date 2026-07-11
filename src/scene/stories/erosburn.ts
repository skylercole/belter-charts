/**
 * Eros makes its move — Leviathan Wakes ch. 51-55. Not a flight: the
 * camera follows Eros itself as thirteen quadrillion kilograms of rock
 * and protomolecule leave orbit and fall sunward to Venus. The timeline
 * layer already flies the rock (TimelineEphemeris); this story just puts
 * the clock and the camera in the right place and lets it play.
 */
import type { WatchStory } from "./types";

export const EROSBURN: WatchStory = {
  kind: "watch",
  id: "erosburn",
  label: "◉ Eros makes its move",
  spoiler: 1,
  focusId: "eros",
  startEventId: "eros-burn",
  endEventId: "eros-impact",
  // 37 days of fall in ~25 s of wall time
  speedDaysPerSec: 1.5,
};
