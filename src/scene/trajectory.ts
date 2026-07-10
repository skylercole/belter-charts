/**
 * Flight-plan visuals: the sampled route curve split at the ship into a
 * flown (solid, fading) and an ahead (dashed) line, time-tick markers with
 * sparse labels, flip cross, departure diamond, intercept ring. Vertices are
 * rewritten every frame in origin-relative km (Float64 math on the CPU), so
 * they inherit floating-origin stability.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Vec3 } from "../ephemeris/vec";
import {
  samplePath,
  samplePathFrac,
  shipPosition,
  shipVelocity,
  type FlightPlan,
} from "../planner";
import { fmtDateTime, fmtDuration } from "../ui/format";

export const TARGET_PATH_PTS = 48;
/** samples along the route curve (cosine-spaced, dense at the endpoints) */
const ROUTE_PTS = 128;
const MAX_TICKS = 64;
const TICK_LABELS = 8;
/** route green as rgb components */
const ROUTE_R = 0x7f / 255;
const ROUTE_G = 0xd4 / 255;
const ROUTE_B = 0xa8 / 255;
/** tick interval ladder, seconds */
const TICK_LADDER = [
  3 * 3600,
  6 * 3600,
  12 * 3600,
  86_400,
  2 * 86_400,
  5 * 86_400,
  10 * 86_400,
  20 * 86_400,
  50 * 86_400,
];
const TICK_MIN_PX = 28;

function ringTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "#7fd4a8";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(32, 32, 24, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function crossTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "#ffd27d";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(12, 12);
  ctx.lineTo(52, 52);
  ctx.moveTo(52, 12);
  ctx.lineTo(12, 52);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function diamondTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.strokeStyle = "#7fd4a8";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.lineTo(56, 32);
  ctx.lineTo(32, 56);
  ctx.lineTo(8, 32);
  ctx.closePath();
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tickTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(16, 16, 7, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** compact "+3d" / "+18h" tick label */
function fmtTick(sec: number): string {
  if (sec >= 86_400) {
    const d = sec / 86_400;
    return Number.isInteger(d) ? `+${d}d` : `+${d.toFixed(1)}d`;
  }
  return `+${Math.round(sec / 3600)}h`;
}

function makeLabel(className: string, text = ""): CSS2DObject {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return new CSS2DObject(el);
}

export class TrajectoryVisual {
  /** portion already flown: solid, fading up toward the ship */
  private flownLine: THREE.Line;
  private flownGeo: THREE.BufferGeometry;
  /** portion still ahead: bright dashes marching from the ship */
  private aheadLine: THREE.Line;
  private aheadGeo: THREE.BufferGeometry;
  private flip: THREE.Sprite;
  private depart: THREE.Sprite;
  /** rendezvous ring at the route end: the target WILL be here at arrival */
  private intercept: THREE.Sprite;
  /** the target's own future path from its current position to the intercept */
  private targetPath: THREE.Line;
  private targetPathGeo: THREE.BufferGeometry;
  /** time-tick markers along the route, one batched Points */
  private ticks: THREE.Points;
  private ticksGeo: THREE.BufferGeometry;
  private tickLabelAnchors: THREE.Object3D[] = [];
  private tickLabelEls: HTMLDivElement[] = [];
  private flipLabel: CSS2DObject;
  private departLabel: CSS2DObject;
  private interceptLabel: CSS2DObject;

  private plan: FlightPlan | null = null;
  private expired = false;
  /** heliocentric route samples, cosine-spaced in time (dense at endpoints) */
  private routePts = new Float64Array(ROUTE_PTS * 3);
  /** heliocentric tick positions + their flight times */
  private tickPts = new Float64Array(MAX_TICKS * 3);
  private tickTimes = new Float64Array(MAX_TICKS);
  private tickCount = 0;
  /** zoom bucket (log2 km/px) the tick schedule was built for */
  private tickBucket = Infinity;

  constructor(scene: THREE.Scene) {
    this.flownGeo = new THREE.BufferGeometry();
    this.flownGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array((ROUTE_PTS + 1) * 3), 3)
    );
    this.flownGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array((ROUTE_PTS + 1) * 3), 3)
    );
    // Route lines are chart furniture: depthTest off so the screen-constant
    // ship hull (millions of km across at chase zoom) can't swallow them.
    this.flownLine = new THREE.Line(
      this.flownGeo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.flownLine.frustumCulled = false;
    this.flownLine.renderOrder = 4;

    this.aheadGeo = new THREE.BufferGeometry();
    this.aheadGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array((ROUTE_PTS + 1) * 3), 3)
    );
    this.aheadGeo.setAttribute(
      "lineDistance",
      new THREE.BufferAttribute(new Float32Array(ROUTE_PTS + 1), 1)
    );
    this.aheadLine = new THREE.Line(
      this.aheadGeo,
      new THREE.LineDashedMaterial({
        color: 0x7fd4a8,
        dashSize: 1,
        gapSize: 1,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.aheadLine.frustumCulled = false;
    this.aheadLine.renderOrder = 4;

    this.flip = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: crossTexture(), depthTest: false })
    );
    this.flip.renderOrder = 6;
    this.flipLabel = makeLabel("traj-marker-label amber");
    this.flipLabel.center.set(-0.15, 1.6);
    this.flip.add(this.flipLabel);

    this.depart = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: diamondTexture(), depthTest: false })
    );
    this.depart.renderOrder = 6;
    this.departLabel = makeLabel("traj-marker-label");
    this.departLabel.center.set(-0.15, 1.6);
    this.depart.add(this.departLabel);

    this.intercept = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), depthTest: false })
    );
    this.intercept.renderOrder = 6;
    this.interceptLabel = makeLabel("beam-label", "intercept");
    this.interceptLabel.center.set(-0.15, 1.6);
    this.intercept.add(this.interceptLabel);

    this.ticksGeo = new THREE.BufferGeometry();
    this.ticksGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_TICKS * 3), 3)
    );
    this.ticksGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(MAX_TICKS * 3), 3)
    );
    this.ticks = new THREE.Points(
      this.ticksGeo,
      new THREE.PointsMaterial({
        map: tickTexture(),
        size: 7,
        sizeAttenuation: false,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
        vertexColors: true,
      })
    );
    this.ticks.renderOrder = 5;
    this.ticks.frustumCulled = false;

    // Sparse tick labels: a fixed pool of CSS2D anchors, reused forever.
    for (let i = 0; i < TICK_LABELS; i++) {
      const anchor = new THREE.Object3D();
      const label = makeLabel("traj-tick-label");
      anchor.add(label);
      anchor.visible = false;
      this.tickLabelAnchors.push(anchor);
      this.tickLabelEls.push(label.element as HTMLDivElement);
      scene.add(anchor);
    }

    this.targetPathGeo = new THREE.BufferGeometry();
    this.targetPathGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(TARGET_PATH_PTS * 3), 3)
    );
    this.targetPath = new THREE.Line(
      this.targetPathGeo,
      new THREE.LineDashedMaterial({
        color: 0xffd27d,
        dashSize: 1,
        gapSize: 1.2,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        depthTest: false,
      })
    );
    this.targetPath.frustumCulled = false;
    this.targetPath.renderOrder = 4;

    scene.add(
      this.flownLine,
      this.aheadLine,
      this.flip,
      this.depart,
      this.intercept,
      this.targetPath,
      this.ticks
    );
    this.setPlan(null);
  }

  setPlan(plan: FlightPlan | null) {
    this.plan = plan;
    this.expired = false;
    this.tickBucket = Infinity; // force tick schedule rebuild
    if (plan) {
      samplePath(plan, ROUTE_PTS, this.routePts);
      const departMs = plan.depart.getTime();
      (this.flipLabel.element as HTMLDivElement).textContent =
        `flip · +${fmtDuration(plan.flipTimeSec)}`;
      (this.departLabel.element as HTMLDivElement).textContent =
        `depart · ${fmtDateTime(departMs)}`;
      (this.interceptLabel.element as HTMLDivElement).textContent =
        `intercept · ${fmtDateTime(plan.arrive.getTime())}`;
    }
    this.applyVisibility();
  }

  /** Flight over: retire the whole overlay so the target isn't "missing" a
   * chord that no longer means anything. */
  setExpired(expired: boolean) {
    if (expired === this.expired) return;
    this.expired = expired;
    this.applyVisibility();
  }

  private applyVisibility() {
    const on = !!this.plan && !this.expired;
    this.flownLine.visible = on;
    this.aheadLine.visible = on;
    this.flip.visible = on;
    this.depart.visible = on;
    this.intercept.visible = on;
    this.ticks.visible = on;
    if (!on) {
      for (const a of this.tickLabelAnchors) a.visible = false;
    }
    this.targetPath.visible = false; // shown only mid-flight via updateTargetPath
    if (this.plan) {
      // Dash pattern scaled to the route so it reads at any length.
      const mat = this.aheadLine.material as THREE.LineDashedMaterial;
      mat.dashSize = this.plan.arcLengthKm / 80;
      mat.gapSize = this.plan.arcLengthKm / 120;
      const tp = this.targetPath.material as THREE.LineDashedMaterial;
      tp.dashSize = this.plan.arcLengthKm / 140;
      tp.gapSize = this.plan.arcLengthKm / 170;
    }
  }

  /**
   * Mid-flight: draw the target's future path from where it is now to the
   * intercept point. pts = flat heliocentric km triplets, count valid points.
   */
  updateTargetPath(pts: Float64Array, count: number, originKm: Vec3) {
    if (!this.plan || this.expired || count < 2) {
      this.targetPath.visible = false;
      return;
    }
    const attr = this.targetPathGeo.attributes.position as THREE.BufferAttribute;
    const dst = attr.array as Float32Array;
    for (let i = 0; i < count * 3; i += 3) {
      dst[i] = pts[i] - originKm.x;
      dst[i + 1] = pts[i + 1] - originKm.y;
      dst[i + 2] = pts[i + 2] - originKm.z;
    }
    this.targetPathGeo.setDrawRange(0, count);
    attr.needsUpdate = true;
    this.targetPath.computeLineDistances();
    this.targetPath.visible = true;
  }

  update(
    originKm: Vec3,
    kmPerPixelAt: (p: Vec3) => number,
    timeMs: number,
    showTicks: boolean
  ) {
    const plan = this.plan;
    if (!plan || this.expired) return;
    const T = plan.travelTimeSec;
    const tSec = (timeMs - plan.depart.getTime()) / 1000;
    const f = Math.min(Math.max(T === 0 ? 0 : tSec / T, 0), 1);

    // Split the route at the ship. The exact ship point is the shared
    // boundary vertex of both lines, so the seam is exact at any scrub
    // position in either direction. Samples are cosine-spaced in time.
    const k = samplePathIndex(f, ROUTE_PTS);
    const src = this.routePts;
    const inFlight = tSec > 0 && tSec < T;
    const ship = inFlight ? shipPosition(plan, tSec) : null;

    const fPos = this.flownGeo.attributes.position as THREE.BufferAttribute;
    const fCol = this.flownGeo.attributes.color as THREE.BufferAttribute;
    const fArr = fPos.array as Float32Array;
    let flownCount = 0;
    if (tSec >= T) flownCount = ROUTE_PTS;
    else if (ship) flownCount = k + 2; // samples 0..k plus the ship point
    if (flownCount > 0) {
      const last = ship ? flownCount - 1 : flownCount;
      for (let i = 0; i < (ship ? flownCount - 1 : flownCount); i++) {
        fArr[i * 3] = src[i * 3] - originKm.x;
        fArr[i * 3 + 1] = src[i * 3 + 1] - originKm.y;
        fArr[i * 3 + 2] = src[i * 3 + 2] - originKm.z;
      }
      if (ship) {
        fArr[(flownCount - 1) * 3] = ship.x - originKm.x;
        fArr[(flownCount - 1) * 3 + 1] = ship.y - originKm.y;
        fArr[(flownCount - 1) * 3 + 2] = ship.z - originKm.z;
      }
      // brightness ramps from 0.25 at departure to 0.7 at the ship
      const cArr = fCol.array as Float32Array;
      for (let i = 0; i < flownCount; i++) {
        const b = 0.25 + (0.45 * i) / Math.max(last, 1);
        cArr[i * 3] = ROUTE_R * b;
        cArr[i * 3 + 1] = ROUTE_G * b;
        cArr[i * 3 + 2] = ROUTE_B * b;
      }
      fPos.needsUpdate = true;
      fCol.needsUpdate = true;
    }
    this.flownGeo.setDrawRange(0, flownCount);
    this.flownLine.visible = flownCount > 1;

    const aPos = this.aheadGeo.attributes.position as THREE.BufferAttribute;
    const aArr = aPos.array as Float32Array;
    let aheadCount = 0;
    if (tSec <= 0) {
      aheadCount = ROUTE_PTS;
      for (let i = 0; i < ROUTE_PTS; i++) {
        aArr[i * 3] = src[i * 3] - originKm.x;
        aArr[i * 3 + 1] = src[i * 3 + 1] - originKm.y;
        aArr[i * 3 + 2] = src[i * 3 + 2] - originKm.z;
      }
    } else if (ship) {
      // ship point first, then the remaining samples
      aArr[0] = ship.x - originKm.x;
      aArr[1] = ship.y - originKm.y;
      aArr[2] = ship.z - originKm.z;
      aheadCount = 1;
      for (let i = k + 1; i < ROUTE_PTS; i++) {
        aArr[aheadCount * 3] = src[i * 3] - originKm.x;
        aArr[aheadCount * 3 + 1] = src[i * 3 + 1] - originKm.y;
        aArr[aheadCount * 3 + 2] = src[i * 3 + 2] - originKm.z;
        aheadCount++;
      }
    }
    if (aheadCount > 0) {
      aPos.needsUpdate = true;
      // dash distances anchored at the ship so the pattern marches with it
      const ld = this.aheadGeo.attributes.lineDistance as THREE.BufferAttribute;
      const lArr = ld.array as Float32Array;
      lArr[0] = 0;
      for (let i = 1; i < aheadCount; i++) {
        lArr[i] =
          lArr[i - 1] +
          Math.hypot(
            aArr[i * 3] - aArr[(i - 1) * 3],
            aArr[i * 3 + 1] - aArr[(i - 1) * 3 + 1],
            aArr[i * 3 + 2] - aArr[(i - 1) * 3 + 2]
          );
      }
      ld.needsUpdate = true;
    }
    this.aheadGeo.setDrawRange(0, aheadCount);
    this.aheadLine.visible = aheadCount > 1;

    // Markers
    const flipPos = shipPosition(plan, plan.flipTimeSec);
    this.placeSprite(this.flip, flipPos, originKm, 18, kmPerPixelAt);
    this.placeSprite(this.depart, plan.departPos, originKm, 14, kmPerPixelAt);
    this.placeSprite(this.intercept, plan.arrivePos, originKm, 16, kmPerPixelAt);

    // Ticks
    this.ticks.visible = showTicks;
    if (showTicks) {
      const bucket = Math.log2(Math.max(kmPerPixelAt(flipPos), 1e-9));
      if (Math.abs(bucket - this.tickBucket) >= 0.5) {
        this.tickBucket = bucket;
        this.buildTickSchedule(kmPerPixelAt(flipPos));
      }
      this.updateTicks(tSec, originKm);
    } else {
      for (const a of this.tickLabelAnchors) a.visible = false;
    }
  }

  /** Pick a tick interval for the current zoom and lay out tick positions. */
  private buildTickSchedule(kmPerPixel: number) {
    const plan = this.plan!;
    const T = plan.travelTimeSec;
    let interval = TICK_LADDER[TICK_LADDER.length - 1];
    for (const step of TICK_LADDER) {
      const count = Math.floor(T / step);
      if (count > MAX_TICKS) continue;
      const spacingPx = plan.arcLengthKm / Math.max(count, 1) / kmPerPixel;
      if (spacingPx >= TICK_MIN_PX) {
        interval = step;
        break;
      }
    }
    let n = 0;
    for (let t = interval; t < T * 0.999 && n < MAX_TICKS; t += interval) {
      const p = shipPosition(plan, t);
      this.tickPts[n * 3] = p.x;
      this.tickPts[n * 3 + 1] = p.y;
      this.tickPts[n * 3 + 2] = p.z;
      this.tickTimes[n] = t;
      n++;
    }
    this.tickCount = n;
    this.ticksGeo.setDrawRange(0, n);

    // sparse labels: at most TICK_LABELS, evenly strided
    const stride = Math.max(Math.ceil(n / TICK_LABELS), 1);
    let used = 0;
    for (let i = stride - 1; i < n && used < TICK_LABELS; i += stride) {
      const anchor = this.tickLabelAnchors[used];
      anchor.visible = true;
      anchor.userData.tickIndex = i;
      this.tickLabelEls[used].textContent = fmtTick(this.tickTimes[i]);
      used++;
    }
    for (let i = used; i < TICK_LABELS; i++) {
      this.tickLabelAnchors[i].visible = false;
    }
  }

  /** Per-frame: origin-relative tick positions, flown ticks dimmed. */
  private updateTicks(tSec: number, originKm: Vec3) {
    const pos = this.ticksGeo.attributes.position as THREE.BufferAttribute;
    const col = this.ticksGeo.attributes.color as THREE.BufferAttribute;
    const pArr = pos.array as Float32Array;
    const cArr = col.array as Float32Array;
    for (let i = 0; i < this.tickCount; i++) {
      pArr[i * 3] = this.tickPts[i * 3] - originKm.x;
      pArr[i * 3 + 1] = this.tickPts[i * 3 + 1] - originKm.y;
      pArr[i * 3 + 2] = this.tickPts[i * 3 + 2] - originKm.z;
      const dim = this.tickTimes[i] <= tSec ? 0.35 : 1;
      cArr[i * 3] = ROUTE_R * dim;
      cArr[i * 3 + 1] = ROUTE_G * dim;
      cArr[i * 3 + 2] = ROUTE_B * dim;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    for (let j = 0; j < this.tickLabelAnchors.length; j++) {
      const anchor = this.tickLabelAnchors[j];
      if (!anchor.visible) continue;
      const i = anchor.userData.tickIndex as number;
      anchor.position.set(
        this.tickPts[i * 3] - originKm.x,
        this.tickPts[i * 3 + 1] - originKm.y,
        this.tickPts[i * 3 + 2] - originKm.z
      );
      this.tickLabelEls[j].classList.toggle("flown", this.tickTimes[i] <= tSec);
    }
  }

  private placeSprite(
    sprite: THREE.Sprite,
    world: Vec3,
    originKm: Vec3,
    px: number,
    kmPerPixelAt: (p: Vec3) => number
  ) {
    sprite.position.set(world.x - originKm.x, world.y - originKm.y, world.z - originKm.z);
    const s = px * kmPerPixelAt(world);
    sprite.scale.set(s, s, 1);
  }
}
