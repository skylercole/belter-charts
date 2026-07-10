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
  use `{ waitUntil: "domcontentloaded" }` then `waitForSelector("#plan-btn")`.
- The onboarding tour overlay intercepts all clicks on first load:
  `await page.click(".tour-skip").catch(() => {})` right after load.
- Headless chromium renders the WebGL scene fine (SwiftShader).
- Collect `pageerror` + console errors and fail on any.

## Flows worth driving

- Plan flight: `#plan-btn` → `#result` card text; `KeyG` frames the route.
- Ride: `#ride-btn` → `#ride-hud` text (phase/velocity/ETA); `.hud-exit` leaves.
- Time: `Space` toggles play; scrub via setting `#scrub.value` + dispatching
  `input`. Scrub both directions across a flight to shake out state bugs.
- Traffic layer: `#traffic-btn` cycles on→high→off→low; hover a dot for the
  `.traffic-label` (sweep the mouse in a grid to find one).
- Epstein scenario: `#epstein-btn`.
- 2D fallback + share URLs: `/?o=earth&d=ceres&hull=corvette&g=1&mode=canon&t=2350-01-01T00:00&view=2d`.
- Screenshots are the evidence; UI text (`#result`, `#ride-hud`, `#plan-progress`)
  gives exact numbers.
- Dev builds expose `window.__scene3d` (the Scene3D instance) — evaluate it to
  dump three.js buffers, drawRanges, ship world position, controls state when a
  visual bug needs numbers instead of pixels.
