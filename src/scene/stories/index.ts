/**
 * Story registry. Menu order = array order. Adding a story: one module in
 * this directory, one entry here — the menu, launcher, HUD and camera all
 * read from the entry.
 */
import { CANTERBURY } from "./canterbury";
import { EPSTEIN } from "./epstein";
import { EROSBURN } from "./erosburn";
import { FLOTILLA } from "./flotilla";
import { IODASH } from "./iodash";
import { JULIE } from "./julie";
import { MILLER } from "./miller";
import type { StoryScenario } from "./types";

export const STORIES: StoryScenario[] = [
  EPSTEIN,
  JULIE,
  CANTERBURY,
  MILLER,
  EROSBURN,
  IODASH,
  FLOTILLA,
];

export const STORY_BY_ID = new Map(STORIES.map((s) => [s.id, s]));

export type { FlightStory, StoryScenario, WatchStory } from "./types";
