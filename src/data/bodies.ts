/**
 * Body registry. Rendering metadata plus how each body's state is sourced.
 * periodDays drives orbit-path sampling in the map view (approximate values
 * are fine; they only control how far the orbit line is traced).
 */

export type BodyKind =
  | "star"
  | "planet"
  | "moon"
  | "smallbody"
  | "station"
  | "construct";

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
  /** Multiplied under the texture (tints grayscale mosaics). */
  mapTint?: string;
  /** Polar-to-equatorial flattening applied to the sphere mesh (z scale). */
  polarScale?: number;
  /** Focus framing distance, km (default 6 radii). Set to frame moon systems. */
  focusDistKm?: number;
  /** Sidereal spin period in hours (visual only). */
  spinHours?: number;
  /** Saturn-style ring, radii in km. */
  ring?: { innerKm: number; outerKm: number; texture: string };
  /** Packed mesh under /models instead of a sphere. */
  model?: string;
  /** For stations: parent body id and mean-anomaly offset in degrees. */
  station?: { parent: string; offsetDeg: number };
  /** For constructs: fixed circular heliocentric orbit. */
  construct?: { radiusAu: number; phaseDeg: number };
  /**
   * For moons: parent body plus either an astronomy-engine model ("luna" or
   * a Galilean name) or a circular Kepler orbit around the parent
   * (negative periodDays = retrograde). Kepler phases are arbitrary; see
   * ASSUMPTIONS.md.
   */
  moon?: {
    parent: string;
    engine?: "luna" | "io" | "europa" | "ganymede" | "callisto";
    kepler?: { aKm: number; periodDays: number; phaseDeg: number };
  };
}

