/** Traffic layer invariants: determinism, plausible density, timeline gates. */
import { describe, expect, it } from "vitest";
import { loadEphemerisFromDisk } from "../ephemeris/testutil";
import { EVENTS, TimelineEphemeris } from "../timeline";
import { ERA_END_MS, ERA_START_MS } from "../ui/store";
import { genSlot, slotOf, TrafficSchedule } from "./index";

const eph = new TimelineEphemeris(loadEphemerisFromDisk());

/** run enough budgeted updates to fully fill the lookback window */
function fill(s: TrafficSchedule, timeMs: number, honesty: "honest" | "canon", density = 1) {
  for (let i = 0; i < 12; i++) s.update(timeMs, honesty, density);
}

describe("traffic schedule", () => {
  const t0 = Date.UTC(2351, 5, 15);

  it("is deterministic: same params reproduce identical flights", () => {
    const a = new TrafficSchedule(eph);
    const b = new TrafficSchedule(eph);
    fill(a, t0, "canon");
    fill(b, t0, "canon");
    const fa = a.active(t0);
    const fb = b.active(t0);
    expect(fa.length).toBe(fb.length);
    for (let i = 0; i < fa.length; i++) {
      expect(fa[i].id).toBe(fb[i].id);
      expect(fa[i].name).toBe(fb[i].name);
      expect(fa[i].departMs).toBe(fb[i].departMs);
      expect(fa[i].arriveMs).toBe(fb[i].arriveMs);
      expect(fa[i].originId).toBe(fb[i].originId);
      expect(fa[i].destId).toBe(fb[i].destId);
    }
  });

  it("survives prune/refill: scrub away and back reproduces the same picture", () => {
    const s = new TrafficSchedule(eph);
    fill(s, t0, "canon");
    const before = s.active(t0).map((f) => f.id);
    // jump two years out (prunes everything), then back
    fill(s, t0 + 730 * 86_400_000, "canon");
    fill(s, t0, "canon");
    const after = s.active(t0).map((f) => f.id);
    expect(after).toEqual(before);
  });

  it("keeps concurrency in a plausible ambient band across the era", () => {
    const s = new TrafficSchedule(eph);
    const samples = [
      Date.UTC(2342, 2, 1),
      Date.UTC(2348, 7, 1),
      Date.UTC(2353, 1, 1),
      Date.UTC(2360, 10, 1),
    ];
    for (const t of samples) {
      fill(s, t, "canon");
      const n = s.active(t).length;
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(96);
    }
  });

  it("honest mode stays in a similar band", () => {
    const s = new TrafficSchedule(eph);
    const t = Date.UTC(2352, 3, 1);
    fill(s, t, "honest");
    const n = s.active(t).length;
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(96);
  });

  it("never schedules Eros flights that span the impact", () => {
    const impactMs = EVENTS.find((e) => e.id === "eros-impact")!.dateMs;
    // scan slots leading up to and past the impact
    for (let d = -50; d <= 5; d++) {
      const slot = slotOf(impactMs) + d;
      if (slot < 0) continue;
      for (const f of genSlot(eph, slot, "canon", 1)) {
        if (f.originId === "eros" || f.destId === "eros") {
          expect(f.arriveMs).toBeLessThanOrEqual(impactMs);
        }
      }
    }
  });

  it("keeps flights inside the era and under the trip cap", () => {
    const s = new TrafficSchedule(eph);
    const t = Date.UTC(2350, 0, 20);
    fill(s, t, "canon");
    for (const f of s.active(t)) {
      expect(f.departMs).toBeGreaterThanOrEqual(ERA_START_MS);
      expect(f.arriveMs - f.departMs).toBeLessThanOrEqual(45 * 86_400_000);
      expect(f.arriveMs).toBeLessThanOrEqual(ERA_END_MS + 46 * 86_400_000);
      expect(f.pathPts.length).toBe(51);
      expect(f.name.length).toBeGreaterThan(2);
    }
  });
});
