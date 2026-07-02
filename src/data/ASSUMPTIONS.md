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

## Planner physics
- Brachistochrone, constant thrust, flip at midpoint: t = 2*sqrt(d/a).
- Straight-chord flight; gravity and origin/destination orbital velocities
  ignored. Error negligible above ~0.1 g sustained (stated in UI footnote).
- Moving-target intercept iterates until the time estimate changes by <60 s;
  converges in 3-5 iterations at these accelerations.
- Flights whose arrival falls past 2365-01-01 (small-body data end) are
  rejected with a UI message rather than extrapolated.
