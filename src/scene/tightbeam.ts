/**
 * Tightbeam: a comm pulse crossing between origin and destination. The
 * animation runs on wall clock (fixed ~6 s regardless of route length) while
 * the counter shows true elapsed light-time, so you feel the lag without
 * waiting 20 real minutes.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Ephemeris } from "../ephemeris";
import type { Vec3 } from "../ephemeris/vec";
import { distance, lerp } from "../ephemeris/vec";
import { C_KM_S } from "../planner";
import { fmtLag } from "../ui/format";

const WALL_DURATION_MS = 6000;
const HOLD_MS = 1200;

export class TightbeamVisual {
  private pulse: THREE.Sprite;
  private trail: THREE.Line;
  private trailGeo: THREE.BufferGeometry;
  private labelEl: HTMLDivElement;
  private label: CSS2DObject;
  private startWall: number | null = null;

  constructor(scene: THREE.Scene) {
    this.pulse = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0xfff2c9, depthTest: false })
    );
    this.pulse.renderOrder = 8;

    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3)
    );
    this.trail = new THREE.Line(
      this.trailGeo,
      new THREE.LineBasicMaterial({
        color: 0xffd27d,
        transparent: true,
        opacity: 0.5,
      })
    );
    this.trail.frustumCulled = false;

    this.labelEl = document.createElement("div");
    this.labelEl.className = "beam-label";
    this.label = new CSS2DObject(this.labelEl);
    this.label.center.set(0.5, 2.2);
    this.pulse.add(this.label);

    this.pulse.visible = this.trail.visible = false;
    scene.add(this.pulse, this.trail);
  }

  /**
   * @returns true while active; false when finished (caller clears store).
   */
  update(
    active: boolean,
    eph: Ephemeris,
    originId: string,
    destId: string,
    date: Date,
    originKm: Vec3,
    kmPerPixelAt: (p: Vec3) => number
  ): boolean {
    if (!active) {
      this.startWall = null;
      this.pulse.visible = this.trail.visible = false;
      return false;
    }
    if (this.startWall === null) this.startWall = performance.now();

    const a = eph.stateOf(originId, date).pos;
    const b = eph.stateOf(destId, date).pos;
    const lagSec = distance(a, b) / C_KM_S;

    const elapsed = performance.now() - this.startWall;
    const f = Math.min(elapsed / WALL_DURATION_MS, 1);
    if (elapsed > WALL_DURATION_MS + HOLD_MS) {
      this.startWall = null;
      this.pulse.visible = this.trail.visible = false;
      return false;
    }

    const p = lerp(a, b, f);
    this.pulse.visible = this.trail.visible = true;
    this.pulse.position.set(p.x - originKm.x, p.y - originKm.y, p.z - originKm.z);
    const s = 7 * kmPerPixelAt(p);
    this.pulse.scale.set(s, s, 1);

    const attr = this.trailGeo.attributes.position as THREE.BufferAttribute;
    attr.setXYZ(0, a.x - originKm.x, a.y - originKm.y, a.z - originKm.z);
    attr.setXYZ(1, p.x - originKm.x, p.y - originKm.y, p.z - originKm.z);
    attr.needsUpdate = true;

    this.labelEl.textContent =
      f < 1 ? `tightbeam · ${fmtLag(f * lagSec)}` : `received · ${fmtLag(lagSec)}`;
    return true;
  }
}
