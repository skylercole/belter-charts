/** Ride-the-burn HUD: phase, velocity, g, progress, mute/exit. */
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
  off: "DOCKED",
};

export class RideHud {
  private root: HTMLDivElement;
  private phaseEl: HTMLDivElement;
  private rows: HTMLDivElement;
  private bar: HTMLDivElement;
  private muteBtn: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "ride-hud";
    this.root.innerHTML = `
      <div class="hud-phase"></div>
      <div class="hud-rows"></div>
      <div class="hud-bar"><div class="hud-bar-fill"></div></div>
      <div class="hud-btns">
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

    this.root.querySelector(".hud-exit")!.addEventListener("click", () => {
      const s = store.getState();
      s.setRide(false);
      s.setPlaying(false);
      s.setSpeed(2);
    });
    this.muteBtn.addEventListener("click", () => store.getState().toggleMuted());
  }

  update(visible: boolean, plan: FlightPlan | null, timeMs: number, phase: BurnPhase) {
    this.root.classList.toggle("hidden", !visible);
    if (!visible || !plan) return;

    const T = plan.travelTimeSec;
    const t = Math.min(Math.max((timeMs - plan.depart.getTime()) / 1000, 0), T);
    const accel = plan.accelG * G0;
    const v = accel * Math.min(t, T - t);
    const destName = BODY_BY_ID.get(plan.destId)?.name ?? plan.destId;

    this.phaseEl.textContent = PHASE_LABEL[phase];
    this.phaseEl.dataset.phase = phase;
    this.rows.innerHTML = `
      <div><span>velocity</span><b>${fmtVelocity(v)}</b></div>
      <div><span>thrust</span><b>${phase === "flip" ? "0" : plan.accelG} g</b></div>
      <div><span>to ${destName}</span><b>${fmtDuration(T - t)}</b></div>
    `;
    this.bar.style.width = `${(100 * t) / T}%`;
    this.muteBtn.textContent = store.getState().muted ? "♪̸" : "♪";
    this.muteBtn.classList.toggle("muted", store.getState().muted);
  }
}
