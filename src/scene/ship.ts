/**
 * The ship under way: hull + Epstein drive plume, screen-constant size.
 * Nose points along thrust: toward the destination while accelerating,
 * toward the origin while braking. Around the midpoint the drive cuts out
 * and the hull rotates 180° — the flip.
 */
import * as THREE from "three";
import { SHIP_BY_ID } from "../data/ships";
import type { Vec3 } from "../ephemeris/vec";
import { shipPosition, type FlightPlan } from "../planner";
import { loadPackedMesh, tryLoadGlb } from "./loadmodel";
import { paintShip } from "./skins";

/** Fraction of total flight time spent flipping (each side of midpoint). */
const FLIP_HALF_FRAC = 0.012;

export type BurnPhase = "burn" | "flip" | "brake" | "dock" | "off";

export class ShipVisual {
  readonly group = new THREE.Group();
  private hull = new THREE.Group();
  private plume: THREE.Mesh;
  private plumeMat: THREE.MeshBasicMaterial;
  private qAccel = new THREE.Quaternion();
  private qDecel = new THREE.Quaternion();
  private flicker = 0;
  private base: string;
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private customGlb: THREE.Object3D | null | undefined; // undefined = not probed
  private currentHull = "";
  /** real km per model unit for the active hull (close-up scale clamp) */
  private realKmPerUnit = 0.046 / 3;

  constructor(scene: THREE.Scene, base = "") {
    this.base = base;
    // Fallback hull until the real model loads: cylinder + nose cone, +Z.
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
    this.hull.add(body, nose);
    this.group.add(this.hull);

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
    this.plume.position.z = -2.7; // just aft of the 3-unit hull
    this.group.add(this.plume);

    // RCS thrusters for the docking glide: two small cold-gas puff sprites
    const puffMat = new THREE.SpriteMaterial({
      color: 0xdfe8f0,
      transparent: true,
      opacity: 0,
      depthTest: false,
    });
    for (const x of [-0.35, 0.35]) {
      const puff = new THREE.Sprite(puffMat.clone() as THREE.SpriteMaterial);
      puff.position.set(x, 0, 0.9);
      puff.scale.setScalar(0.28);
      this.rcs.push(puff);
      this.group.add(puff);
    }

    this.group.visible = false;
    scene.add(this.group);
  }

  private rcs: THREE.Sprite[] = [];

  /**
   * Load the hull for a ship class. Priority: drop-in models/custom-ship.glb
   * (probed once) > the class's packed canon model > the placeholder.
   */
  async setHull(shipId: string) {
    if (shipId === this.currentHull) return;
    this.currentHull = shipId;
    const cls = SHIP_BY_ID.get(shipId);
    this.realKmPerUnit = ((cls?.lengthM ?? 46) / 1000) / 3;

    if (this.customGlb === undefined) {
      this.customGlb = await tryLoadGlb(`${this.base}models/custom-ship.glb`, 3.0);
    }
    if (this.customGlb) {
      this.hull.clear();
      this.hull.add(this.customGlb);
      return;
    }
    if (!cls?.model) return; // hauler: keep the placeholder hull

    try {
      // cache per ship class: the livery is baked into the geometry
      let geo = this.geoCache.get(shipId);
      if (!geo) {
        geo = (await loadPackedMesh(`${this.base}models/${cls.model}`)).geometry;
        if (cls.skin) {
          // de-index so each face can take a flat livery color
          geo = geo.toNonIndexed();
          const pos = geo.getAttribute("position").array;
          geo.setAttribute(
            "color",
            new THREE.BufferAttribute(paintShip(pos, cls.skin), 3, true)
          );
        }
        this.geoCache.set(shipId, geo);
      }
      if (this.currentHull !== shipId) return; // user switched again mid-load
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: cls.skin ? 0xffffff : cls.modelColor,
          vertexColors: !!cls.skin,
          roughness: 0.42,
          metalness: 0.62, // picks up the env panorama
          flatShading: true,
        })
      );
      this.hull.clear();
      this.hull.add(mesh);
    } catch {
      /* keep whatever hull is showing */
    }
  }

  /** Current phase for HUD / sound. */
  phase(plan: FlightPlan, tSec: number): BurnPhase {
    if (tSec < 0 || tSec > plan.travelTimeSec) return "off";
    const w = Math.max(plan.travelTimeSec * FLIP_HALF_FRAC, 30);
    if (Math.abs(tSec - plan.flipTimeSec) < w) return "flip";
    return tSec < plan.flipTimeSec ? "burn" : "brake";
  }

  /**
   * Docking epilogue: place the hull at an externally-computed glide
   * position, drive off, RCS puffing. Orientation holds the braking
   * attitude. wallSec drives the puff flicker.
   */
  updateDocking(
    plan: FlightPlan,
    glidePos: Vec3,
    originKm: Vec3,
    kmPerPixelAt: (p: Vec3) => number,
    sizePx: number,
    wallSec: number
  ) {
    this.group.visible = true;
    this.group.position.set(
      glidePos.x - originKm.x,
      glidePos.y - originKm.y,
      glidePos.z - originKm.z
    );
    const s = Math.max(sizePx * kmPerPixelAt(glidePos), this.realKmPerUnit);
    this.group.scale.setScalar(s);
    this.orient(plan);
    this.group.quaternion.copy(this.qDecel);
    this.plume.visible = false;
    for (const [i, puff] of this.rcs.entries()) {
      const mat = puff.material as THREE.SpriteMaterial;
      // sparse alternating cold-gas pops
      const t = wallSec * 2.2 + i * 1.7;
      mat.opacity = Math.sin(t) > 0.86 ? 0.75 : 0;
    }
  }

  private hideRcs() {
    for (const puff of this.rcs) {
      (puff.material as THREE.SpriteMaterial).opacity = 0;
    }
  }

  /** compute qAccel/qDecel from the plan chord */
  private orient(plan: FlightPlan) {
    const dir = new THREE.Vector3(
      plan.arrivePos.x - plan.departPos.x,
      plan.arrivePos.y - plan.departPos.y,
      plan.arrivePos.z - plan.departPos.z
    ).normalize();
    this.qAccel.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const perp = new THREE.Vector3(0, 0, 1).cross(dir);
    if (perp.lengthSq() < 1e-9) perp.set(1, 0, 0);
    perp.normalize();
    this.qDecel.setFromAxisAngle(perp, Math.PI).multiply(this.qAccel);
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
    this.hideRcs();

    const pos = shipPosition(plan, tSec);
    this.group.position.set(pos.x - originKm.x, pos.y - originKm.y, pos.z - originKm.z);
    const s = Math.max(sizePx * kmPerPixelAt(pos), this.realKmPerUnit);
    this.group.scale.setScalar(s);

    // Orientation: +Z nose along thrust direction; flip is a deterministic
    // 180° about an axis perpendicular to the chord (see orient()).
    this.orient(plan);

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
