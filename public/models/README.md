# Models

## Shipped
- `eros.fnm` — 433 Eros plate model, NEAR MSI team via PDS SBN (public data).
- `rocinante.fnm` — assembled from the official SYFY "The Expanse - The
  Rocinante v2.0" print files (thingiverse.com/thing:2060060, **CC-BY 3.0,
  published by Syfy**). Built by `tools/build-ship.ts`: sections stacked and
  joint-aligned, vertex-cluster welded at 0.6 mm, nose +Z, length normalized.

## Drop-in overrides (optional, not committed)
Place a GLB here and it takes precedence at load time:
- `custom-ship.glb` — replaces the ride ship (auto-scaled, nose should face +Z).
- `tycho.glb`, `anderson.glb` — replace the procedural stations
  (auto-scaled to the station's registry size).

If you add third-party models, record source + license in CREDITS.md before
committing. Do not commit models whose license does not permit
redistribution.

`.fnm` layout: `FNM1` magic, u32 vertex count, u32 triangle count,
f32 positions ×3, u32 indices ×3 (little-endian).
