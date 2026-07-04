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
  /** Mean radius, km. Drives mesh size and camera framing in the 3D view. */
  radiusKm: number;
  /** Texture file under /textures, if any. */
  texture?: string;
  /** Polar-to-equatorial flattening applied to the sphere mesh (z scale). */
  polarScale?: number;
  /** Sidereal spin period in hours (visual only). */
  spinHours?: number;
  /** Saturn-style ring, radii in km. */
  ring?: { innerKm: number; outerKm: number; texture: string };
  /** Packed mesh under /models instead of a sphere. */
  model?: string;
  /** For stations: parent body id and mean-anomaly offset in degrees. */
  station?: { parent: string; offsetDeg: number };
}

export const BODIES: BodyDef[] = [
  { id: "sun", name: "Sol", kind: "star", color: "#ffd27d", periodDays: 0, radiusKm: 695_700, texture: "sun.jpg" },
  { id: "mercury", name: "Mercury", kind: "planet", color: "#9c9691", periodDays: 88, radiusKm: 2439.7, texture: "mercury.jpg", spinHours: 1407.6 },
  { id: "venus", name: "Venus", kind: "planet", color: "#e6c99a", periodDays: 224.7, radiusKm: 6051.8, texture: "venus.jpg", spinHours: -5832.5 },
  { id: "earth", name: "Earth", kind: "planet", color: "#5b8dd9", periodDays: 365.25, radiusKm: 6371, texture: "earth.jpg", spinHours: 23.93 },
  { id: "mars", name: "Mars", kind: "planet", color: "#d1603d", periodDays: 687, radiusKm: 3389.5, texture: "mars.jpg", spinHours: 24.62 },
  { id: "jupiter", name: "Jupiter", kind: "planet", color: "#c9a06c", periodDays: 4333, radiusKm: 69_911, texture: "jupiter.jpg", polarScale: 0.935, spinHours: 9.93 },
  {
    id: "saturn", name: "Saturn", kind: "planet", color: "#d8bd8a", periodDays: 10_759, radiusKm: 58_232,
    texture: "saturn.jpg", polarScale: 0.902, spinHours: 10.7,
    ring: { innerKm: 74_500, outerKm: 140_220, texture: "saturn_ring.png" },
  },
  { id: "uranus", name: "Uranus", kind: "planet", color: "#9fd0d4", periodDays: 30_687, radiusKm: 25_362, texture: "uranus.jpg", spinHours: -17.24 },
  { id: "neptune", name: "Neptune", kind: "planet", color: "#6081d6", periodDays: 60_190, radiusKm: 24_622, texture: "neptune.jpg", spinHours: 16.11 },
  { id: "ceres", name: "Ceres", kind: "smallbody", color: "#b8b2a8", periodDays: 1682, radiusKm: 469.7, texture: "ceres.jpg", polarScale: 0.927, spinHours: 9.07 },
  { id: "eros", name: "Eros", kind: "smallbody", color: "#c98c66", periodDays: 643, radiusKm: 8.4, model: "eros.fnm", spinHours: 5.27 },
  { id: "vesta", name: "Vesta", kind: "smallbody", color: "#a89f8e", periodDays: 1325, radiusKm: 262.7, spinHours: 5.34 },
  { id: "pallas", name: "Pallas", kind: "smallbody", color: "#8f9aa3", periodDays: 1686, radiusKm: 256, spinHours: 7.81 },
  { id: "hygiea", name: "Hygiea", kind: "smallbody", color: "#7d7a74", periodDays: 2030, radiusKm: 217, spinHours: 13.83 },
  { id: "juno", name: "Juno", kind: "smallbody", color: "#a3917c", periodDays: 1593, radiusKm: 123, spinHours: 7.21 },
  {
    id: "tycho",
    name: "Tycho Station",
    kind: "station",
    color: "#7fd4a8",
    periodDays: 1682,
    radiusKm: 2.5,
    station: { parent: "ceres", offsetDeg: 60 },
  },
  {
    id: "anderson",
    name: "Anderson Station",
    kind: "station",
    color: "#d47fb8",
    periodDays: 1682,
    radiusKm: 1.2,
    station: { parent: "ceres", offsetDeg: 180 },
  },
];

export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));

/** Bodies selectable as planner origin/destination. */
export const ROUTE_BODIES = BODIES.filter((b) => b.kind !== "star");
