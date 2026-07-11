---
name: verify
description: Drive Belter Charts (3D Expanse navigator) end-to-end in a headless browser to verify changes at the real surface.
---

# Verifying Belter Charts

Browser app (vanilla TS + three.js + Vite). The surface is the rendered page;
drive it with Playwright, don't unit-test internals.

## Launch

```bash
npm run dev -- --port 5317 --strictPort   # background; pick a free port —
                                          # 5199 is often taken by another project
curl -s http://localhost:5317/ | grep "Belter Charts"   # confirm it's THIS app
```

## Drive (Playwright)

No local playwright dep. A working install lives in the npx cache:

```bash
NODE_PATH=/Users/stanislav/.npm/_npx/e41f203b7505f1fb/node_modules node script.cjs
```

(If that hash is gone, `ls ~/.npm/_npx/*/node_modules/playwright`.)

Gotchas that cost time:
- `page.goto` with default `waitUntil: "load"` times out (big textures);
  use `{ waitUntil: "domcontentloaded" }` then wait for `#plan-btn`.
- **Never use `page.click`** — SwiftShader pegs the main thread and
  Playwright's actionability checks (stable-frames) starve for 30 s+ even on
  visible elements. Dispatch DOM clicks instead:
  `page.$eval(sel, (el) => el.click())`.
- **One page, sequential** — each fresh context/page reload costs tens of
  seconds under software GL; a second `goto` in the same run can time out.
  Reuse a single page and reset state between checks.
- Suppress the onboarding tour up front instead of racing to click skip:
  `ctx.addInitScript(() => localStorage.setItem("fnb-tour-done", "1"))`.
- Spoiler level: `localStorage["fnb-spoiler-book"]` (1..6) gates events AND
  the Stories menu; the menu re-reads it on every open.
- Fast-forward a ride/watch: set `#speed` to its last option and dispatch
  `change` — endings (dock epilogue, epitaphs, watch auto-pause) arrive in
  seconds instead of the 30-150 s ride pacing.
- Headless chromium renders the WebGL scene fine (SwiftShader).
- Collect `pageerror` + console errors and fail on any.
- Crashed runs leak `headless_shell` processes that starve later runs —
  `pkill -9 -f headless` before retrying slow/timeout weirdness.

## Flows worth driving

- Plan flight: `#plan-btn` → `#result` card text; `KeyG` frames the route.
- Ride: `#ride-btn` → `#ride-hud` text (phase/velocity/ETA); `.hud-exit` leaves.
- Time: `Space` toggles play; scrub via setting `#scrub.value` + dispatching
  `input`. Scrub both directions across a flight to shake out state bugs.
- Traffic layer: `#traffic-btn` cycles on→high→off→low; hover a dot for the
  `.traffic-label` (sweep the mouse in a grid to find one).
- Stories: `#story-btn` opens `#story-menu` (built from `src/scene/stories/`
  registry, spoiler-filtered); `button[data-story="<id>"]` launches. Flight
  stories show `#ride-hud` + `#comm-log`; epitaph endings fill `#epitaph`
  (close via `#epitaph-close`); watch stories only move focus + clock.
- 2D fallback + share URLs: `/?o=earth&d=ceres&hull=corvette&g=1&mode=canon&t=2350-01-01T00:00&view=2d`.
- Screenshots are the evidence; UI text (`#result`, `#ride-hud`, `#plan-progress`)
  gives exact numbers.
- Dev builds expose `window.__scene3d` (the Scene3D instance) — evaluate it to
  dump three.js buffers, drawRanges, ship world position, controls state when a
  visual bug needs numbers instead of pixels.
