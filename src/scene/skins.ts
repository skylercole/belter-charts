/**
 * Ship paint schemes ("skins"): per-face vertex colors computed from
 * model-space position at load time. The packed hulls carry no UVs or
 * baked colors, but they are all length-normalized with the nose at +Z,
 * so faction liveries can be painted as bands and regions of that frame.
 *
 * Pure array-in/array-out so the offline preview tooling can drive it
 * with tsx; only ship.ts touches three.js.
 */
import type { SkinSpec } from "../data/ships";

/** deterministic per-face jitter so armor reads as panels, not plastic */
function panelJitter(face: number): number {
  let h = (face * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = (h * 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return 0.93 + 0.1 * ((h & 0xff) / 255);
}

function unpack(c: number): [number, number, number] {
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

/**
 * Pick the livery color for a face at model-space centroid (x, y, z),
 * z in [-1.5, 1.5] with the nose at +1.5, r = distance from the spine.
 */
function liveryColor(spec: SkinSpec, x: number, y: number, z: number): number {
  const r = Math.hypot(x, y);
  for (const [from, to] of spec.stripes ?? []) {
    if (z > from && z < to) return spec.accent;
  }
  switch (spec.pattern) {
    case "mcrn":
      // Martian navy: gunmetal armor, red-orange service stripes (spec),
      // charcoal drive section and outboard shadow.
      if (z < -1.18) return spec.trim; // drive skirt / engine cluster
      if (r > 0.58 && z < -0.55) return spec.trim; // nacelle / outboard shadow
      return spec.base;
    case "racer":
      // Rich kid's toy: gloss white, crimson nose and go-fast stripe.
      if (z > 1.0) return spec.accent; // nose cap
      if (z < -1.22) return spec.trim; // engine bell
      if (Math.abs(x) < 0.09 && y > 0) return spec.accent; // dorsal stripe
      return spec.base;
  }
}

/**
 * Paint per-face colors for a non-indexed triangle soup. `positions` is
 * xyz per vertex, 9 floats per face; returns RGB u8 per vertex.
 */
export function paintShip(positions: ArrayLike<number>, spec: SkinSpec): Uint8Array {
  const colors = new Uint8Array(positions.length);
  for (let f = 0; f * 9 < positions.length; f++) {
    const o = f * 9;
    const cx = (positions[o] + positions[o + 3] + positions[o + 6]) / 3;
    const cy = (positions[o + 1] + positions[o + 4] + positions[o + 7]) / 3;
    const cz = (positions[o + 2] + positions[o + 5] + positions[o + 8]) / 3;
    const [cr, cg, cb] = unpack(liveryColor(spec, cx, cy, cz));
    const j = panelJitter(f);
    const r = Math.min(255, Math.round(cr * j));
    const g = Math.min(255, Math.round(cg * j));
    const b = Math.min(255, Math.round(cb * j));
    for (let v = 0; v < 3; v++) {
      colors[o + v * 3] = r;
      colors[o + v * 3 + 1] = g;
      colors[o + v * 3 + 2] = b;
    }
  }
  return colors;
}
