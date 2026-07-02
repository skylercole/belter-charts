/**
 * Phase 0 map: top-down 2D canvas view of the ecliptic (looking down from
 * ecliptic north, +x right toward the vernal equinox, +y up). Pan by drag,
 * zoom on wheel toward the cursor. Orbits are traced from the ephemeris
 * itself (one trailing period, clamped to data coverage), so what you see is
 * what the planner uses.
 */
import { BODIES, type BodyDef } from "../data/bodies";
import type { Ephemeris } from "../ephemeris";
import { sampleOrbitPath, type OrbitPath } from "../ephemeris/orbitpath";
import { dateToJd } from "../ephemeris/time";
import { shipPosition, type FlightPlan } from "../planner";

const AU_KM = 149_597_870.7;
const ORBIT_SAMPLES = 360;
/** Re-sample a cached orbit path when the clock moves this far. */
const ORBIT_CACHE_DAYS = 45;

export class Map2D {
  private ctx: CanvasRenderingContext2D;
  private centerKm = { x: 0, y: 0 };
  private kmPerPx = (7 * AU_KM) / 400;
  private orbitCache = new Map<string, OrbitPath>();
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private eph: Ephemeris
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * this.dpr;
    this.canvas.height = this.canvas.clientHeight * this.dpr;
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.centerKm.x -= dx * this.kmPerPx;
      this.centerKm.y += dy * this.kmPerPx; // screen y is flipped
    });
    c.addEventListener("pointerup", () => (this.dragging = false));
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.0015);
        const before = this.screenToKm(e.clientX, e.clientY);
        this.kmPerPx = Math.min(
          Math.max(this.kmPerPx * factor, 50),
          (80 * AU_KM) / 400
        );
        const after = this.screenToKm(e.clientX, e.clientY);
        this.centerKm.x += before.x - after.x;
        this.centerKm.y += before.y - after.y;
      },
      { passive: false }
    );
  }

  private screenToKm(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left - rect.width / 2;
    const py = clientY - rect.top - rect.height / 2;
    return {
      x: this.centerKm.x + px * this.kmPerPx,
      y: this.centerKm.y - py * this.kmPerPx,
    };
  }

  private kmToScreen(x: number, y: number): [number, number] {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    return [
      w / 2 + (x - this.centerKm.x) / this.kmPerPx,
      h / 2 - (y - this.centerKm.y) / this.kmPerPx,
    ];
  }

  private orbitPath(body: BodyDef, jdNow: number): OrbitPath {
    const cached = this.orbitCache.get(body.id);
    if (cached && Math.abs(cached.jdCenter - jdNow) < ORBIT_CACHE_DAYS) {
      return cached;
    }
    const entry = sampleOrbitPath(this.eph, body, jdNow, ORBIT_SAMPLES);
    this.orbitCache.set(body.id, entry);
    return entry;
  }

  render(timeMs: number, plan: FlightPlan | null) {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#06080f";
    ctx.fillRect(0, 0, w, h);

    const date = new Date(timeMs);
    const jdNow = dateToJd(date);

    // Sun
    const [sx, sy] = this.kmToScreen(0, 0);
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 26);
    glow.addColorStop(0, "rgba(255, 214, 130, 0.9)");
    glow.addColorStop(1, "rgba(255, 214, 130, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd27d";
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Orbits + bodies
    ctx.font = "11px ui-monospace, monospace";
    for (const body of BODIES) {
      if (body.kind === "star") continue;
      const orbit = this.orbitPath(body, jdNow);
      ctx.strokeStyle = body.color + "38";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < ORBIT_SAMPLES; i++) {
        const [x, y] = this.kmToScreen(orbit.pts[i * 3], orbit.pts[i * 3 + 1]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      if (orbit.closed) ctx.closePath();
      ctx.stroke();

      const s = this.eph.stateOf(body.id, date);
      const [bx, by] = this.kmToScreen(s.pos.x, s.pos.y);
      if (bx < -50 || bx > w + 50 || by < -50 || by > h + 50) continue;
      const r = body.kind === "planet" ? 4 : body.kind === "station" ? 2.5 : 3;
      ctx.fillStyle = body.color;
      if (body.kind === "station") {
        // diamond
        ctx.beginPath();
        ctx.moveTo(bx, by - 4);
        ctx.lineTo(bx + 4, by);
        ctx.lineTo(bx, by + 4);
        ctx.lineTo(bx - 4, by);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = body.color + "cc";
      ctx.fillText(body.name, bx + 7, by + 4);
    }

    if (plan) this.renderPlan(plan, timeMs);

    // Scale bar
    this.renderScaleBar(w, h);
  }

  private renderPlan(plan: FlightPlan, timeMs: number) {
    const ctx = this.ctx;
    const [x0, y0] = this.kmToScreen(plan.departPos.x, plan.departPos.y);
    const [x1, y1] = this.kmToScreen(plan.arrivePos.x, plan.arrivePos.y);

    ctx.strokeStyle = "#7fd4a8";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    // Flip point: midpoint of the chord.
    const flip = shipPosition(plan, plan.flipTimeSec);
    const [fx, fy] = this.kmToScreen(flip.x, flip.y);
    ctx.strokeStyle = "#ffd27d";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx - 5, fy - 5);
    ctx.lineTo(fx + 5, fy + 5);
    ctx.moveTo(fx + 5, fy - 5);
    ctx.lineTo(fx - 5, fy + 5);
    ctx.stroke();
    ctx.fillStyle = "#ffd27daa";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("flip", fx + 8, fy - 6);

    // Ship during the flight window.
    const tSec = (timeMs - plan.depart.getTime()) / 1000;
    if (tSec >= 0 && tSec <= plan.travelTimeSec) {
      const pos = shipPosition(plan, tSec);
      const [px, py] = this.kmToScreen(pos.x, pos.y);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff66";
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private renderScaleBar(w: number, h: number) {
    const ctx = this.ctx;
    const targetPx = 120;
    const targetAu = (targetPx * this.kmPerPx) / AU_KM;
    // round to 1-2-5 series
    const pow = Math.pow(10, Math.floor(Math.log10(targetAu)));
    const mult = targetAu / pow;
    const nice = mult >= 5 ? 5 : mult >= 2 ? 2 : 1;
    const au = nice * pow;
    const px = (au * AU_KM) / this.kmPerPx;

    const x = w - px - 24;
    const y = h - 20;
    ctx.strokeStyle = "#8899aa";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.moveTo(x + px, y - 4);
    ctx.lineTo(x + px, y + 4);
    ctx.stroke();
    ctx.fillStyle = "#8899aa";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(au < 0.01 ? `${(au * AU_KM).toFixed(0)} km` : `${au} AU`, x, y - 8);
  }
}
