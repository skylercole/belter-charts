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
  shipId: string;
  accelG: number;
  /** physics honesty toggle: stated g vs canon-feel (g/10) */
  honesty: "honest" | "canon";
  plan: FlightPlan | null;
  /** ride-the-burn chase-cam mode; plan is guaranteed non-null while true */
  ride: boolean;
  /** first-person view while riding */
  cockpit: boolean;
  /** active story scenario */
  scenario: "epstein" | null;
  /** tightbeam pulse in flight: sim time it left the origin */
  beamStartMs: number | null;
  muted: boolean;
  /** onboarding spotlight tour is on screen */
  tourOpen: boolean;

  setTime(ms: number): void;
  togglePlaying(): void;
  setPlaying(p: boolean): void;
  setSpeed(d: number): void;
  setOrigin(id: string): void;
  setDest(id: string): void;
  setShip(id: string): void;
  setAccel(g: number): void;
  setHonesty(m: "honest" | "canon"): void;
  setPlan(plan: FlightPlan | null): void;
  setRide(r: boolean): void;
  setCockpit(c: boolean): void;
  setScenario(s: "epstein" | null): void;
  fireBeam(): void;
  clearBeam(): void;
  toggleMuted(): void;
  setTourOpen(v: boolean): void;
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
  shipId: "corvette",
  accelG: 1,
  honesty: "canon",
  plan: null,
  ride: false,
  cockpit: false,
  scenario: null,
  beamStartMs: null,
  muted: false,
  tourOpen: false,

  setTime: (ms) =>
    set({ timeMs: Math.min(Math.max(ms, ERA_START_MS), ERA_END_MS) }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (d) => set({ speedDaysPerSec: d }),
  setOrigin: (id) => set({ originId: id, plan: null, ride: false, beamStartMs: null }),
  setDest: (id) => set({ destId: id, plan: null, ride: false, beamStartMs: null }),
  setShip: (id) => set({ shipId: id, plan: null, ride: false }),
  setAccel: (g) => set({ accelG: g, plan: null, ride: false }),
  setHonesty: (m) => set({ honesty: m, plan: null, ride: false }),
  setPlan: (plan) => set({ plan, ride: false, scenario: null }),
  setRide: (r) => set(r ? { ride: r } : { ride: r, scenario: null }),
  setCockpit: (c) => set({ cockpit: c }),
  setScenario: (s) => set({ scenario: s }),
  fireBeam: () => set((s) => ({ beamStartMs: s.timeMs })),
  clearBeam: () => set({ beamStartMs: null }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  setTourOpen: (v) => set({ tourOpen: v }),
}));
