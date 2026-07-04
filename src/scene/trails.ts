/**
 * Orbit trails: while the clock runs fast, each body paints a glowing,
 * fading trail of where it has been. Ring buffer of heliocentric Float64
 * samples per body; rendered additively with per-vertex color fade.
 */
import * as THREE from "three";
import { BODIES, type BodyDef } from "../data/bodies";
import type { Ephemeris } from "../ephemeris";
import type { Vec3 } from "../ephemeris/vec";

const POINTS = 120;
/** sample spacing in sim days */
const SAMPLE_DAYS = 1.5;
/** speed threshold to show trails, sim days per second */
export const TRAIL_SPEED_MIN = 15;

interface Trail {
  def: BodyDef;
  line: THREE.Line;
  pts: Float64Array; // ring buffer xyz
  head: number;
  count: number;
  lastSampleMs: number;
  baseColor: THREE.Color;
}

export class OrbitTrails {
  private trails: Trail[] = [];
  private visible = false;

  constructor(scene: THREE.Scene) {
    for (const def of BODIES) {
      if (def.kind === "star" || def.kind === "station" || def.kind === "moon") continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POINTS * 3), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(POINTS * 3), 3));
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.trails.push({
        def,
        line,
        pts: new Float64Array(POINTS * 3),
        head: 0,
        count: 0,
        lastSampleMs: -Infinity,
        baseColor: new THREE.Color(def.color),
      });
    }
  }

  update(eph: Ephemeris, timeMs: number, speedDaysPerSec: number, playing: boolean, originKm: Vec3) {
    const on = playing && speedDaysPerSec >= TRAIL_SPEED_MIN;
    if (on !== this.visible) {
      this.visible = on;
      for (const t of this.trails) {
        t.line.visible = on;
        if (!on) {
          t.count = 0;
          t.head = 0;
          t.lastSampleMs = -Infinity;
        }
      }
    }
    if (!on) return;

    const date = new Date(timeMs);
    for (const t of this.trails) {
      // clock jumped backwards (scrub): restart the trail
      if (timeMs < t.lastSampleMs) {
        t.count = 0;
        t.head = 0;
        t.lastSampleMs = -Infinity;
      }
      // sample
      if (timeMs - t.lastSampleMs >= SAMPLE_DAYS * 86_400_000) {
        const p = eph.stateOf(t.def.id, date).pos;
        t.pts[t.head * 3] = p.x;
        t.pts[t.head * 3 + 1] = p.y;
        t.pts[t.head * 3 + 2] = p.z;
        t.head = (t.head + 1) % POINTS;
        t.count = Math.min(t.count + 1, POINTS);
        t.lastSampleMs = timeMs;
      }
      // rewrite origin-relative, oldest -> newest with color fade
      const posAttr = t.line.geometry.attributes.position as THREE.BufferAttribute;
      const colAttr = t.line.geometry.attributes.color as THREE.BufferAttribute;
      const n = t.count;
      for (let i = 0; i < n; i++) {
        const src = ((t.head - n + i + POINTS) % POINTS) * 3;
        posAttr.setXYZ(
          i,
          t.pts[src] - originKm.x,
          t.pts[src + 1] - originKm.y,
          t.pts[src + 2] - originKm.z
        );
        const f = ((i + 1) / n) * 0.8;
        colAttr.setXYZ(i, t.baseColor.r * f, t.baseColor.g * f, t.baseColor.b * f);
      }
      t.line.geometry.setDrawRange(0, n);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }
  }
}
