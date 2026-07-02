/** Planner panel: route pickers, g presets, output card, live light lag. */
import { ROUTE_BODIES } from "../data/bodies";
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

const G_PRESETS = [
  { g: 0.3, label: "0.3 g cruise" },
  { g: 1, label: "1 g" },
  { g: 2, label: "2 g" },
  { g: 5, label: "5 g juice" },
];

export function mountPanel(root: HTMLElement, eph: Ephemeris) {
  const options = ROUTE_BODIES.map(
    (b) => `<option value="${b.id}">${b.name}</option>`
  ).join("");

  root.innerHTML = `
    <h1>Flip <span class="accent">&amp;</span> Burn</h1>
    <p class="tagline">unofficial Expanse navigator · phase 1</p>

    <label>From
      <select id="origin">${options}</select>
    </label>
    <label>To
      <select id="dest">${options}</select>
    </label>

    <div class="g-row" id="g-row">
      ${G_PRESETS.map(
        (p) => `<button data-g="${p.g}" class="g-btn">${p.label}</button>`
      ).join("")}
    </div>

    <button id="plan-btn" class="primary">Plan flight</button>

    <div id="lag" class="lag"></div>
    <div id="result" class="result"></div>

    <p class="footnote">
      Brachistochrone, constant thrust, flip at midpoint. Gravity and orbital
      velocity ignored — negligible above ~0.1 g sustained. Planet positions:
      astronomy-engine. Belt objects: JPL Horizons, 2340–2365.
    </p>
  `;

  const origin = root.querySelector<HTMLSelectElement>("#origin")!;
  const dest = root.querySelector<HTMLSelectElement>("#dest")!;
  const gRow = root.querySelector<HTMLDivElement>("#g-row")!;
  const planBtn = root.querySelector<HTMLButtonElement>("#plan-btn")!;
  const lagEl = root.querySelector<HTMLDivElement>("#lag")!;
  const resultEl = root.querySelector<HTMLDivElement>("#result")!;

  origin.value = store.getState().originId;
  dest.value = store.getState().destId;

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

  function renderAccel() {
    const g = store.getState().accelG;
    for (const btn of gRow.querySelectorAll<HTMLButtonElement>(".g-btn")) {
      btn.classList.toggle("active", Number(btn.dataset.g) === g);
    }
  }

  function renderLag() {
    const s = store.getState();
    if (s.originId === s.destId) {
      lagEl.textContent = "";
      return;
    }
    const lag = lightLag(eph, s.originId, s.destId, new Date(s.timeMs));
    lagEl.innerHTML = `light lag <b>${fmtLag(lag)}</b> one-way · <b>${fmtLag(
      lag * 2
    )}</b> round-trip`;
  }

  function renderResult() {
    const { plan } = store.getState();
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

  // Light lag ticks with the clock; result card and buttons track state.
  let lastLagRender = 0;
  store.subscribe((s, prev) => {
    if (s.accelG !== prev.accelG) renderAccel();
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

  renderAccel();
  renderLag();
  renderResult();
}
