/**
 * Ship classes. Book-derived archetypes, no show assets. The hull limits
 * which burns the planner offers; the warnings are flavor tied to the
 * fiction's treatment of sustained acceleration.
 */

export interface ShipClass {
  id: string;
  name: string;
  blurb: string;
  /** g presets offered in the panel; last one is the hull's max burn. */
  gPresets: number[];
  defaultG: number;
}

export const SHIPS: ShipClass[] = [
  {
    id: "hauler",
    name: "Ice hauler",
    blurb: "Canterbury-type water hauler. Slow, honest work.",
    gPresets: [0.1, 0.3, 0.5],
    defaultG: 0.3,
  },
  {
    id: "corvette",
    name: "Frigate-class corvette",
    blurb: "Military hull, Epstein drive, crash couches for everyone.",
    gPresets: [0.3, 1, 2, 5],
    defaultG: 1,
  },
  {
    id: "pinnace",
    name: "Racing pinnace",
    blurb: "All drive, no cargo. Inner-system rich kid toy.",
    gPresets: [1, 2, 5, 8, 12],
    defaultG: 2,
  },
];

export const SHIP_BY_ID = new Map(SHIPS.map((s) => [s.id, s]));

/** Crew-consequence line for a sustained burn at g. */
export function burnWarning(g: number): { text: string; severity: 0 | 1 | 2 | 3 } {
  if (g <= 0.35) return { text: "Lazy cruise. Belter-friendly spin-gravity range.", severity: 0 };
  if (g <= 1.05) return { text: "Earth-normal burn. Inners feel right at home.", severity: 0 };
  if (g <= 2.05)
    return { text: "Sustained 2 g: double weight, crew fatigue, no free movement.", severity: 1 };
  if (g <= 5.05)
    return { text: "High-g burn. Crash couches and the juice, or blackouts and broken ribs.", severity: 2 };
  return {
    text: "Torch burn. Juice mandatory. Stroke risk is real. Ask why you are in this much hurry.",
    severity: 3,
  };
}
