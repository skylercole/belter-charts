# Flip and Burn
An unofficial navigator for The Expanse's solar system. Browser-based, real ephemerides, canon locations, Epstein flight planner.

Working title. See section 11 for alternatives. Do not name it after the drive's inventor; "Epstein Nav" is unsearchable for reasons unrelated to the books.

---

## 0. Pitch

Set the clock to the 2350s. Every planet, moon and named rock sits where physics says it sits. Pick Ceres, pick Earth, pick 0.3 g, and get a flip-and-burn flight plan animated against the real geometry. Scrub the timeline and watch Eros leave its orbit.

One sentence for the Reddit title: "I built a flight planner for the Expanse solar system with real NASA ephemerides. Here is what a 0.3 g burn from Earth to Ceres actually looks like."

## 1. Positioning

Audience: r/TheExpanse (700k+ members), hard SF readers, orbital mechanics nerds. Secondary: r/webdev, HN as a Three.js showcase.

The gap this fills, confirmed by survey (2026-07-02):
- transfercalculator.com has the math but hides Expanse content behind an easter egg. No map, no timeline.
- ExpanseMap (GitHub, fuzzylogicltd) is a Three.js toy. Not to scale, incomplete, abandoned.
- IanH's wargame calculators are 2D with circular orbits. No visualization.
- overvieweffekt.com has brachistochrone and delta-v calculators. Numbers only.
- SpaceEngine Expanse addons are desktop, ships and stations, no physics planner.

Nobody has shipped: real ephemeris + canon locations + flight planner + timeline, in one browser tab, no install, no account.

## 2. Non-goals

These are decided. Do not reopen them mid-build.

- No ship interiors or 3D ship models. SpaceEngine addons own that.
- No combat.
- No backend, no accounts, no database. Static hosting only.
- No monetization. This is fan work on active IP (Alcon). Free, non-commercial, labeled unofficial.
- No Ring space or extrasolar systems in v1. Sol system only.
- No mobile-first design. Must not break on mobile, but desktop is the target.

## 3. Architecture

Stack: Vite + TypeScript + Three.js + Zustand. No framework for the UI shell unless it fights back; plain DOM with a thin layer is fine, React acceptable if the panel UI grows.

Hosting: GitHub Pages or Cloudflare Pages. Everything static.

Modules:

```
/src
  /ephemeris     planet positions (astronomy-engine), small-body interpolation
  /planner       brachistochrone solver, intercept iteration, light lag
  /scene         Three.js: bodies, orbits, labels, camera, floating origin
  /timeline      era clock, events, trajectory overrides
  /ui            planner panel, timeline scrubber, settings, share links
  /data          bodies.json, stations.json, events.json, ASSUMPTIONS.md
/tools           offline pipeline: Horizons fetch, mesh decimation, texture prep
```

Rendering rules, non-negotiable:
- Floating origin. Camera stays near (0,0,0), world shifts. Without this the outer system jitters.
- Logarithmic depth buffer.
- Internal units: kilometers, stored as Float64 on the CPU side, converted per-frame.
- Stars beyond the system: static skybox baked from the Gaia all-sky map. Do not render a star catalog in v1.

## 4. Data pipeline

### 4.1 Planets and major moons
astronomy-engine (npm, MIT). Client-side, no runtime API calls, valid far past the 2350s. Arcminute-level accuracy, which is orders of magnitude better than this project needs.

### 4.2 Small bodies (Ceres, Eros, Vesta, Pallas, Hygiea, Juno)
astronomy-engine does not cover these. Propagating today's osculating elements 300+ years forward drifts, and Eros has planetary encounters. Pipeline instead:

1. Offline tool queries JPL Horizons for daily state vectors, 2340-01-01 to 2365-01-01.
2. Pack positions + velocities as Float32 binary, one file per body (~700 KB total, less after gzip).
3. Client interpolates with cubic Hermite (positions and velocities give exact C1 interpolation).

Horizons' DE441 backbone covers this era. Validate the packed files against spot checks.

### 4.3 Fictional stations (stations.json)
Keplerian elements propagated client-side. Conventions, following IanH's wargame assumptions until canon research says otherwise:
- Tycho Station: Ceres' orbit, L4 (mean anomaly +60 deg from Ceres). Note: Tycho is mobile in canon; the timeline layer may move it per era.
- Anderson Station: Ceres' orbit, opposed (+180 deg).
- Medina / the Ring: research task. Canon places the Ring beyond Uranus' orbit; pin the exact distance from the wiki and record the citation in ASSUMPTIONS.md.
- Phoebe, Thoth, Ganymede stations: attached to their parent bodies, free.

### 4.4 Shapes and textures
- Eros: NEAR Shoemaker plate model from the PDS Small Bodies Node. Decimate to under 100k triangles. This is the marquee asset; the rock from book one, meter-accurate, flyable.
- Ceres: Dawn shape model + global mosaic via USGS Astrogeology.
- Planets and moons: Solar System Scope texture pack (CC BY 4.0) or USGS mosaics. Record every attribution in CREDITS.md as assets land, not at the end.

### 4.5 Calendar
Canon never states years plainly. Assumption: Leviathan Wakes opens 2350-01-01 XTE. All event dates in events.json are offsets from that anchor, so one constant re-anchors everything if fan consensus differs. Document in ASSUMPTIONS.md with the sources considered.

## 5. Math spec

### 5.1 Brachistochrone, no coast
Accelerate to midpoint, flip, decelerate.
- t = 2 * sqrt(d / a)
- v_peak = sqrt(d * a)
Sanity anchors: 1 AU at 0.3 g is about 5 days. Earth-Mars near opposition at 1 g is about 2 days.

