/**
 * Cockpit mode: first-person view from the ship's nose. The camera adopts
 * the hull orientation (so the world wheels around you at flip), a DOM
 * canopy frame + reticle overlays the 3D view, and star streaks grow with
 * velocity.
 *
 * Streaks: LineSegments in a shell around the ship, aligned to the velocity
 * vector, recycled when they fall behind. Length/opacity scale with v.
 */
import * as THREE from "three";
import { G0, type FlightPlan } from "../planner";

const STREAKS = 260;
const SHELL_KM = 60; // streak field radius around the ship (fake scale)

export class Cockpit {
  readonly streaks: THREE.LineSegments;
  private streakGeo: THREE.BufferGeometry;
  private streakMat: THREE.LineBasicMaterial;
  private seeds: Float32Array; // unit-sphere seeds
  private canopy: HTMLDivElement;
  private reticle: HTMLDivElement;
  private velTape: HTMLDivElement;

  constructor(scene: THREE.Scene, container: HTMLElement) {
    this.seeds = new Float32Array(STREAKS * 3);
    for (let i = 0; i < STREAKS; i++) {
      // random point in a spherical shell
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = 0.35 + 0.65 * Math.random();
      const s = Math.sqrt(1 - u * u);
      this.seeds[i * 3] = s * Math.cos(phi) * r;
      this.seeds[i * 3 + 1] = s * Math.sin(phi) * r;
      this.seeds[i * 3 + 2] = u * r;
    }
    this.streakGeo = new THREE.BufferGeometry();
    this.streakGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3)
    );
    this.streakMat = new THREE.LineBasicMaterial({
      color: 0xbfd8ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.streaks = new THREE.LineSegments(this.streakGeo, this.streakMat);
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    scene.add(this.streaks);

    this.canopy = document.createElement("div");
    this.canopy.id = "canopy";
    this.canopy.classList.add("hidden");
    this.canopy.innerHTML = `
      <div class="canopy-frame"></div>
      <div class="reticle">┼</div>
      <div class="vel-tape"></div>
    `;
    container.appendChild(this.canopy);
    this.reticle = this.canopy.querySelector(".reticle")!;
    this.velTape = this.canopy.querySelector(".vel-tape")!;
  }

  setVisible(v: boolean) {
    this.canopy.classList.toggle("hidden", !v);
    this.streaks.visible = v;
    if (!v) this.streakMat.opacity = 0;
  }

  /**
   * @param shipQ hull orientation (nose = +Z)
   * @param shipRel ship position in origin-relative km (≈0 when focused)
   */
  update(
    camera: THREE.PerspectiveCamera,
    plan: FlightPlan,
    timeMs: number,
    shipQ: THREE.Quaternion,
    shipRel: THREE.Vector3,
    shake: number
  ) {
    // Camera looks along its -Z; hull nose is +Z → flip about local Y.
    camera.position.copy(shipRel);
    camera.quaternion.copy(shipQ).multiply(FLIP_Y);
    if (shake > 0) {
      camera.rotation.x += (Math.random() - 0.5) * 0.004 * shake;
      camera.rotation.y += (Math.random() - 0.5) * 0.004 * shake;
    }

    // velocity along chord
    const T = plan.travelTimeSec;
    const t = Math.min(Math.max((timeMs - plan.depart.getTime()) / 1000, 0), T);
    const v = plan.accelG * G0 * Math.min(t, T - t); // km/s
    const vFrac = plan.vPeakKmS > 0 ? v / plan.vPeakKmS : 0;

    // streaks: aligned to travel direction, moving aft; opacity with speed
    const dir = new THREE.Vector3(
      plan.arrivePos.x - plan.departPos.x,
      plan.arrivePos.y - plan.departPos.y,
      plan.arrivePos.z - plan.departPos.z
    ).normalize();
    const sign = t <= plan.flipTimeSec ? 1 : 1; // travel direction is constant
    const len = SHELL_KM * (0.02 + 0.3 * vFrac) * sign;
    const drift = ((timeMs / 1000) * (0.2 + 2.5 * vFrac)) % 1;
    const attr = this.streakGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < STREAKS; i++) {
      // slide seeds along -dir over time, wrap in shell
      let sx = this.seeds[i * 3] * SHELL_KM;
      let sy = this.seeds[i * 3 + 1] * SHELL_KM;
      let sz = this.seeds[i * 3 + 2] * SHELL_KM;
      const slide = ((i / STREAKS + drift) % 1) * 2 - 1;
      sx -= dir.x * slide * SHELL_KM;
      sy -= dir.y * slide * SHELL_KM;
      sz -= dir.z * slide * SHELL_KM;
      attr.setXYZ(i * 2, shipRel.x + sx, shipRel.y + sy, shipRel.z + sz);
      attr.setXYZ(
        i * 2 + 1,
        shipRel.x + sx - dir.x * len,
        shipRel.y + sy - dir.y * len,
        shipRel.z + sz - dir.z * len
      );
    }
    attr.needsUpdate = true;
    this.streakMat.opacity = 0.05 + 0.5 * vFrac;

    this.velTape.innerHTML = `<b>${v >= 1000 ? (v / 1000).toFixed(2) + "k" : v.toFixed(0)}</b> km/s`;
  }

  /** place the destination marker; call with arrive point in world (origin-relative) coords */
  placeDestMarker(camera: THREE.PerspectiveCamera, arriveWorld: THREE.Vector3, destName: string) {
    const v = arriveWorld.clone().project(camera);
    const el = this.reticle;
    if (v.z > 1 || v.z < -1) {
      el.style.opacity = "0.25";
      return;
    }
    el.style.opacity = "1";
    const x = (v.x * 0.5 + 0.5) * 100;
    const y = (-v.y * 0.5 + 0.5) * 100;
    el.style.left = `${Math.min(Math.max(x, 4), 96)}%`;
    el.style.top = `${Math.min(Math.max(y, 6), 94)}%`;
    el.dataset.label = destName;
  }
}

const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
