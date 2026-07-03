/** Nav-console panel: hull, route, burn, output card, live light lag. */
import { ROUTE_BODIES } from "../data/bodies";
import { burnWarning, SHIP_BY_ID, SHIPS } from "../data/ships";
import type { Ephemeris } from "../ephemeris";
import { lightLag, planFlight } from "../planner";
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
    <h1>Flip <span class="accent">&amp;</span> Burn</h1>
    <p class="tagline">unofficial Expanse navigator</p>

    <label>Hull
      <select id="ship">${shipOptions}</select>
    </label>
    <p id="ship-blurb" class="blurb"></p>

    <label>From
      <select id="origin">${options}</select>
    </label>
    <label>To
      <select id="dest">${options}</select>
    </label>

    <div class="g-row" id="g-row"></div>
    <p id="burn-warning" class="warning"></p>

    <button id="plan-btn" class="primary">Plan flight</button>

    <div id="lag" class="lag"></div>
    <button id="beam-btn" class="ghost" title="watch a comm pulse cross at lightspeed">◇ tightbeam</button>
    <div id="result" class="result"></div>
    <button id="ride-btn" class="primary ride hidden">▶ Ride the burn</button>

    <p class="footnote">
      Brachistochrone, constant thrust, flip at midpoint. Gravity and orbital
      velocity ignored — negligible above ~0.1 g sustained. Planet positions:
      astronomy-engine. Belt objects: JPL Horizons, 2340–2365.
    </p>
  `;

  const ship = root.querySelector<HTMLSelectElement>("#ship")!;
  const shipBlurb = root.querySelector<HTMLParagraphElement>("#ship-blurb")!;
  const origin = root.querySelector<HTMLSelectElement>("#origin")!;
  const dest = root.querySelector<HTMLSelectElement>("#dest")!;
  const gRow = root.querySelector<HTMLDivElement>("#g-row")!;
  const warning = root.querySelector<HTMLParagraphElement>("#burn-warning")!;
  const planBtn = root.querySelector<HTMLButtonElement>("#plan-btn")!;
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

  gRow.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".g-btn");
    if (!btn) return;
    store.getState().setAccel(Number(btn.dataset.g));
  });

  planBtn.addEventListener("click", () => {
    const s = store.getState();
    if (s.originId === s.destId) return;
    try {
      const plan = planFlight(eph, s.originId, s.destId, new Date(s.timeMs), s.accelG);
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
    // Whole flight plays in ~35 s of wall time.
    const days = plan.travelTimeSec / 86_400;
    s.setTime(plan.depart.getTime());
    s.setSpeed(Math.max(days / 35, 0.02));
    s.setPlaying(true);
    s.setRide(true);
  });

  function renderShip() {
    const s = store.getState();
    const hull = SHIP_BY_ID.get(s.shipId)!;
    shipBlurb.textContent = hull.blurb;
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
    const { plan } = store.getState();
    rideBtn.classList.toggle("hidden", !plan);
    if (!plan) {
      resultEl.innerHTML = "";
      return;
    }
    resultEl.innerHTML = `
      <div class="row"><span>departure</span><b>${fmtDate(plan.depart.getTime())}</b></div>
      <div class="row"><span>travel time</span><b>${fmtDuration(plan.travelTimeSec)}</b></div>
      <div class="row"><span>flip at</span><b>${fmtDateTime(
        plan.depart.getTime() + plan.flipTimeSec * 1000
      )}</b></div>
      <div class="row"><span>arrival</span><b>${fmtDateTime(plan.arrive.getTime())}</b></div>
      <div class="row"><span>distance</span><b>${fmtAu(plan.distanceKm)}</b></div>
      <div class="row"><span>peak velocity</span><b>${fmtVelocity(plan.vPeakKmS)}</b></div>
      <div class="row"><span>burn</span><b>${plan.accelG} g constant</b></div>
    `;
  }

  let lastLagRender = 0;
  store.subscribe((s, prev) => {
    if (s.accelG !== prev.accelG || s.shipId !== prev.shipId) renderShip();
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
  renderLag();
  renderResult();
}
