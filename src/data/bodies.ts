/**
 * Body registry. Rendering metadata plus how each body's state is sourced.
 * periodDays drives orbit-path sampling in the map view (approximate values
 * are fine; they only control how far the orbit line is traced).
 */

export type BodyKind = "star" | "planet" | "smallbody" | "station";

export interface BodyDef {
  id: string;
  name: string;
  kind: BodyKind;
  color: string;
  /** Approximate orbital period, days. 0 for the Sun. */
  periodDays: number;
  /** For stations: parent body id and mean-anomaly offset in degrees. */
  station?: { parent: string; offsetDeg: number };
}

export const BODIES: BodyDef[] = [
  { id: "sun", name: "Sol", kind: "star", color: "#ffd27d", periodDays: 0 },
  { id: "mercury", name: "Mercury", kind: "planet", color: "#9c9691", periodDays: 88 },
  { id: "venus", name: "Venus", kind: "planet", color: "#e6c99a", periodDays: 224.7 },
  { id: "earth", name: "Earth", kind: "planet", color: "#5b8dd9", periodDays: 365.25 },
  { id: "mars", name: "Mars", kind: "planet", color: "#d1603d", periodDays: 687 },
  { id: "jupiter", name: "Jupiter", kind: "planet", color: "#c9a06c", periodDays: 4333 },
  { id: "saturn", name: "Saturn", kind: "planet", color: "#d8bd8a", periodDays: 10759 },
  { id: "uranus", name: "Uranus", kind: "planet", color: "#9fd0d4", periodDays: 30687 },
  { id: "neptune", name: "Neptune", kind: "planet", color: "#6081d6", periodDays: 60190 },
  { id: "ceres", name: "Ceres", kind: "smallbody", color: "#b8b2a8", periodDays: 1682 },
  { id: "eros", name: "Eros", kind: "smallbody", color: "#c98c66", periodDays: 643 },
  { id: "vesta", name: "Vesta", kind: "smallbody", color: "#a89f8e", periodDays: 1325 },
  { id: "pallas", name: "Pallas", kind: "smallbody", color: "#8f9aa3", periodDays: 1686 },
  { id: "hygiea", name: "Hygiea", kind: "smallbody", color: "#7d7a74", periodDays: 2030 },
  { id: "juno", name: "Juno", kind: "smallbody", color: "#a3917c", periodDays: 1593 },
  {
    id: "tycho",
    name: "Tycho Station",
    kind: "station",
    color: "#7fd4a8",
    periodDays: 1682,
    station: { parent: "ceres", offsetDeg: 60 },
  },
  {
    id: "anderson",
    name: "Anderson Station",
    kind: "station",
    color: "#d47fb8",
    periodDays: 1682,
    station: { parent: "ceres", offsetDeg: 180 },
  },
];

export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));

/** Bodies selectable as planner origin/destination. */
export const ROUTE_BODIES = BODIES.filter((b) => b.kind !== "star");
