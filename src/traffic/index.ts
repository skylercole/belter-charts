/**
 * Ambient system traffic: a deterministic, procedurally generated schedule
 * of NPC flights between the major lanes (Miller's hand-terminal plot).
 *
 * Determinism is the core invariant: every generated flight is a pure
 * function of (day slot, honesty mode, density), so scrubbing the clock
 * anywhere and back reproduces the identical traffic picture. No
 * Date.now/Math.random anywhere in this module.
 */
import { BODY_BY_ID } from "../data/bodies";
import type { Ephemeris } from "../ephemeris";
import {
  effectiveAccelG,
  planFlight,
  samplePath,
  type FlightPlan,
  type HonestyMode,
} from "../planner";
import { ERA_START_MS } from "../ui/store";
import { pickKlass, pickName } from "./names";

export interface TrafficFlight {
  /** stable id: `${slot}-${index}` */
  id: string;
  name: string;
  klass: string;
  originId: string;
  destId: string;
  departMs: number;
  arriveMs: number;
  plan: FlightPlan;
  /** faction tint (origin body color), 0-1 rgb */
  color: [number, number, number];
  /** heliocentric curved path polyline, PATH_PTS points, precomputed at gen time */
  pathPts: Float64Array;
}

export const PATH_PTS = 17;
/** hard cap on concurrently rendered flights */
export const MAX_ACTIVE = 96;
/** longest trip kept in the schedule (canon-feel haulers) */
const MAX_FLIGHT_SEC = 45 * 86_400;
/** schedule lookback window: covers MAX_FLIGHT days of departures */
const LOOKBACK_SLOTS = 45;
const DAY_MS = 86_400_000;
/** mean departures per day at density 1, canon mode */
const BASE_PER_DAY = 3;
const GLOBAL_SEED = 0x0be17a5;

/** mulberry32: tiny, well-distributed 32-bit PRNG (public domain). */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lane weights: Earth/Mars/Belt dominate, Jovian and Saturnian moons see
 * lighter service. Outer giants and the Ring get none — trips too long or
 * too silly for ambient scenery.
 */
const LANE_WEIGHTS: Array<[string, number]> = [
  ["earth", 6],
  ["mars", 6],
  ["ceres", 5],
  ["tycho", 3],
  ["luna", 2],
  ["eros", 2],
  ["ganymede", 2],
  ["pallas", 1],
  ["vesta", 1],
  ["hygiea", 1],
  ["juno", 1],
  ["anderson", 1],
  ["europa", 1],
  ["callisto", 1],
  ["io", 1],
  ["titan", 1],
];
const LANE_TOTAL = LANE_WEIGHTS.reduce((s, [, w]) => s + w, 0);

const G_CHOICES: Array<[number, number]> = [
  [0.3, 4],
  [0.5, 3],
  [1, 1],
];
const G_TOTAL = G_CHOICES.reduce((s, [, w]) => s + w, 0);

function pickLane(rng: () => number): string {
  let r = rng() * LANE_TOTAL;
  for (const [id, w] of LANE_WEIGHTS) {
    r -= w;
    if (r <= 0) return id;
  }
  return LANE_WEIGHTS[0][0];
}

function pickG(rng: () => number): number {
  let r = rng() * G_TOTAL;
  for (const [g, w] of G_CHOICES) {
    r -= w;
    if (r <= 0) return g;
  }
  return G_CHOICES[0][0];
}

