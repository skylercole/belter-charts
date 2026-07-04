/**
 * Camera controls, two regimes sharing one state machine:
 *
 * ORBIT (default): spherical rail around the focused body — drag orbits,
 * wheel dollies, arrows orbit/dolly, Q/E pitch. The focused body is the
 * floating origin and the camera looks at it.
 *
 * FLY: WASD slides the camera off the rail into free flight relative to the
 * focused body (R/F vertical, drag + Q/E aim, wheel surges forward). Speed
 * is scale-aware: proportional to distance from the focus body's surface,
 * so you crawl over Eros at meters per second and cross planet-space fast.
 * Clicking a body, the nav rail, or H re-rails onto orbit seamlessly.
 */
import type { Vec3 } from "../ephemeris/vec";
import { lerp } from "../ephemeris/vec";
import { BODY_BY_ID } from "../data/bodies";

/** Pseudo-body id for the ship under way; resolved by the scene. */
export const SHIP_FOCUS = "__ship__";

/** Maps a focusable id (body or pseudo-focus) to heliocentric km. */
export type PositionResolver = (id: string, date: Date) => Vec3;

const TRANSITION_SEC = 0.9;
/** fly speed: cover distance-to-surface in ~1.1 s at full throttle */
const FLY_RATE = 0.9;
const FLY_MIN_KMS = 0.02; // 20 m/s skimming a rock
const FLY_MAX_KMS = 1.5e8; // ~1 AU/s
const ORBIT_YAW_RATE = 1.3; // rad/s, arrow keys
const ORBIT_PITCH_RATE = 0.9;
const ORBIT_DOLLY_RATE = 1.6; // e-fold/s, arrow keys

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

export class FocusControls {
  focusId = "sun";
  private prevFocusId = "sun";
  private transition = 1; // 1 = settled

  mode: "orbit" | "fly" = "orbit";
  yaw = -Math.PI / 3; // orbit angle, or look-direction yaw in fly mode
  pitch = 0.9;
  /** damped targets: inputs write these, yaw/pitch ease toward them */
  yawTarget = this.yaw;
  pitchTarget = this.pitch;
  dist: number; // km from focus (orbit mode)
  private distTarget: number;
  /** camera offset from origin in fly mode, km */
  private freePos: Vec3 = { x: 0, y: 0, z: 0 };

  private dragging = false;
  /** true while the active drag pans (right/middle button) */
  private panDrag = false;
  private last = { x: 0, y: 0 };
  private viewportH = 900;
  private keys = new Set<string>();
  /** true while a ride locks the camera to the ship */
  rideLock = false;

