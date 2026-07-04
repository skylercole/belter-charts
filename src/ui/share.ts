/**
 * Shareable plans (Plan.md 9): the full planner state lives in the query
 * string — origin, destination, hull, g, honesty mode, departure time.
 * No backend; the link re-plans on load.
 */
import { BODY_BY_ID } from "../data/bodies";
import { SHIP_BY_ID } from "../data/ships";
import type { AppState } from "./store";

export interface ShareState {
  originId: string;
  destId: string;
  shipId: string;
  accelG: number;
  honesty: "honest" | "canon";
  timeMs: number;
}

export function buildShareUrl(s: AppState): string {
  const p = new URLSearchParams({
    o: s.originId,
    d: s.destId,
    hull: s.shipId,
    g: String(s.accelG),
    mode: s.honesty,
    t: new Date(s.plan?.depart.getTime() ?? s.timeMs).toISOString().slice(0, 16),
  });
  return `${location.origin}${location.pathname}?${p}`;
}

/** Parse and validate share params; null if the URL carries no plan. */
export function parseShareUrl(search: string): ShareState | null {
  const p = new URLSearchParams(search);
  const o = p.get("o");
  const d = p.get("d");
  if (!o || !d) return null;
  if (!BODY_BY_ID.has(o) || !BODY_BY_ID.has(d) || o === d) return null;

  const hull = p.get("hull") ?? "hauler";
  const ship = SHIP_BY_ID.get(hull) ?? SHIP_BY_ID.get("hauler")!;
  let g = Number(p.get("g"));
  if (!Number.isFinite(g) || g <= 0) g = ship.defaultG;
  g = Math.min(Math.max(g, 0.01), ship.gPresets[ship.gPresets.length - 1]);

  const mode = p.get("mode") === "canon" ? "canon" : "honest";
  const t = Date.parse(p.get("t") ?? "");

  return {
    originId: o,
    destId: d,
    shipId: ship.id,
    accelG: g,
    honesty: mode,
    timeMs: Number.isFinite(t) ? t : Date.UTC(2350, 0, 1),
  };
}