export const BODIES: BodyDef[] = [
  { id: "sun", name: "Sol", kind: "star", color: "#ffd27d", periodDays: 0, radiusKm: 695_700, texture: "sun.jpg" },
  { id: "mercury", name: "Mercury", kind: "planet", color: "#9c9691", periodDays: 88, radiusKm: 2439.7, texture: "mercury.jpg", spinHours: 1407.6 },
  { id: "venus", name: "Venus", kind: "planet", color: "#e6c99a", periodDays: 224.7, radiusKm: 6051.8, texture: "venus.jpg", spinHours: -5832.5 },
  { id: "earth", name: "Earth", kind: "planet", color: "#5b8dd9", periodDays: 365.25, radiusKm: 6371, texture: "earth.jpg", spinHours: 23.93, focusDistKm: 520_000 },
  { id: "luna", name: "Luna", kind: "moon", color: "#b8bcc4", periodDays: 27.32, radiusKm: 1737.4, texture: "moon.jpg", spinHours: 655.7, moon: { parent: "earth", engine: "luna" } },
  { id: "mars", name: "Mars", kind: "planet", color: "#d1603d", periodDays: 687, radiusKm: 3389.5, texture: "mars.jpg", spinHours: 24.62, focusDistKm: 34_000 },
  { id: "phobos", name: "Phobos", kind: "moon", color: "#9a8f85", periodDays: 0.319, radiusKm: 11.3, spinHours: 7.66, model: "phobos.fnm", moon: { parent: "mars", kepler: { aKm: 9376, periodDays: 0.3189, phaseDeg: 0 } } },
  { id: "deimos", name: "Deimos", kind: "moon", color: "#a89d92", periodDays: 1.263, radiusKm: 6.2, spinHours: 30.3, model: "deimos.fnm", moon: { parent: "mars", kepler: { aKm: 23_463, periodDays: 1.2624, phaseDeg: 120 } } },
  { id: "jupiter", name: "Jupiter", kind: "planet", color: "#c9a06c", periodDays: 4333, radiusKm: 69_911, texture: "jupiter.jpg", polarScale: 0.935, spinHours: 9.93, focusDistKm: 2_450_000 },
  { id: "io", name: "Io", kind: "moon", color: "#d8c05a", periodDays: 1.77, radiusKm: 1821.6, texture: "io.jpg", spinHours: 42.5, moon: { parent: "jupiter", engine: "io" } },
  { id: "europa", name: "Europa", kind: "moon", color: "#cbb89a", periodDays: 3.55, radiusKm: 1560.8, texture: "europa.jpg", mapTint: "#e8dcc4", spinHours: 85.2, moon: { parent: "jupiter", engine: "europa" } },
  { id: "ganymede", name: "Ganymede", kind: "moon", color: "#9d9585", periodDays: 7.15, radiusKm: 2634.1, texture: "ganymede.jpg", spinHours: 171.7, moon: { parent: "jupiter", engine: "ganymede" } },
  { id: "callisto", name: "Callisto", kind: "moon", color: "#7d7568", periodDays: 16.69, radiusKm: 2410.3, texture: "callisto.jpg", mapTint: "#c2ab90", spinHours: 400.5, moon: { parent: "jupiter", engine: "callisto" } },
  {
    id: "saturn", name: "Saturn", kind: "planet", color: "#d8bd8a", periodDays: 10_759, radiusKm: 58_232,
    texture: "saturn.jpg", polarScale: 0.902, spinHours: 10.7, focusDistKm: 1_650_000,
    ring: { innerKm: 74_500, outerKm: 140_220, texture: "saturn_ring.png" },
  },
  { id: "titan", name: "Titan", kind: "moon", color: "#d8a558", periodDays: 15.95, radiusKm: 2574.7, spinHours: 382.7, moon: { parent: "saturn", kepler: { aKm: 1_221_870, periodDays: 15.945, phaseDeg: 40 } } },
  { id: "phoebe", name: "Phoebe", kind: "moon", color: "#8a8078", periodDays: 550.5, radiusKm: 106.5, spinHours: 9.27, model: "phoebe.fnm", moon: { parent: "saturn", kepler: { aKm: 12_960_000, periodDays: -550.5, phaseDeg: 250 } } },
  { id: "uranus", name: "Uranus", kind: "planet", color: "#9fd0d4", periodDays: 30_687, radiusKm: 25_362, texture: "uranus.jpg", spinHours: -17.24 },
  { id: "neptune", name: "Neptune", kind: "planet", color: "#6081d6", periodDays: 60_190, radiusKm: 24_622, texture: "neptune.jpg", spinHours: 16.11 },
  { id: "ceres", name: "Ceres", kind: "smallbody", color: "#b8b2a8", periodDays: 1682, radiusKm: 469.7, texture: "ceres.jpg", polarScale: 0.927, spinHours: 9.07 },
  { id: "eros", name: "Eros", kind: "smallbody", color: "#c98c66", periodDays: 643, radiusKm: 8.4, model: "eros.fnm", spinHours: 5.27 },
  { id: "vesta", name: "Vesta", kind: "smallbody", color: "#a89f8e", periodDays: 1325, radiusKm: 262.7, spinHours: 5.34, model: "vesta.fnm" },
  { id: "pallas", name: "Pallas", kind: "smallbody", color: "#8f9aa3", periodDays: 1686, radiusKm: 256, spinHours: 7.81, model: "pallas.fnm" },
  { id: "hygiea", name: "Hygiea", kind: "smallbody", color: "#7d7a74", periodDays: 2030, radiusKm: 217, spinHours: 13.83, model: "hygiea.fnm" },
  { id: "juno", name: "Juno", kind: "smallbody", color: "#a3917c", periodDays: 1593, radiusKm: 123, spinHours: 7.21, model: "juno.fnm" },
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
  {
    // The Sol gate. Exists only after the "ring-appears" timeline event
    // (existence handled by the timeline layer). Distance/size assumptions
    // in ASSUMPTIONS.md.
    id: "ring",
    name: "The Ring",
    kind: "construct",
    color: "#66e0d8",
    periodDays: 37_690, // circular @ 22 AU
    radiusKm: 500,
    construct: { radiusAu: 22, phaseDeg: 200 },
  },
];

export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));

/** Bodies selectable as planner origin/destination. */
export const ROUTE_BODIES = BODIES.filter((b) => b.kind !== "star");