### 5.2 With coast phase (fuel-limited mode, stretch)
Burn t_b, coast, flip, burn t_b. d = a * t_b^2 + v * t_coast. Expose as "max burn time" slider.

### 5.3 Moving-target intercept
The destination moves during the flight. Iterate:
1. t_0 from current straight-line distance.
2. Target position at departure + t_i via ephemeris.
3. Recompute t from the new distance.
4. Repeat until delta-t < 1 minute. Converges in 3 to 5 iterations because ship speeds dwarf orbital speeds at these accelerations. Gravity is ignored (error is negligible above ~0.1 g sustained; state this in the UI footnote).

### 5.4 Light lag
|r_origin - r_dest| / c, shown as one-way and round-trip. Always visible for the selected pair.

### 5.5 Physics honesty toggle
Fan analysis (Expanse wiki, Travel Time) shows stated accelerations run about 10x hot against the books' travel times. Toggle between "canon feel" and "honest physics" on the same route and show both numbers side by side. This toggle is a launch feature, not a footnote. It is the screenshot people will argue about.

### 5.6 Fuel panel (stretch, post-launch)
Rocket equation with Epstein exhaust velocity estimates from Atomic Rockets / ToughSF. Show propellant fraction per plan. Ship without it if it threatens the launch date.

## 6. Phase 0: math core + flat map

Target: one weekend.

- ephemeris + planner modules with unit tests. Test fixtures are Horizons snapshots checked into the repo.
- 2D top-down canvas view. Orbits, positions, date control.
- Planner panel: origin, destination, g preset (0.3 g cruise / 1 g / 2 g / 5 g "the juice"), departure date. Output card: travel time, flip time, peak velocity, light lag.
- Deploy behind a URL from day one.

Acceptance: Earth-Mars at 1 g within 5% of the known ~2 day figure across three departure dates. Ceres and Eros positions match Horizons spot checks within 0.1%.

This phase is independently shippable. If everything else dies, this is still a post.

## 7. Phase 1: 3D scene

Target: 2 weeks of evenings.

- Three.js scene with floating origin and log depth from the first commit, not retrofitted.
- Textured planets, Eros and Ceres shape models, orbit lines, CSS2D labels.
- Camera: focus-and-follow any body, smooth transitions, scroll to scale.
- Flight plans render as animated trajectories with the flip point marked.

Acceptance: 60 fps on integrated graphics for the default view. Fly from Earth focus to Eros focus with no jitter and no z-fighting.

Kill criterion: if origin-shifting jitter is unsolved after 4 evenings, freeze 3D, polish the 2D view, and launch that. The math is the product; 3D is presentation.

## 8. Phase 2: canon timeline

Target: 1 week.

- Era scrubber spanning roughly 2350 to 2360 (books 1 to 9 minus the time skip; decide the exact span during event research).
- events.json: date offset, bodies involved, one-paragraph description, wiki citation, optional trajectory override.
- Launch set: 12 events, hard cap. Candidates: Canterbury intercept, Donnager, Eros incident and departure burn (the trajectory override showpiece), Ganymede incident, Io, the Ring's appearance, Free Navy rock strikes.
- Spoiler mode: events hidden beyond a user-set "I have read up to" marker. Cheap to build, and r/TheExpanse will notice and appreciate it.

Acceptance: scrubbing is smooth, every event cites its source in the data file.

Kill criterion: if canon research for an event exceeds one evening, cut the event, not the schedule.

## 9. Phase 3: launch hooks

Target: 3 to 4 evenings.

- Physics honesty toggle (5.5) wired into the planner card.
- Light-lag overlay (5.4).
- Shareable plans: full state in the query string (bodies, date, g, toggle). No backend.
- Unofficial disclaimer, CREDITS.md rendered as an about panel, GitHub link.

## 10. Phase 4: launch

Rule carried over from prior projects: post within 7 days of Phase 3 completion. No new features before posting. The failure mode is polishing instead of publishing, and it is a known failure mode.

Assets for the post:
1. GIF: Earth to Ceres at 0.3 g, planner solving, trajectory animating, flip point visible.
2. GIF: timeline scrub across the Eros incident, the rock leaving its orbit.
3. Screenshot: honesty toggle showing canon vs. real times on the same route.

Post plan:
- r/TheExpanse, weekday morning US time. Title leads with the artifact: "I built an unofficial flight planner for the Expanse solar system. Real NASA data, canon stations, flip-and-burn trajectories. Free, in your browser."
- First comment: tech stack, data sources, the honesty-toggle finding, GitHub link. This comment is bait for the physics argument, which is the engagement engine.
- Second wave only if the first lands: r/webdev show-off thread, HN Show HN.

Success bar: 500+ upvotes on r/TheExpanse or one substantive thread of people arguing about the factor of 10. Below that, one iteration on feedback, then apply kill criteria before any further investment.

## 11. Name candidates

- Flip and Burn (working title, describes the core feature, canon phrase)
- The Big Empty
- Churn Navigator
- Belter Charts

Check domain and collision before launch. Keep "unofficial" in the tagline everywhere regardless of name.

## 12. Legal lane

- No show assets: no stills, no logos, no fonts from the series, no audio.
- Book-derived proper nouns (Tycho Station, Eros incident) used nominatively with an unofficial disclaimer.
- Non-commercial, no ads, no donations link at launch.
- If a rightsholder objects, comply fast. The code and the real-data planner survive a rename; only strings die.

## 13. Open questions (resolve during build, log answers in ASSUMPTIONS.md)

1. Ring position and arrival date, with wiki citations.
2. Tycho Station's canonical position per era, if any.
3. Exact calendar anchor. 2350 is the placeholder.
4. Whether Anderson Station survives to the main timeline era or belongs to a backstory-only toggle.