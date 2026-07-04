/**
 * Attract mode: after idle time with nothing happening, a slow cinematic
 * tour drifts between showcase bodies. Any input exits immediately.
 */
import type { FocusControls } from "./controls";

const IDLE_MS = 45_000;
const STOP_SEC = 9;

interface Stop {
  bodyId: string;
  /** camera distance as multiple of body radius (via controls' own framing) */
  dist?: number;
}

const TOUR: Stop[] = [
  { bodyId: "eros", dist: 60 },
  { bodyId: "saturn", dist: 320_000 },
  { bodyId: "jupiter", dist: 350_000 },
  { bodyId: "ceres", dist: 3_000 },
  { bodyId: "earth", dist: 30_000 },
  { bodyId: "sun", dist: 1.2e9 },
];

export class AttractMode {
  active = false;
  private lastInput = performance.now();
  private stopIdx = 0;
  private stopElapsed = 0;

  constructor(private controls: FocusControls, dom: HTMLElement) {
    const poke = () => {
      this.lastInput = performance.now();
      if (this.active) this.exit();
    };
    for (const ev of ["pointerdown", "wheel", "keydown"]) {
      window.addEventListener(ev, poke, { capture: true, passive: true });
    }
    void dom;
  }

  private exit() {
    this.active = false;
  }

  /** @param busy true when playing, riding, or a beam is in flight */
  update(dt: number, busy: boolean) {
    if (busy) {
      this.lastInput = performance.now();
      if (this.active) this.exit();
      return;
    }
    if (!this.active) {
      if (performance.now() - this.lastInput > IDLE_MS) {
        this.active = true;
        this.stopIdx = -1;
        this.stopElapsed = STOP_SEC; // advance immediately
      } else {
        return;
      }
    }
    this.stopElapsed += dt;
    if (this.stopElapsed >= STOP_SEC) {
      this.stopElapsed = 0;
      this.stopIdx = (this.stopIdx + 1) % TOUR.length;
      const stop = TOUR[this.stopIdx];
      this.controls.focus(stop.bodyId);
      if (stop.dist) this.controls.setDistTarget(stop.dist);
      this.controls.pitchTarget = 0.15 + Math.random() * 0.5;
    }
    // slow cinematic drift
    this.controls.yawTarget += dt * 0.045;
  }
}