  constructor(dom: HTMLElement, initialDistKm: number) {
    this.dist = initialDistKm;
    this.distTarget = initialDistKm;

    dom.addEventListener("contextmenu", (e) => e.preventDefault());
    dom.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      // right (2) or middle (1) button pans, CAD-style
      this.panDrag = e.button === 1 || e.button === 2;
      this.last = { x: e.clientX, y: e.clientY };
      this.viewportH = dom.clientHeight || 900;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      if (this.panDrag) {
        if (!this.rideLock) this.pan(dx, dy);
      } else if (this.mode === "fly") {
        // aim the nose: drag right looks right
        this.yawTarget -= dx * 0.0028;
        this.pitchTarget = Math.min(Math.max(this.pitchTarget - dy * 0.0028, -1.5), 1.5);
      } else {
        this.yawTarget -= dx * 0.005;
        this.pitchTarget = Math.min(Math.max(this.pitchTarget - dy * 0.005, -1.45), 1.45);
      }
    });
    dom.addEventListener("pointerup", () => (this.dragging = false));
    dom.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = this.normalizeWheel(e);
        if (this.mode === "fly") {
          // surge along the look direction, scale-aware
          this.translate(this.lookDir(), -delta * 0.0015 * this.flySpeed());
        } else {
          this.distTarget *= Math.exp(delta * 0.0012);
          this.clampDist();
        }
      },
      { passive: false }
    );

    window.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  /**
   * Wheel delta in consistent "pixel" units: lines/pages scaled up, trackpad
   * pinch (ctrlKey) boosted to match discrete-wheel feel.
   */
  private normalizeWheel(e: WheelEvent): number {
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16; // lines
    else if (e.deltaMode === 2) d *= 120; // pages
    if (e.ctrlKey) d *= 4; // pinch gesture emits small deltas
    return Math.max(Math.min(d, 300), -300);
  }

  private minDist(): number {
    const def = BODY_BY_ID.get(this.focusId);
    if (def) return Math.max(def.radiusKm * 2.2, 5);
    // pseudo-foci: hull half-length is ~23 m, stop just outside it
    return this.focusId === SHIP_FOCUS ? 0.06 : 1;
  }

  private focusRadius(): number {
    return BODY_BY_ID.get(this.focusId)?.radiusKm ?? 1;
  }

  private clampDist() {
    this.distTarget = Math.min(Math.max(this.distTarget, this.minDist()), 7e9);
  }

  /** External override of the dolly target (attract mode, scenarios). */
  setDistTarget(km: number) {
    this.distTarget = km;
    this.clampDist();
  }

  focus(bodyId: string) {
    this.exitFly();
    if (bodyId === this.focusId) return;
    this.prevFocusId = this.focusId;
    this.focusId = bodyId;
    this.transition = 0;
    const def = BODY_BY_ID.get(bodyId);
    this.distTarget = def ? Math.max(def.radiusKm * 6, 40) : 2500; // pseudo: chase distance
    this.clampDist();
  }

  /** Leave fly mode, converting the free position back to rail coordinates. */
  private exitFly() {
    if (this.mode !== "fly") return;
    this.mode = "orbit";
    const p = this.freePos;
    const r = Math.max(Math.hypot(p.x, p.y, p.z), this.minDist());
    this.dist = r;
    this.distTarget = r;
    this.yaw = this.yawTarget = Math.atan2(p.y, p.x);
    this.pitch = this.pitchTarget = Math.asin(Math.min(Math.max(p.z / r, -1), 1));
    this.clampDist();
  }

  /** Look direction in fly mode (unit vector, +z = ecliptic north). */
  private lookDir(): Vec3 {
    const cp = Math.cos(this.pitch);
    return {
      x: cp * Math.cos(this.yaw),
      y: cp * Math.sin(this.yaw),
      z: Math.sin(this.pitch),
    };
  }

  private flySpeed(): number {
    const r = Math.hypot(this.freePos.x, this.freePos.y, this.freePos.z);
    const alt = Math.max(r - this.focusRadius(), 0.5);
    const boost = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 4 : 1;
    return Math.min(Math.max(alt * FLY_RATE, FLY_MIN_KMS), FLY_MAX_KMS) * boost;
  }

  /**
   * Screen-space pan: grab the world and drag it, 1:1 with the cursor at the
   * focus distance. Enters fly mode from the rail (panning is a lateral
   * offset, which the rail cannot represent).
   */
  private pan(dxPx: number, dyPx: number) {
    if (this.mode === "orbit") {
      this.mode = "fly";
      this.freePos = this.cameraOffsetOrbit();
      const r = Math.hypot(this.freePos.x, this.freePos.y, this.freePos.z) || 1;
      this.yaw = this.yawTarget = Math.atan2(-this.freePos.y, -this.freePos.x);
      this.pitch = this.pitchTarget = Math.asin(
        Math.min(Math.max(-this.freePos.z / r, -1), 1)
      );
    }
    const r = Math.hypot(this.freePos.x, this.freePos.y, this.freePos.z) || 1;
    const kmPerPx = (2 * r * Math.tan((50 * Math.PI) / 360)) / this.viewportH;

    const fwd = this.lookDir();
    const rx = fwd.y;
    const ry = -fwd.x;
    const rl = Math.hypot(rx, ry) || 1;
    const right = { x: rx / rl, y: ry / rl, z: 0 };
    // view-plane up = right x fwd
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x,
    };
    // drag right -> world follows cursor -> camera moves left
    this.translate(right, -dxPx * kmPerPx);
    this.translate(up, dyPx * kmPerPx);
  }

  private translate(dir: Vec3, amount: number) {
    this.freePos.x += dir.x * amount;
    this.freePos.y += dir.y * amount;
    this.freePos.z += dir.z * amount;
    // soft collision with the focus body
    const r = Math.hypot(this.freePos.x, this.freePos.y, this.freePos.z);
    const floor = this.focusRadius() * 1.08;
    if (r < floor && r > 0) {
      const k = floor / r;
      this.freePos.x *= k;
      this.freePos.y *= k;
      this.freePos.z *= k;
    }
  }

  private handleKeys(dt: number) {
    const k = this.keys;
    const wantsFly =
      k.has("KeyW") || k.has("KeyA") || k.has("KeyS") || k.has("KeyD") ||
      k.has("KeyR") || k.has("KeyF");

    if (this.mode === "orbit") {
      // enter fly mode from the rail (not while a ride owns the camera)
      if (wantsFly && !this.rideLock) {
        this.mode = "fly";
        // start where the rail camera is, looking at the focus body
        this.freePos = this.cameraOffsetOrbit();
        const r = Math.hypot(this.freePos.x, this.freePos.y, this.freePos.z) || 1;
        this.yaw = this.yawTarget = Math.atan2(-this.freePos.y, -this.freePos.x);
        this.pitch = this.pitchTarget = Math.asin(
          Math.min(Math.max(-this.freePos.z / r, -1), 1)
        );
      } else {
        // arrows ride the rail; Q/E pitch; +/- dolly
        if (k.has("ArrowLeft")) this.yawTarget += ORBIT_YAW_RATE * dt;
        if (k.has("ArrowRight")) this.yawTarget -= ORBIT_YAW_RATE * dt;
        if (k.has("KeyQ"))
          this.pitchTarget = Math.min(this.pitchTarget + ORBIT_PITCH_RATE * dt, 1.45);
        if (k.has("KeyE"))
          this.pitchTarget = Math.max(this.pitchTarget - ORBIT_PITCH_RATE * dt, -1.45);
        const zoomIn = k.has("ArrowUp") || k.has("Equal") || k.has("NumpadAdd");
        const zoomOut = k.has("ArrowDown") || k.has("Minus") || k.has("NumpadSubtract");
        if (zoomIn) {
          this.distTarget *= Math.exp(-ORBIT_DOLLY_RATE * dt);
          this.clampDist();
        }
        if (zoomOut) {
          this.distTarget *= Math.exp(ORBIT_DOLLY_RATE * dt);
          this.clampDist();
        }
        return;
      }
    }

    // fly mode
    const fwd = this.lookDir();
    const up = { x: 0, y: 0, z: 1 };
    // right = fwd x up (normalized; degenerate looking straight up/down is fine
    // because pitch is clamped short of vertical)
    const rx = fwd.y * up.z - fwd.z * up.y;
    const ry = fwd.z * up.x - fwd.x * up.z;
    const rl = Math.hypot(rx, ry) || 1;
    const right = { x: rx / rl, y: ry / rl, z: 0 };

    const v = this.flySpeed() * dt;
    if (k.has("KeyW")) this.translate(fwd, v);
    if (k.has("KeyS")) this.translate(fwd, -v);
    if (k.has("KeyA")) this.translate(right, -v);
    if (k.has("KeyD")) this.translate(right, v);
    if (k.has("KeyR")) this.translate(up, v);
    if (k.has("KeyF")) this.translate(up, -v);
    if (k.has("KeyQ"))
      this.pitchTarget = Math.min(this.pitchTarget + ORBIT_PITCH_RATE * dt, 1.5);
    if (k.has("KeyE"))
      this.pitchTarget = Math.max(this.pitchTarget - ORBIT_PITCH_RATE * dt, -1.5);
  }

  /** Advance animations; returns the floating origin in heliocentric km. */
  update(dt: number, resolve: PositionResolver, date: Date): Vec3 {
    this.handleKeys(dt);
    if (this.transition < 1) {
      this.transition = Math.min(this.transition + dt / TRANSITION_SEC, 1);
    }
    // critically-damped-ish easing on rotation and dolly (industry feel:
    // inputs write targets, the camera glides after them)
    const rk = Math.min(dt * 14, 1);
    this.yaw += (this.yawTarget - this.yaw) * rk;
    this.pitch += (this.pitchTarget - this.pitch) * rk;
    if (this.mode === "orbit") {
      this.dist += (this.distTarget - this.dist) * Math.min(dt * 6, 1);
    }

    const to = resolve(this.focusId, date);
    if (this.transition >= 1) return to;
    const from = resolve(this.prevFocusId, date);
    return lerp(from, to, easeInOut(this.transition));
  }

  private cameraOffsetOrbit(): Vec3 {
    const cp = Math.cos(this.pitch);
    return {
      x: this.dist * cp * Math.cos(this.yaw),
      y: this.dist * cp * Math.sin(this.yaw),
      z: this.dist * Math.sin(this.pitch),
    };
  }

  /** Camera position relative to the origin (world coordinates), km. */
  cameraOffset(): Vec3 {
    return this.mode === "fly" ? { ...this.freePos } : this.cameraOffsetOrbit();
  }

  /** Where the camera should look, in world coordinates. */
  lookTarget(): Vec3 {
    if (this.mode !== "fly") return { x: 0, y: 0, z: 0 };
    const d = this.lookDir();
    const r = Math.max(Math.hypot(this.freePos.x, this.freePos.y, this.freePos.z), 1);
    return {
      x: this.freePos.x + d.x * r,
      y: this.freePos.y + d.y * r,
      z: this.freePos.z + d.z * r,
    };
  }
}
