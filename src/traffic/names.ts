/**
 * Deterministic ship names for the ambient traffic layer. Two-part names
 * mixing Belter creole and multi-heritage words (the Belt names ships after
 * everything humanity brought up the well), plus a single-name pool.
 */

const FIRST = [
  "Xinglong",
  "Rosse",
  "Bosmang",
  "Tori",
  "Setara",
  "Kaali",
  "Andira",
  "Pella",
  "Weeping",
  "Sungazer",
  "Mowteng",
  "Dagmar",
  "Cerise",
  "Okimbo",
  "Ceres",
  "Vesta",
  "Tycho",
  "Beltalowda",
  "Kowmang",
  "Sabaka",
  "Inyalowda",
  "Oye",
  "Pampaw",
  "Milowda",
  "Coyo",
  "Sasa",
  "Felota",
  "Imbobo",
  "Nadleeh",
  "Yamskaya",
  "Harmattan",
  "Zmeya",
];

const SECOND = [
  "Byela",
  "Somang",
  "Star",
  "Merchant",
  "Wind",
  "Queen",
  "Dagger",
  "Promise",
  "Horizon",
  "Runner",
  "Vand",
  "Gambit",
  "Fortune",
  "Drift",
  "Hauler",
  "Bird",
  "Song",
  "Venture",
  "Light",
  "Trader",
  "Spirit",
  "Chance",
  "Arrow",
  "Wager",
  "Pride",
  "Dancer",
  "Gift",
  "Rock",
  "Tide",
  "Way",
  "Echo",
  "Loop",
];

const SINGLE = [
  "Chetzemoka",
  "Canterbury",
  "Anubis",
  "Guanshiyin",
  "Lazy Songbird",
  "Edward Israel",
  "Bellefontaine",
  "Xuesen",
  "Marasmus",
  "Ludovico",
];

const KLASSES: Array<[string, number]> = [
  ["freighter", 5],
  ["ice hauler", 4],
  ["rock hopper", 3],
  ["transport", 2],
  ["yacht", 1],
  ["patrol", 1],
];
const KLASS_TOTAL = KLASSES.reduce((s, [, w]) => s + w, 0);

/** rng: a [0,1) generator; draws exactly two values. */
export function pickName(rng: () => number): string {
  const a = rng();
  const b = rng();
  if (a < 0.12) return SINGLE[Math.floor(b * SINGLE.length)];
  return `${FIRST[Math.floor(a * FIRST.length)]} ${SECOND[Math.floor(b * SECOND.length)]}`;
}

/** rng: draws exactly one value. */
export function pickKlass(rng: () => number): string {
  let r = rng() * KLASS_TOTAL;
  for (const [name, w] of KLASSES) {
    r -= w;
    if (r <= 0) return name;
  }
  return KLASSES[0][0];
}
