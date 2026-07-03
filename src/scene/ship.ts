/**
 * The ship under way: hull + Epstein drive plume, screen-constant size.
 * Nose points along thrust: toward the destination while accelerating,
 * toward the origin while braking. Around the midpoint the drive cuts out
 * and the hull rotates 180° — the flip.
 */
import * as THREE from "three";
import type { Vec3 } from "../ephemeris/vec";
import { shipPosition, type FlightPlan } from "../planner";

/** Fraction of total flight time spent flipping (each side of midpoint). */
const FLIP_HALF_FRAC = 0.012;

export type BurnPhase = "burn" | "flip" | "brake" | "off";

export class ShipVisual {
  readonly group = new THREE.Group();
  private plume: THREE.Mesh;
  private plumeMat: THREE.MeshBasicMaterial;
  private qAccel = new THREE.Quaternion();
  private qDecel = new THREE.Quaternion();
  private flicker = 0;

  constructor(scene: THREE.Scene) {
    // Hull: stubby cylinder + nose cone, along +Z.
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0xcfd6df,
      roughness: 0.6,
      metalness: 0.3,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.1, 12), hullMat);
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 12), hullMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.8;
    this.group.add(body, nose);

    // Drive plume: additive cone pointing aft (-Z).
    this.plumeMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.plume = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.6, 10, 1, true), this.plumeMat);
    this.plume.rotation.x = -Math.PI / 2;
    this.plume.position.z = -1.9;
    this.group.add(this.plume);

    this.group.visible = false;
    scene.add(this.group);
  }

  /** Current phase for HUD / sound. */
  phase(plan: FlightPlan, tSec: number): BurnPhase {
    if (tSec < 0 || tSec > plan.travelTimeSec) return "off";
    const w = Math.max(plan.travelTimeSec * FLIP_HALF_FRAC, 30);
    if (Math.abs(tSec - plan.flipTimeSec) < w) return "flip";
    return tSec < plan.flipTimeSec ? "burn" : "brake";
  }

  update(
    plan: FlightPlan | null,
    timeMs: number,
    originKm: Vec3,
    kmPerPixelAt: (p: Vec3) => number,
    sizePx: number,
    dt: number
  ): { pos: Vec3; phase: BurnPhase } | null {
    const tSec = plan ? (timeMs - plan.depart.getTime()) / 1000 : -1;
    if (!plan || tSec < 0 || tSec > plan.travelTimeSec) {
      this.group.visible = false;
      return null;
    }
    this.group.visible = true;

    const pos = shipPosition(plan, tSec);
    this.group.position.set(pos.x - originKm.x, pos.y - originKm.y, pos.z - originKm.z);
    const s = sizePx * kmPerPixelAt(pos);
    this.group.scale.setScalar(s);

    // Orientation: +Z nose along thrust direction.
    const dir = new THREE.Vector3(
      plan.arrivePos.x - plan.departPos.x,
      plan.arrivePos.y - plan.departPos.y,
      plan.arrivePos.z - plan.departPos.z
    ).normalize();
    this.qAccel.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    // Flip = 180° about an axis perpendicular to the chord, so the slerp
    // path is deterministic.
    const perp = new THREE.Vector3(0, 0, 1).cross(dir);
    if (perp.lengthSq() < 1e-9) perp.set(1, 0, 0);
    perp.normalize();
    this.qDecel
      .setFromAxisAngle(perp, Math.PI)
      .multiply(this.qAccel);

    const w = Math.max(plan.travelTimeSec * FLIP_HALF_FRAC, 30);
    const phase = this.phase(plan, tSec);
    if (phase === "burn") this.group.quaternion.copy(this.qAccel);
    else if (phase === "brake") this.group.quaternion.copy(this.qDecel);
    else {
      const f = (tSec - (plan.flipTimeSec - w)) / (2 * w);
      const eased = f * f * (3 - 2 * f);
      this.group.quaternion.slerpQuaternions(this.qAccel, this.qDecel, eased);
    }

    // Plume: off during the flip, flickering otherwise.
    const thrusting = phase !== "flip";
    this.plume.visible = thrusting;
    if (thrusting) {
      this.flicker += dt * 30;
      const f = 1 + 0.12 * Math.sin(this.flicker) * Math.sin(this.flicker * 2.7);
      this.plume.scale.set(1, f, 1);
      this.plumeMat.opacity = 0.7 + 0.2 * Math.sin(this.flicker * 1.3);
    }

    return { pos, phase };
  }
}
