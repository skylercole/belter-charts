/**
 * Focus-and-follow camera. The focused body is the floating origin: it sits
 * at world (0,0,0) and the camera orbits it in spherical coordinates
 * (z = ecliptic north). Focus changes animate the origin along the line
 * between the two (moving) bodies, so the world never teleports.
 */
import type { Vec3 } from "../ephemeris/vec";
import { lerp } from "../ephemeris/vec";
import { BODY_BY_ID } from "../data/bodies";

/** Pseudo-body id for the ship under way; resolved by the scene. */
export const SHIP_FOCUS = "__ship__";

/** Maps a focusable id (body or SHIP_FOCUS) to heliocentric km. */
export type PositionResolver = (id: string, date: Date) => Vec3;

const TRANSITION_SEC = 0.9;

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

export class FocusControls {
  focusId = "sun";
  private prevFocusId = "sun";
  private transition = 1; // 1 = settled

  yaw = -Math.PI / 3;
  pitch = 0.9; // radians above ecliptic
  dist: number; // km from focus
  private distTarget: number;

  private dragging = false;
  private last = { x: 0, y: 0 };

  constructor(dom: HTMLElement, initialDistKm: number) {
    this.dist = initialDistKm;
    this.distTarget = initialDistKm;

    dom.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.last = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * 0.005;
      this.pitch = Math.min(Math.max(this.pitch - dy * 0.005, -1.45), 1.45);
    });
    dom.addEventListener("pointerup", () => (this.dragging = false));
    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distTarget *= Math.exp(e.deltaY * 0.0012);
        this.clampDist();
      },
      { passive: false }
    );
  }

  private minDist(): number {
    const def = BODY_BY_ID.get(this.focusId);
    return def ? Math.max(def.radiusKm * 2.2, 5) : 1;
  }

  private clampDist() {
    this.distTarget = Math.min(
      Math.max(this.distTarget, this.minDist()),
      7e9 // ~47 AU
    );
  }

  /** External override of the dolly target (attract mode, scenarios). */
  setDistTarget(km: number) {
    this.distTarget = km;
    this.clampDist();
  }

  focus(bodyId: string) {
    if (bodyId === this.focusId) return;
    this.prevFocusId = this.focusId;
    this.focusId = bodyId;
    this.transition = 0;
    const def = BODY_BY_ID.get(bodyId);
    this.distTarget = def ? Math.max(def.radiusKm * 6, 40) : 2500; // ship: chase distance
    this.clampDist();
  }

  /** Advance animations; returns the floating origin in heliocentric km. */
  update(dt: number, resolve: PositionResolver, date: Date): Vec3 {
    if (this.transition < 1) {
      this.transition = Math.min(this.transition + dt / TRANSITION_SEC, 1);
    }
    // critically-damped-ish dolly
    this.dist += (this.distTarget - this.dist) * Math.min(dt * 6, 1);

    const to = resolve(this.focusId, date);
    if (this.transition >= 1) return to;
    const from = resolve(this.prevFocusId, date);
    return lerp(from, to, easeInOut(this.transition));
  }

  /** Camera position relative to the origin (i.e. world coordinates), km. */
  cameraOffset(): Vec3 {
    const cp = Math.cos(this.pitch);
    return {
      x: this.dist * cp * Math.cos(this.yaw),
      y: this.dist * cp * Math.sin(this.yaw),
      z: this.dist * Math.sin(this.pitch),
    };
  }
}