/** Reject silly pairs: same body, or two moons of the same parent. */
function validPair(a: string, b: string): boolean {
  if (a === b) return false;
  const da = BODY_BY_ID.get(a);
  const db = BODY_BY_ID.get(b);
  if (da?.moon && db?.moon && da.moon.parent === db.moon.parent) return false;
  return true;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export function slotOf(timeMs: number): number {
  return Math.floor((timeMs - ERA_START_MS) / DAY_MS);
}

/** Generate one day slot's departures. Pure in (slot, honesty, density). */
export function genSlot(
  eph: Ephemeris,
  slot: number,
  honesty: HonestyMode,
  density: number
): TrafficFlight[] {
  const seed =
    (GLOBAL_SEED ^
      Math.imul(slot, 0x9e3779b1) ^
      (honesty === "honest" ? 0x55aa55aa : 0) ^
      Math.imul(Math.round(density * 2), 0x1000193)) |
    0;
  const rng = mulberry32(seed);
  const slotStart = ERA_START_MS + slot * DAY_MS;
  // Honest-mode trips are ~3.2x shorter, so depart more often to keep a
  // similar number of ships in flight at once.
  const scale = honesty === "honest" ? 2.5 : 1;
  const n = Math.round(BASE_PER_DAY * density * scale * (0.7 + 0.6 * rng()));

  const flights: TrafficFlight[] = [];
  for (let i = 0; i < n; i++) {
    const originId = pickLane(rng);
    const destId = pickLane(rng);
    // depart quantized to whole minutes
    const departMs = slotStart + Math.floor(rng() * 1440) * 60_000;
    const g = pickG(rng);
    const name = pickName(rng);
    const klass = pickKlass(rng);
    // all rng draws happen above so discards can't shift later flights
    if (!validPair(originId, destId)) continue;
    const depart = new Date(departMs);
    if (!eph.exists(originId, depart) || !eph.exists(destId, depart)) continue;
    let plan: FlightPlan;
    try {
      plan = planFlight(eph, originId, destId, depart, effectiveAccelG(g, honesty));
    } catch {
      continue; // arrival past the packed ephemeris window
    }
    if (plan.travelTimeSec > MAX_FLIGHT_SEC) continue;
    // Both endpoints must exist for the whole flight — no arrivals at a
    // destroyed Eros, and no ghosts still inbound from it either.
    if (!eph.exists(destId, plan.arrive) || !eph.exists(originId, plan.arrive)) continue;
    flights.push({
      id: `${slot}-${i}`,
      name,
      klass,
      originId,
      destId,
      departMs,
      arriveMs: departMs + plan.travelTimeSec * 1000,
      plan,
      color: hexToRgb(BODY_BY_ID.get(originId)?.color ?? "#8899aa"),
      pathPts: samplePath(plan, PATH_PTS),
    });
  }
  return flights;
}

/**
 * Sliding cache of generated day slots. Fills a lookback window around the
 * clock with a per-call budget (so a cold scrub jump amortizes over a few
 * frames), prunes what drifts out of range.
 */
export class TrafficSchedule {
  private slots = new Map<number, TrafficFlight[]>();
  private cfgKey = "";
  private scratch: TrafficFlight[] = [];

  constructor(private eph: Ephemeris) {}

  update(timeMs: number, honesty: HonestyMode, density: number, budgetSlots = 8) {
    const key = `${honesty}:${density}`;
    if (key !== this.cfgKey) {
      this.cfgKey = key;
      this.slots.clear();
    }
    const cur = slotOf(timeMs);
    let budget = budgetSlots;
    // nearest-first so on-screen ships appear before the deep lookback
    for (let d = 0; d <= LOOKBACK_SLOTS && budget > 0; d++) {
      const slot = cur - d;
      if (slot < 0) break;
      if (!this.slots.has(slot)) {
        this.slots.set(slot, genSlot(this.eph, slot, honesty, density));
        budget--;
      }
    }
    for (const k of this.slots.keys()) {
      if (k < cur - LOOKBACK_SLOTS - 5 || k > cur + 2) this.slots.delete(k);
    }
  }

  /** Flights in the air at timeMs, deterministically capped at MAX_ACTIVE. */
  active(timeMs: number): TrafficFlight[] {
    const out = this.scratch;
    out.length = 0;
    for (const flights of this.slots.values()) {
      for (const f of flights) {
        if (f.departMs <= timeMs && timeMs < f.arriveMs) out.push(f);
      }
    }
    out.sort((a, b) => a.departMs - b.departMs || (a.id < b.id ? -1 : 1));
    if (out.length > MAX_ACTIVE) out.length = MAX_ACTIVE;
    return out;
  }
}
