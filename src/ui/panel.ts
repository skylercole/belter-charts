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
} from "../planner";
import { buildShareUrl } from "./share";
import { epsteinPlan, EPSTEIN_BURN_SEC } from "../scene/epstein";
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
      <button id="swap-btn" title="swap origin and destination">⇅</button>
      <label>To
        <select id="dest">${options}</select>
      </label>
    </div>

    <label class="hull-row">Hull
      <select id="ship">${shipOptions}</select>
    </label>

    <div class="g-row" id="g-row"></div>
    <p id="burn-warning" class="warning"></p>

    <div class="honesty-row" id="honesty-row" title="The books' stated accelerations give trips ~10x faster than the books narrate. Pick your truth.">
      <button data-mode="honest" class="h-btn">honest physics</button>
      <button data-mode="canon" class="h-btn">canon feel</button>
    </div>

    <button id="plan-btn" class="primary">Plan flight</button>
    <div class="result-actions">
      <button id="ride-btn" class="primary ride hidden">▶ Ride the burn</button>
      <button id="share-btn" class="ghost hidden" title="copy a link to this exact plan">⧉ share</button>
    </div>

    <div class="lag-row">
      <div id="lag" class="lag"></div>
      <button id="beam-btn" class="tool-btn hidden" title="tightbeam: watch a comm pulse cross at lightspeed">◇</button>
    </div>

    <div id="result" class="result"></div>

    <div class="tool-row">
      <button id="epstein-btn" class="tool-btn wide" title="story mode: ride the first Epstein burn">☄ Epstein's last flight</button>
      <button id="about-btn" class="tool-btn" title="about, credits, controls">ⓘ</button>
    </div>
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
  const lagEl = root.querySelector<HTMLDivElement>("#lag")!;
  const resultEl = root.querySelector<HTMLDivElement>("#result")!;

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
    // long hauls stretch toward 2.5 min so the epic soundtrack breathes.
    const days = plan.travelTimeSec / 86_400;
    const wallSec = Math.min(Math.max(days * 9, 30), 150);
    s.setTime(plan.depart.getTime());
    s.setSpeed(days / wallSec);
    s.setPlaying(true);
    s.setRide(true);
  });

  root.querySelector<HTMLButtonElement>("#epstein-btn")!.addEventListener("click", () => {
    const s = store.getState();
    const plan = epsteinPlan(eph, new Date(s.timeMs));
    s.setPlan(plan);
    s.setScenario("epstein");
    s.setTime(plan.depart.getTime());
    // 37 h of burn over ~40 s of wall time
    s.setSpeed(EPSTEIN_BURN_SEC / 86_400 / 40);
    s.setPlaying(true);
    s.setRide(true);
  });

  shareBtn.addEventListener("click", async () => {
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
    if (!plan) {
      resultEl.innerHTML = "";
      return;
    }
    // Both truths, side by side (Plan.md 5.5): the same chord flown at the
    // stated g and at canon-feel g/10. Times scale by sqrt(10).
    const honestT = brachistochrone(plan.distanceKm, s.accelG * G0).t;
    const canonT = brachistochrone(
      plan.distanceKm,
      (s.accelG / CANON_ACCEL_DIVISOR) * G0
    ).t;
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
    `;
  }

  let lastLagRender = 0;
  store.subscribe((s, prev) => {
    if (s.accelG !== prev.accelG || s.shipId !== prev.shipId) renderShip();
    if (s.honesty !== prev.honesty) renderHonesty();
    if (s.plan !== prev.plan) renderResult();
    if (
      s.originId !== prev.originId ||
      s.destId !== prev.destId ||
      Math.abs(s.timeMs - lastLagRender) > 3_600_000
    ) {
      lastLagRender = s.timeMs;
      renderLag();
    }
  });

  renderShip();
  renderHonesty();
  renderLag();
  renderResult();
}
