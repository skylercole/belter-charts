/** Ride-the-burn HUD: phase, velocity, g, progress, cockpit/mute/exit. */
import type { FlightPlan } from "../planner";
import { G0 } from "../planner";
import { BODY_BY_ID } from "../data/bodies";
import { fmtDuration, fmtVelocity } from "../ui/format";
import { store } from "../ui/store";
import type { BurnPhase } from "./ship";

const PHASE_LABEL: Record<BurnPhase, string> = {
  burn: "BURN",
  flip: "FLIP — DRIVE OFF",
  brake: "BRAKE",
  dock: "DOCKING",
  off: "DOCKED",
};

export class RideHud {
  private root: HTMLDivElement;
  private phaseEl: HTMLDivElement;
  private rows: HTMLDivElement;
  private bar: HTMLDivElement;
  private muteBtn: HTMLButtonElement;
  private viewBtn: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "ride-hud";
    this.root.innerHTML = `
      <div class="hud-phase"></div>
      <div class="hud-rows"></div>
      <div class="hud-bar"><div class="hud-bar-fill"></div></div>
      <div class="hud-btns">
        <button class="hud-view" title="toggle cockpit / chase view">cockpit</button>
        <button class="hud-mute" title="mute">♪</button>
        <button class="hud-exit">release couch ✕</button>
      </div>
    `;
    this.root.classList.add("hidden");
    container.appendChild(this.root);

    this.phaseEl = this.root.querySelector(".hud-phase")!;
    this.rows = this.root.querySelector(".hud-rows")!;
    this.bar = this.root.querySelector(".hud-bar-fill")!;
    this.muteBtn = this.root.querySelector(".hud-mute")!;
    this.viewBtn = this.root.querySelector(".hud-view")!;

    this.root.querySelector(".hud-exit")!.addEventListener("click", () => {
      const s = store.getState();
      s.setRide(false);
      s.setPlaying(false);
      s.setSpeed(2);
    });
    this.muteBtn.addEventListener("click", () => store.getState().toggleMuted());
    this.viewBtn.addEventListener("click", () => {
      const s = store.getState();
      s.setCockpit(!s.cockpit);
    });
  }

  update(
    visible: boolean,
    plan: FlightPlan | null,
    timeMs: number,
    phase: BurnPhase,
    scenario: "epstein" | null,
    cockpit: boolean
  ) {
    this.root.classList.toggle("hidden", !visible);
    if (!visible || !plan) return;

    const epstein = scenario === "epstein";
    // For the Epstein scenario the "flight" is encoded as accelerate-only up
    // to the pseudo-flip (fuel exhaustion); progress runs against that.
    const T = epstein ? plan.flipTimeSec : plan.travelTimeSec;
    const t = Math.min(Math.max((timeMs - plan.depart.getTime()) / 1000, 0), T);
    const accel = plan.accelG * G0;
    const v = epstein ? accel * t : accel * Math.min(t, plan.travelTimeSec - t);

    this.phaseEl.textContent =
      epstein && phase === "burn"
        ? "RUNAWAY BURN"
        : epstein
          ? "DRIVE OFF"
          : PHASE_LABEL[phase];
    this.phaseEl.dataset.phase = epstein ? "flip" : phase;

    if (epstein) {
      const fuel = Math.max(0, 100 * (1 - t / T));
      this.rows.innerHTML = `
        <div><span>velocity</span><b>${fmtVelocity(v)}</b></div>
        <div><span>thrust</span><b>${plan.accelG} g</b></div>
        <div><span>fuel</span><b>${fuel.toFixed(0)}%</b></div>
        <div><span>burn time</span><b>${fmtDuration(t)}</b></div>
      `;
    } else {
      const destName = BODY_BY_ID.get(plan.destId)?.name ?? plan.destId;
      this.rows.innerHTML = `
        <div><span>velocity</span><b>${fmtVelocity(v)}</b></div>
        <div><span>thrust</span><b>${phase === "flip" ? "0" : plan.accelG} g</b></div>
        <div><span>to ${destName}</span><b>${fmtDuration(T - t)}</b></div>
      `;
    }
    this.bar.style.width = `${(100 * t) / T}%`;
    this.muteBtn.textContent = store.getState().muted ? "♪̸" : "♪";
    this.muteBtn.classList.toggle("muted", store.getState().muted);
    this.viewBtn.textContent = cockpit ? "chase" : "cockpit";
  }
}
