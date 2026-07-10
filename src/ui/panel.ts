/** Nav-console panel: hull, route, burn, output card, live light lag. */
import { ROUTE_BODIES } from "../data/bodies";
import { burnWarning, SHIP_BY_ID, SHIPS } from "../data/ships";
import type { Ephemeris } from "../ephemeris";
import {
  brachistochrone,
  CANON_ACCEL_DIVISOR,
  effectiveAccelG,
  G0,
  lightLag,
  planFlight,
  shipVelocity,
} from "../planner";
import { track } from "../analytics";
import { buildShareUrl } from "./share";
import { epsteinPlan, EPSTEIN_BURN_SEC } from "../scene/epstein";
import { MILLER_G, millerPlan } from "../scene/miller";
import type { FlightPlan } from "../planner";
import {
  fmtAu,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtLag,
  fmtVelocity,
} from "./format";
import { store } from "./store";

export function mountPanel(root: HTMLElement, eph: Ephemeris) {
  const options = ROUTE_BODIES.map(
    (b) => `<option value="${b.id}">${b.name}</option>`
  ).join("");
  const shipOptions = SHIPS.map(
    (s) => `<option value="${s.id}">${s.name}</option>`
  ).join("");

  root.innerHTML = `
    <h1>Belter <span class="accent">Charts</span></h1>
    <p class="tagline">unofficial Expanse navigator</p>

    <div class="route-row">
      <label>From
        <select id="origin">${options}</select>
      </label>
      <button id="swap-btn" data-tip="swap origin and destination" data-tip-pos="below" aria-label="swap origin and destination">⇅</button>
      <label>To
        <select id="dest">${options}</select>
      </label>
    </div>

    <label class="hull-row">Hull
      <select id="ship">${shipOptions}</select>
    </label>

    <div class="g-row" id="g-row"></div>
    <p id="burn-warning" class="warning"></p>

    <div class="honesty-row" id="honesty-row" data-tip="The books' stated accelerations give trips ~10x faster than the books narrate. Pick your truth.">
      <button data-mode="honest" class="h-btn">honest physics</button>
      <button data-mode="canon" class="h-btn">canon feel</button>
    </div>

    <button id="plan-btn" class="primary">Plan flight</button>
    <div class="result-actions">
      <button id="ride-btn" class="primary ride hidden">▶ Ride the burn</button>
      <button id="share-btn" class="ghost hidden" data-tip="copy a link to this exact plan" data-tip-pos="left">⧉ share</button>
      <button id="ticks-btn" class="ghost hidden" data-tip="time-tick markers along the route" data-tip-pos="left">✓ ticks</button>
    </div>

    <div class="lag-row">
      <div id="lag" class="lag"></div>
      <button id="beam-btn" class="tool-btn hidden" data-tip="tightbeam: watch a comm pulse cross at lightspeed" data-tip-pos="left" aria-label="send tightbeam pulse">◇</button>
    </div>

    <div id="result" class="result"></div>

    <div class="tool-row">
      <div class="story-wrap">
        <button id="story-btn" class="tool-btn wide" data-tip="story flights: ride a canon scenario" data-tip-pos="right">☄ Stories ▾</button>
        <div id="story-menu" class="story-menu hidden">
          <button data-story="epstein">☄ Epstein's last flight</button>
          <button data-story="miller">◍ Miller's ride to Eros</button>
        </div>
      </div>
      <button id="traffic-panel-btn" class="tool-btn" data-tip="toggle ambient system traffic" data-tip-pos="left" aria-label="toggle ambient system traffic"></button>
      <button id="about-btn" class="tool-btn" data-tip="about, credits &amp; controls" data-tip-pos="left" aria-label="about, credits and controls">ⓘ</button>
      <button id="feedback-btn" class="tool-btn" data-tip="send feedback" data-tip-pos="left" aria-label="send feedback">✉</button>
    </div>

    <p class="keys-hint">
      <b>WASD</b>+<b>R/F</b> fly (<b>⇧</b> boost) · drag aim ·
      <b>r-drag</b> pan · <b>←→↑↓</b> orbit/zoom · <b>Q/E</b> pitch<br />
      <b>H</b> home · <b>[ ]</b> cycle · <b>1–9 0</b> bodies ·
      <b>G</b> route · <b>space</b> play · click body = fly to it
    </p>
  `;

  const ship = root.querySelector<HTMLSelectElement>("#ship")!;
  const origin = root.querySelector<HTMLSelectElement>("#origin")!;
  const dest = root.querySelector<HTMLSelectElement>("#dest")!;
  const gRow = root.querySelector<HTMLDivElement>("#g-row")!;
  const warning = root.querySelector<HTMLParagraphElement>("#burn-warning")!;
  const planBtn = root.querySelector<HTMLButtonElement>("#plan-btn")!;
  const shareBtn = root.querySelector<HTMLButtonElement>("#share-btn")!;
  const beamBtn = root.querySelector<HTMLButtonElement>("#beam-btn")!;
  const rideBtn = root.querySelector<HTMLButtonElement>("#ride-btn")!;
  const ticksBtn = root.querySelector<HTMLButtonElement>("#ticks-btn")!;
  const lagEl = root.querySelector<HTMLDivElement>("#lag")!;
  const resultEl = root.querySelector<HTMLDivElement>("#result")!;

  ticksBtn.addEventListener("click", () => {
    store.getState().toggleTicks();
    ticksBtn.textContent = store.getState().showTicks ? "✓ ticks" : "· ticks";
  });

  const trafficPanelBtn = root.querySelector<HTMLButtonElement>("#traffic-panel-btn")!;
  trafficPanelBtn.addEventListener("click", () => {
    const s = store.getState();
    s.setTraffic(!s.trafficOn);
  });
  function renderTraffic() {
    const on = store.getState().trafficOn;
    trafficPanelBtn.textContent = on ? "⋮ traffic on" : "⋮ traffic off";
    trafficPanelBtn.classList.toggle("off", !on);
  }

  ship.value = store.getState().shipId;
  origin.value = store.getState().originId;
  dest.value = store.getState().destId;

  ship.addEventListener("change", () => {
    const s = store.getState();
    s.setShip(ship.value);
    s.setAccel(SHIP_BY_ID.get(ship.value)!.defaultG);
  });
  origin.addEventListener("change", () => store.getState().setOrigin(origin.value));
  dest.addEventListener("change", () => store.getState().setDest(dest.value));
  root.querySelector<HTMLButtonElement>("#swap-btn")!.addEventListener("click", () => {
    const s = store.getState();
    const o = s.originId;
    s.setOrigin(s.destId);
    s.setDest(o);
    // re-read: the earlier snapshot is stale after the two set calls
    const now = store.getState();
    origin.value = now.originId;
    dest.value = now.destId;
  });

  gRow.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".g-btn");
    if (!btn) return;
    store.getState().setAccel(Number(btn.dataset.g));
  });

  const honestyRow = root.querySelector<HTMLDivElement>("#honesty-row")!;
  honestyRow.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".h-btn");
    if (!btn) return;
    store.getState().setHonesty(btn.dataset.mode as "honest" | "canon");
  });

  planBtn.addEventListener("click", () => {
    const s = store.getState();
    if (s.originId === s.destId) return;
    const when = new Date(s.timeMs);
    for (const id of [s.originId, s.destId]) {
      if (!eph.exists(id, when)) {
        s.setPlan(null);
        resultEl.classList.add("error");
        resultEl.textContent = `No such object on this date — check the timeline. (${id})`;
        return;
      }
    }
    try {
      const plan = planFlight(
        eph,
        s.originId,
        s.destId,
        new Date(s.timeMs),
        effectiveAccelG(s.accelG, s.honesty)
      );
      s.setPlan(plan);
      resultEl.classList.remove("error");
      track("flight-planned");
    } catch (e) {
      // Arrival past the packed ephemeris window (belt data ends 2365-01-01).
      s.setPlan(null);
      resultEl.classList.add("error");
      resultEl.textContent =
        e instanceof RangeError
          ? "Route runs past the ephemeris window (belt data ends 2365-01-01). Pick an earlier departure."
          : `planner error: ${(e as Error).message}`;
    }
  });

  beamBtn.addEventListener("click", () => {
    const s = store.getState();
    if (s.originId !== s.destId) s.fireBeam();
  });

  rideBtn.addEventListener("click", () => {
    const s = store.getState();
    const plan = s.plan;
    if (!plan) return;
    // Ride length scales with the journey: quick hops play out in ~30 s,
    // long hauls stretch toward 2.5 min so the scale of the trip registers.
    const days = plan.travelTimeSec / 86_400;
    const wallSec = Math.min(Math.max(days * 9, 30), 150);
    s.setTime(plan.depart.getTime());
    s.setSpeed(days / wallSec);
    s.setPlaying(true);
    s.setRide(true);
    track("ride-started");
  });

  // Story flights menu: canon scenarios grouped under one button.
  const storyBtn = root.querySelector<HTMLButtonElement>("#story-btn")!;
  const storyMenu = root.querySelector<HTMLDivElement>("#story-menu")!;
  storyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    storyMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => storyMenu.classList.add("hidden"));

  /** common ride kickoff: engage a scenario plan and start the clock */
  function startScenario(plan: FlightPlan, scenario: "epstein" | "miller", speed: number) {
    const s = store.getState();
    s.setPlan(plan);
    s.setScenario(scenario);
    s.setTime(plan.depart.getTime());
    s.setSpeed(speed);
    s.setPlaying(true);
    s.setRide(true);
  }

  storyMenu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-story]");
    if (!btn) return;
    storyMenu.classList.add("hidden");
    const s = store.getState();
    if (btn.dataset.story === "epstein") {
      // 37 h of burn over ~40 s of wall time
      startScenario(epsteinPlan(eph, new Date(s.timeMs)), "epstein", EPSTEIN_BURN_SEC / 86_400 / 40);
      track("epstein-flight");
    } else {
      // Ceres -> Eros, docking as the incident begins; ride pacing matches
      // the normal ride button (quick hops ~30 s, long hauls ~2.5 min).
      try {
        const plan = millerPlan(eph, s.honesty);
        // sync the console so the result card matches the flight
        s.setOrigin("ceres");
        s.setDest("eros");
        s.setAccel(MILLER_G);
        origin.value = "ceres";
        dest.value = "eros";
        const days = plan.travelTimeSec / 86_400;
        startScenario(plan, "miller", days / Math.min(Math.max(days * 9, 30), 150));
        track("miller-flight");
      } catch {
        resultEl.classList.add("error");
        resultEl.textContent = "Couldn't plan Miller's ride on this ephemeris.";
      }
    }
  });

  shareBtn.addEventListener("click", async () => {
    track("plan-shared");
    const url = buildShareUrl(store.getState());
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = "✓ copied";
    } catch {
      // clipboard blocked: show the URL for manual copy
      prompt("Copy this link:", url);
    }
    setTimeout(() => (shareBtn.textContent = "⧉ share plan"), 1800);
  });

  function renderHonesty() {
    const mode = store.getState().honesty;
    for (const b of honestyRow.querySelectorAll<HTMLButtonElement>(".h-btn")) {
      b.classList.toggle("active", b.dataset.mode === mode);
    }
  }

  function renderShip() {
    const s = store.getState();
    const hull = SHIP_BY_ID.get(s.shipId)!;
    ship.title = hull.blurb;
    gRow.innerHTML = hull.gPresets
      .map(
        (g) =>
          `<button data-g="${g}" class="g-btn ${g === s.accelG ? "active" : ""}">${g} g</button>`
      )
      .join("");
    const w = burnWarning(s.accelG);
    warning.textContent = w.text;
    warning.dataset.severity = String(w.severity);
  }

  function renderLag() {
    const s = store.getState();
    if (s.originId === s.destId) {
      lagEl.textContent = "";
      beamBtn.classList.add("hidden");
      return;
    }
    beamBtn.classList.remove("hidden");
    const lag = lightLag(eph, s.originId, s.destId, new Date(s.timeMs));
    lagEl.innerHTML = `light lag <b>${fmtLag(lag)}</b> one-way · <b>${fmtLag(
      lag * 2
    )}</b> round-trip`;
  }

  function renderResult() {
    const s = store.getState();
    const { plan } = s;
    rideBtn.classList.toggle("hidden", !plan);
    shareBtn.classList.toggle("hidden", !plan);
    ticksBtn.classList.toggle("hidden", !plan);
    if (!plan) {
      resultEl.innerHTML = "";
      return;
    }
    // Both truths, side by side (Plan.md 5.5): the same route flown at the
    // stated g and at canon-feel g/10. Re-planned per mode so the moving
    // target and orbital velocities are accounted for exactly; falls back
    // to the chord approximation if a re-plan runs off the ephemeris.
    const timeFor = (accelG: number): number => {
      if (plan.originId === plan.destId) {
        // scenario pseudo-plans (Epstein): no real intercept to re-plan
        return brachistochrone(plan.distanceKm, accelG * G0).t;
      }
      try {
        return planFlight(eph, plan.originId, plan.destId, plan.depart, accelG)
          .travelTimeSec;
      } catch {
        return brachistochrone(plan.distanceKm, accelG * G0).t;
      }
    };
    const honestT = timeFor(s.accelG);
    const canonT = timeFor(s.accelG / CANON_ACCEL_DIVISOR);
    resultEl.innerHTML = `
      <div class="row"><span>departure</span><b>${fmtDate(plan.depart.getTime())}</b></div>
      <div class="row honesty-compare">
        <span class="${s.honesty === "honest" ? "active" : ""}">honest: <b>${fmtDuration(honestT)}</b></span>
        <span class="${s.honesty === "canon" ? "active" : ""}">canon: <b>${fmtDuration(canonT)}</b></span>
      </div>
      <div class="row"><span>flip at</span><b>${fmtDateTime(
        plan.depart.getTime() + plan.flipTimeSec * 1000
      )}</b></div>
      <div class="row"><span>arrival</span><b>${fmtDateTime(plan.arrive.getTime())}</b></div>
      <div class="row"><span>distance</span><b>${fmtAu(plan.distanceKm)}</b></div>
      <div class="row"><span>peak velocity</span><b>${fmtVelocity(plan.vPeakKmS)}</b></div>
      <div class="row"><span>burn</span><b>${s.accelG} g ${s.honesty === "canon" ? "(canon feel)" : "stated"}</b></div>
      <div class="row progress-row hidden" id="plan-progress"></div>
    `;
    renderProgress();
  }

  /** En-route readout: progress %, live velocity rel. destination. */
  function renderProgress() {
    const s = store.getState();
    const el = resultEl.querySelector<HTMLDivElement>("#plan-progress");
    if (!el || !s.plan) return;
    const tSec = (s.timeMs - s.plan.depart.getTime()) / 1000;
    const T = s.plan.travelTimeSec;
    if (tSec <= 0 || tSec >= T) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    const vel = shipVelocity(s.plan, tSec);
    const v = Math.hypot(
      vel.x - s.plan.arriveVel.x,
      vel.y - s.plan.arriveVel.y,
      vel.z - s.plan.arriveVel.z
    );
    el.innerHTML = `<span>en route</span><b>${((100 * tSec) / T).toFixed(0)}% · ${fmtVelocity(v)}</b>`;
  }

  let lastLagRender = 0;
  let lastProgressWall = 0;
  store.subscribe((s, prev) => {
    if (s.accelG !== prev.accelG || s.shipId !== prev.shipId) renderShip();
    if (s.honesty !== prev.honesty) renderHonesty();
    if (s.plan !== prev.plan) renderResult();
    if (s.trafficOn !== prev.trafficOn) renderTraffic();
    if (
      s.originId !== prev.originId ||
      s.destId !== prev.destId ||
      Math.abs(s.timeMs - lastLagRender) > 3_600_000
    ) {
      lastLagRender = s.timeMs;
      renderLag();
    }
    // en-route row tracks the clock; throttle DOM writes to ~2/s
    if (s.plan && s.timeMs !== prev.timeMs && performance.now() - lastProgressWall > 500) {
      lastProgressWall = performance.now();
      renderProgress();
    }
  });

  renderShip();
  renderHonesty();
  renderLag();
  renderResult();
  renderTraffic();
}
