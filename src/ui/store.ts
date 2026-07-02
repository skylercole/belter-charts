/** App state: one vanilla Zustand store, no framework. */
import { createStore } from "zustand/vanilla";
import type { FlightPlan } from "../planner";

export interface AppState {
  /** current sim time, ms since epoch */
  timeMs: number;
  playing: boolean;
  /** sim days per real-time second while playing */
  speedDaysPerSec: number;
  originId: string;
  destId: string;
  accelG: number;
  plan: FlightPlan | null;

  setTime(ms: number): void;
  togglePlaying(): void;
  setSpeed(d: number): void;
  setOrigin(id: string): void;
  setDest(id: string): void;
  setAccel(g: number): void;
  setPlan(plan: FlightPlan | null): void;
}

/** Era the UI can scrub; matches the packed small-body coverage with margin. */
export const ERA_START_MS = Date.UTC(2340, 0, 2);
export const ERA_END_MS = Date.UTC(2364, 11, 31);
/** Default clock: Leviathan Wakes opening per ASSUMPTIONS.md calendar anchor. */
export const ERA_DEFAULT_MS = Date.UTC(2350, 0, 1);

export const store = createStore<AppState>()((set) => ({
  timeMs: ERA_DEFAULT_MS,
  playing: false,
  speedDaysPerSec: 2,
  originId: "earth",
  destId: "ceres",
  accelG: 0.3,
  plan: null,

  setTime: (ms) =>
    set({ timeMs: Math.min(Math.max(ms, ERA_START_MS), ERA_END_MS) }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (d) => set({ speedDaysPerSec: d }),
  setOrigin: (id) => set({ originId: id, plan: null }),
  setDest: (id) => set({ destId: id, plan: null }),
  setAccel: (g) => set({ accelG: g, plan: null }),
  setPlan: (plan) => set({ plan }),
}));
