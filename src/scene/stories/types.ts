/**
 * Story scenario registry types. A story is either a "flight" (a FlightPlan
 * ridden with a scripted comm log — Miller, Epstein) or a "watch" (no ship:
 * focus a body, set the clock to a timeline event, and let it play — Eros
 * leaving its orbit). Adding a story means one module in this directory and
 * one entry in the STORIES array; nothing else in the app names story ids.
 */
import type { Ephemeris } from "../../ephemeris";
import type { FlightPlan, HonestyMode } from "../../planner";
import type { CommLine } from "../commlog";

interface StoryBase {
  /** stable key: store.scenario value + analytics event name */
  id: string;
  /** menu button text, glyph included */
  label: string;
  /** book number 1..6, same scale as events.json `spoiler` */
  spoiler: number;
}

export interface FlightStory extends StoryBase {
  kind: "flight";
  /** Build the flight. May throw (ephemeris range); `errorText` shows then. */
  build(eph: Ephemeris, ctx: { honesty: HonestyMode; nowMs: number }): FlightPlan;
  script: CommLine[];
  /** hull shown during the ride; omit to keep whatever is selected */
  shipId?: string;
  /** stated g for the console (pre-honesty; the plan carries effective g) */
  statedG?: number;
  /** sync origin/dest/g into the nav console so the result card matches */
  syncConsole?: boolean;
  /** no-flip runaway burn: HUD shows RUNAWAY BURN + fuel, ends at the flip */
  runawayBurn?: boolean;
  /** ending card instead of the docking epilogue */
  epitaphHtml?: string;
  /**
   * When to cut to the epitaph, as a fraction of travel time. Defaults to
   * the flip (fuel-out) for runaway burns; set explicitly for stories that
   * end before their planned arrival (a flight that never docks).
   */
  epitaphAtFrac?: number;
  /** chase-cam override; defaults to the generic route-framing ride seat */
  seat?: { pitch?: number; distKm?: number };
  /** ride pacing; default standardRideSpeed(plan) */
  speedDaysPerSec?(plan: FlightPlan): number;
  /** camera focus after "release couch"; default plan.destId */
  exitFocusId?: string;
  /** shown in the nav console when build() throws */
  errorText?: string;
}

export interface WatchStory extends StoryBase {
  kind: "watch";
  /** body the camera follows */
  focusId: string;
  /** timeline event id where the clock starts */
  startEventId: string;
  /** optional timeline event id where playback auto-pauses */
  endEventId?: string;
  speedDaysPerSec: number;
}

export type StoryScenario = FlightStory | WatchStory;
