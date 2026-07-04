/**
 * Canon timeline layer (Plan.md 8): events with dates resolved against the
 * calendar anchor, plus a decorated ephemeris that applies event-driven
 * reality edits:
 *
 * - Eros leaves its orbit at the "eros-burn" event and flies a powered,
 *   ever-accelerating arc to where Venus will be at impact; after
 *   "eros-impact" it no longer exists.
 * - The Ring does not exist before "ring-appears".
 *
 * Trajectory model for the burn (ASSUMPTIONS.md): straight chord from
 * Eros's real position at departure to Venus's real position at impact,
 * with an acceleration-only profile f = (t/T)^2 — the rock is still gaining
 * speed when it hits. Canon describes erratic high-g maneuvering no physics
 * model explains; the chord is an editorial simplification.
 */
import rawEvents from "../data/events.json";
import { Ephemeris, type StateVector } from "../ephemeris";
import { lerp, scale, sub } from "../ephemeris/vec";

export interface CanonEvent {
  id: string;
  offsetDays: number;
  dateMs: number;
  title: string;
  spoiler: number;
  focus: string;
  bodies: string[];
  blurb: string;
  citation: string;
  hint?: string;
}

/** Calendar anchor: Leviathan Wakes opens 2350-01-01 XTE. */
export const ANCHOR_MS = Date.UTC(2350, 0, 1);

export const EVENTS: CanonEvent[] = (
  rawEvents.events as Omit<CanonEvent, "dateMs">[]
).map((e) => ({ ...e, dateMs: ANCHOR_MS + e.offsetDays * 86_400_000 }));

const EVENT_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

function eventMs(id: string): number {
  const e = EVENT_BY_ID.get(id);
  if (!e) throw new Error(`missing timeline event: ${id}`);
  return e.dateMs;
}

export class TimelineEphemeris extends Ephemeris {
  private burnStartMs = eventMs("eros-burn");
  private impactMs = eventMs("eros-impact");
  private ringMs = eventMs("ring-appears");

  constructor(private base: Ephemeris) {
    // Ephemeris keeps its small-body map private; we delegate instead of
    // sharing state, so pass an empty map upward and override everything.
    super(new Map());
  }

  override stateOf(bodyId: string, date: Date): StateVector {
    const t = date.getTime();
    if (bodyId === "eros" && t >= this.burnStartMs) {
      return this.erosOverride(t);
    }
    if (bodyId === "ring") {
      // parked once assembled; before that it "exists" only for planners
      // that never see it (existence gate hides it everywhere visible)
      return this.base.stateOf(bodyId, date);
    }
    return this.base.stateOf(bodyId, date);
  }

  override coveredRange() {
    return this.base.coveredRange();
  }

  override exists(bodyId: string, date: Date): boolean {
    const t = date.getTime();
    if (bodyId === "eros") return t < this.impactMs;
    if (bodyId === "ring") return t >= this.ringMs;
    return true;
  }

  /** Eros under protomolecule drive: chord to Venus-at-impact, f=(t/T)^2. */
  private erosOverride(tMs: number): StateVector {
    const T = this.impactMs - this.burnStartMs;
    const f = Math.min((tMs - this.burnStartMs) / T, 1);
    const depart = this.base.stateOf("eros", new Date(this.burnStartMs)).pos;
    const arrive = this.base.stateOf("venus", new Date(this.impactMs)).pos;
    const s = f * f;
    const pos = lerp(depart, arrive, s);
    // velocity = d(pos)/dt = 2f/T * chord (km/s)
    const chord = sub(arrive, depart);
    const vel = scale(chord, (2 * f) / (T / 1000));
    return { pos, vel };
  }
}
