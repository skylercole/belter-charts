/**
 * Ambient traffic visual: every in-flight NPC ship as one batched
 * LineSegments (faint transit lines, faction-tinted, brightening toward the
 * destination) plus one batched Points (ship dots). Two draw calls total.
 * Vertices are rewritten origin-relative every frame like everything else.
 *
 * Hover: a single DOM label; nearest dot within 12 px of the pointer.
 */
import * as THREE from "three";
import type { Ephemeris } from "../ephemeris";
import type { Vec3 } from "../ephemeris/vec";
import { shipPosition, type HonestyMode } from "../planner";
import { MAX_ACTIVE, PATH_PTS, TrafficSchedule, type TrafficFlight } from "../traffic";
import { BODY_BY_ID } from "../data/bodies";
import { fmtDuration } from "../ui/format";

/** vertices per flight in the LineSegments buffer */
const SEG_VERTS = (PATH_PTS - 1) * 2;
/** hide the line layer when zoomed in close to a body */
const CLOSEUP_FADE_KM = 1.5e6;
const HOVER_PX = 12;

function dotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(16, 16, 1, 16, 16, 8);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TrafficVisual {
  private lines: THREE.LineSegments;
  private linesGeo: THREE.BufferGeometry;
  private linesMat: THREE.LineBasicMaterial;
  private dots: THREE.Points;
  private dotsGeo: THREE.BufferGeometry;
  private schedule: TrafficSchedule;
  private label: HTMLDivElement;
  private container: HTMLElement;
  private active: TrafficFlight[] = [];
  /** origin-relative dot positions for hover projection */
  private dotPos = new Float32Array(MAX_ACTIVE * 3);
  private mouseX = -1;
  private mouseY = -1;
  private v3 = new THREE.Vector3();

  constructor(scene: THREE.Scene, eph: Ephemeris, container: HTMLElement) {
    this.schedule = new TrafficSchedule(eph);
    this.container = container;

    this.linesGeo = new THREE.BufferGeometry();
    this.linesGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_ACTIVE * SEG_VERTS * 3), 3)
    );
    this.linesGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(MAX_ACTIVE * SEG_VERTS * 3), 3)
    );
    this.linesMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.linesGeo, this.linesMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;

    this.dotsGeo = new THREE.BufferGeometry();
    this.dotsGeo.setAttribute("position", new THREE.BufferAttribute(this.dotPos, 3));
    this.dotsGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(MAX_ACTIVE * 3), 3)
    );
    this.dots = new THREE.Points(
      this.dotsGeo,
      new THREE.PointsMaterial({
        map: dotTexture(),
        size: 5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.9,
        vertexColors: true,
        depthWrite: false,
      })
    );
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 2;

    scene.add(this.lines, this.dots);

    this.label = document.createElement("div");
    this.label.className = "traffic-label";
    this.label.style.display = "none";
    container.appendChild(this.label);

    container.addEventListener("pointermove", (e) => {
      const r = container.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
    });
    container.addEventListener("pointerleave", () => {
      this.mouseX = -1;
      this.mouseY = -1;
    });
  }

  update(
    on: boolean,
    honesty: HonestyMode,
    timeMs: number,
    originKm: Vec3,
    camera: THREE.PerspectiveCamera,
    camDistKm: number,
    hidden: boolean
  ) {
    const visible = on && !hidden;
    this.lines.visible = visible;
    this.dots.visible = visible;
    if (!visible) {
      this.label.style.display = "none";
      return;
    }

    this.schedule.update(timeMs, honesty, 1);
    const active = this.schedule.active(timeMs);
    this.active = active;

    // close-up declutter: fade the lines out, keep the dots
    const fade = Math.min(Math.max(camDistKm / CLOSEUP_FADE_KM - 0.5, 0), 1);
    this.linesMat.opacity = 0.45 * fade;
    this.lines.visible = fade > 0.02;

    const lPos = this.linesGeo.attributes.position as THREE.BufferAttribute;
    const lCol = this.linesGeo.attributes.color as THREE.BufferAttribute;
    const lp = lPos.array as Float32Array;
    const lc = lCol.array as Float32Array;
    const dPos = this.dotsGeo.attributes.position as THREE.BufferAttribute;
    const dCol = this.dotsGeo.attributes.color as THREE.BufferAttribute;
    const dc = dCol.array as Float32Array;

    for (let i = 0; i < active.length; i++) {
      const f = active[i];
      const src = f.pathPts;
      const base = i * SEG_VERTS * 3;
      let v = 0;
      for (let s = 0; s < PATH_PTS - 1; s++) {
        for (const p of [s, s + 1]) {
          const o = base + v * 3;
          lp[o] = src[p * 3] - originKm.x;
          lp[o + 1] = src[p * 3 + 1] - originKm.y;
          lp[o + 2] = src[p * 3 + 2] - originKm.z;
          // faint tint ramping toward the destination for directionality
          const b = 0.06 + (0.1 * p) / (PATH_PTS - 1);
          lc[o] = f.color[0] * b;
          lc[o + 1] = f.color[1] * b;
          lc[o + 2] = f.color[2] * b;
          v++;
        }
      }
      const pos = shipPosition(f.plan, (timeMs - f.departMs) / 1000);
      this.dotPos[i * 3] = pos.x - originKm.x;
      this.dotPos[i * 3 + 1] = pos.y - originKm.y;
      this.dotPos[i * 3 + 2] = pos.z - originKm.z;
      dc[i * 3] = Math.min(f.color[0] + 0.35, 1);
      dc[i * 3 + 1] = Math.min(f.color[1] + 0.35, 1);
      dc[i * 3 + 2] = Math.min(f.color[2] + 0.35, 1);
    }
    this.linesGeo.setDrawRange(0, active.length * SEG_VERTS);
    this.dotsGeo.setDrawRange(0, active.length);
    lPos.needsUpdate = true;
    lCol.needsUpdate = true;
    dPos.needsUpdate = true;
    dCol.needsUpdate = true;

    this.updateHover(camera, timeMs);
  }

  private updateHover(camera: THREE.PerspectiveCamera, timeMs: number) {
    if (this.mouseX < 0 || this.active.length === 0) {
      this.label.style.display = "none";
      return;
    }
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    let best = -1;
    let bestD = HOVER_PX;
    for (let i = 0; i < this.active.length; i++) {
      this.v3.set(this.dotPos[i * 3], this.dotPos[i * 3 + 1], this.dotPos[i * 3 + 2]);
      this.v3.project(camera);
      if (this.v3.z > 1 || this.v3.z < -1) continue;
      const sx = (this.v3.x * 0.5 + 0.5) * w;
      const sy = (-this.v3.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - this.mouseX, sy - this.mouseY);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) {
      this.label.style.display = "none";
      return;
    }
    const f = this.active[best];
    const from = BODY_BY_ID.get(f.originId)?.name ?? f.originId;
    const to = BODY_BY_ID.get(f.destId)?.name ?? f.destId;
    const eta = fmtDuration(Math.max((f.arriveMs - timeMs) / 1000, 0));
    this.label.textContent = `${f.name} · ${f.klass} · ${from} → ${to} · ETA ${eta}`;
    this.label.style.display = "block";
    this.label.style.left = `${this.mouseX}px`;
    this.label.style.top = `${this.mouseY}px`;
  }
}
