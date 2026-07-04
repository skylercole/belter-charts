# Assumptions

Running log of every modeling assumption, per Plan.md. Update as decisions land.

## Calendar anchor
- **Leviathan Wakes opens 2350-01-01** (placeholder per Plan.md 4.5; canon never
  states years plainly). All future event dates will be offsets from this
  constant so one change re-anchors everything. UI labels era time "XTE".
- Open question (Plan.md 13.3): revisit against fan consensus before launch.

## Time scales
- Internal app time is JS epoch milliseconds treated as UTC. Packed ephemeris
  files are indexed by JD TDB; we ignore the TDB-UTC offset (~69 s in 2026,
  unknowable leap-second future). At ~20 km/s asteroid orbital speed this is
  ~1400 km of along-track error, i.e. ~3e-6 relative — far inside the 0.1%
  acceptance band.

## Ephemeris
- Planets: astronomy-engine (MIT). Arcminute-class in the 2350s; validated
  against Horizons spot checks to <0.1% in tests (`planets.test.ts`).
- Small bodies (Ceres, Pallas, Juno, Vesta, Hygiea, Eros): JPL Horizons daily
  state vectors 2340-01-01..2365-01-01 TDB, heliocentric ecliptic J2000,
  packed Float32 (`public/ephem/*.fnb`, ~214 KB each). Cubic Hermite
  interpolation; measured error vs off-grid Horizons spot checks ~10 km
  (~2e-8 relative), dominated by Float32 quantization.
- Frame everywhere: heliocentric ecliptic J2000, km, km/s. Map view is the
  ecliptic seen from north (+x vernal equinox, +y ecliptic 90°).

## Fictional stations (Phase 0 approximation)
- Tycho Station: Ceres' orbit, leading by 60° (IanH wargame convention).
  Implemented as a +60° rotation of Ceres' state vector about the ecliptic
  pole — NOT true mean-anomaly offset Keplerian propagation. For Ceres
  (e≈0.08, i≈10.6°) the difference is small at map scale; replace with real
  element propagation if it ever matters. Tycho is mobile in canon; the
  Phase 2 timeline layer may move it per era.
- Anderson Station: same approximation, +180°.
- Open questions (Plan.md 13.2, 13.4): canonical Tycho position per era;
  whether Anderson survives into the main-timeline era.

## 3D scene (Phase 1)
- Floating origin: the focused body sits at world (0,0,0); all coordinates
  are rewritten per frame as (heliocentric − origin) in Float64 on the CPU.
  Logarithmic depth buffer. 1 three.js unit = 1 km.
- Axial tilts are ignored: every planet's spin pole is rendered as ecliptic
  north (+Z). Spin rates are real sidereal periods, but phase is arbitrary.
  Saturn's ring is drawn in the ecliptic plane (real tilt 26.7°).
- Eros: NEAR MSI 89,398-plate model, body-fixed frame; its +Z (true spin
  pole) is rendered pointing at ecliptic north (real pole is ~17° off).
  Spin period 5.27 h, arbitrary phase.
- Ceres and the other belt bodies are spheres/ellipsoids (Ceres flattening
  0.927, Dawn mosaic texture); no shape models in v1.
- Skybox: Milky Way panorama, not aligned to the real galactic frame.

## Ships & stations
- The ride ship renders the official SYFY-published Rocinante print model
  (CC-BY 3.0; see CREDITS.md), decimated to ~88k triangles. The ship is
  drawn screen-constant (not to real scale against planets).
- Tycho and Anderson use original procedural ring-station geometry at
  invented sizes (2.5 km / 1.2 km ring radius) — canon gives structure, not
  dimensions. Drop-in GLB overrides: public/models/README.md.

## Canon timeline (Phase 2)
- Anchor: Leviathan Wakes opens 2350-01-01 XTE (see Calendar anchor above).
  All event dates in events.json are day offsets from the anchor; canon
  never states absolute dates, and book-to-book gaps are editorial
  estimates from internal cues (LW ~7 months; CW ~1 year later; AG ~6
  months after CW; NG/BA ~5-6 years after LW). One constant re-anchors
  everything.
- Eros departure burn: modeled as a straight chord from Eros's real
  position at the "eros-burn" date to Venus's real position at impact,
  acceleration-only profile f=(t/T)^2, 37 days of flight. Canon describes
  erratic, inertia-defying maneuvering; the chord is a deliberate
  simplification. After impact Eros ceases to exist in the app.
- The Ring: placed on a circular ecliptic orbit at 22 AU (canon: "outside
  the orbit of Uranus"; exact distance never stated — open question per
  Plan.md 13.1), ring radius 500 km (canon: ~1000 km across). It exists
  only after the "ring-appears" event.
- Spoiler mode: events beyond the user's "read up to" book are hidden from
  the timeline UI entirely (markers, navigation). Default: book 1.

## Story scenarios
- "Epstein's last flight" follows the short story "Drive": figures are
  deliberately approximate (6.8 g sustained, 37 h burn, prograde from Mars).
  Canon gives no exact acceleration; the point is the one-way trajectory,
  not the numbers. The scenario ship ignores fuel/mass modeling.

## Sound & music
- Sound effects (drive rumble, klaxon, heartbeat, creaks, docking) are
  synthesized at runtime with WebAudio.
- Ride soundtrack: four original project-owned tracks in `public/music/`
  ("Neon Overdrive" 1-2, ~60 s; "Chrome Overdrive" 1-2, ~250 s). Track choice
  follows the ride's wall-clock length: under ~65 s gets a short track,
  longer rides get an epic; the two tracks in a class alternate. No licensed
  recordings ship with the app.
- Mixing: soundtrack runs through a compressor; the engine rumble is ducked
  to 45% while music plays; a lowpass pulls the music down during the
  zero-thrust flip.

## Planner physics
- Brachistochrone, constant thrust, flip at midpoint: t = 2*sqrt(d/a).
- Straight-chord flight; gravity and origin/destination orbital velocities
  ignored. Error negligible above ~0.1 g sustained (stated in UI footnote).
- Moving-target intercept iterates until the time estimate changes by <60 s;
  converges in 3-5 iterations at these accelerations.
- Flights whose arrival falls past 2365-01-01 (small-body data end) are
  rejected with a UI message rather than extrapolated.
