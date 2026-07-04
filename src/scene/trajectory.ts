/**
 * Flight-plan visuals: dashed chord, flip cross, ship dot. Vertices are
 * rewritten every frame in origin-relative km (Float64 math on the CPU), so
 * they inherit floating-origin stability.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Vec3 } from "../ephemeris/vec";
import { shipPosition, type FlightPlan } from "../planner";

export const TARGET_PATH_PTS = 48;

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

export class TrajectoryVisual {
  private line: THREE.Line;
  private lineGeo: THREE.BufferGeometry;
  private flip: THREE.Sprite;
  /** rendezvous ring at the chord end: the target WILL be here at arrival */
  private intercept: THREE.Sprite;
  /** the target's own future path from its current position to the intercept */
  private targetPath: THREE.Line;
  private targetPathGeo: THREE.BufferGeometry;
  private plan: FlightPlan | null = null;
  private expired = false;

  constructor(scene: THREE.Scene) {
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(6), 3)
    );
    this.line = new THREE.Line(
      this.lineGeo,
      new THREE.LineDashedMaterial({
        color: 0x7fd4a8,
        dashSize: 1,
        gapSize: 1,
        transparent: true,
        opacity: 0.9,
      })
    );
    this.line.frustumCulled = false;

    this.flip = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: crossTexture(), depthTest: false })
    );
    this.flip.renderOrder = 6;

    this.intercept = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), depthTest: false })
    );
    this.intercept.renderOrder = 6;
    const label = document.createElement("div");
    label.className = "beam-label";
    label.textContent = "intercept";
    const labelObj = new CSS2DObject(label);
    labelObj.center.set(-0.15, 1.6);
    this.intercept.add(labelObj);

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
      })
    );
    this.targetPath.frustumCulled = false;

    scene.add(this.line, this.flip, this.intercept, this.targetPath);
    this.setPlan(null);
  }

  setPlan(plan: FlightPlan | null) {
    this.plan = plan;
    this.expired = false;
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
    this.line.visible = this.flip.visible = this.intercept.visible = on;
    this.targetPath.visible = false; // shown only mid-flight via updateTargetPath
    if (this.plan) {
      // Dash pattern scaled to the chord so it reads at any route length.
      const mat = this.line.material as THREE.LineDashedMaterial;
      mat.dashSize = this.plan.distanceKm / 80;
      mat.gapSize = this.plan.distanceKm / 120;
      const tp = this.targetPath.material as THREE.LineDashedMaterial;
      tp.dashSize = this.plan.distanceKm / 140;
      tp.gapSize = this.plan.distanceKm / 170;
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

  update(originKm: Vec3, kmPerPixelAt: (p: Vec3) => number) {
    const plan = this.plan;
    if (!plan || this.expired) return;

    const pos = this.lineGeo.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, plan.departPos.x - originKm.x, plan.departPos.y - originKm.y, plan.departPos.z - originKm.z);
    pos.setXYZ(1, plan.arrivePos.x - originKm.x, plan.arrivePos.y - originKm.y, plan.arrivePos.z - originKm.z);
    pos.needsUpdate = true;
    this.line.computeLineDistances();

    const flipPos = shipPosition(plan, plan.flipTimeSec);
    this.placeSprite(this.flip, flipPos, originKm, 18, kmPerPixelAt);
    this.placeSprite(this.intercept, plan.arrivePos, originKm, 16, kmPerPixelAt);
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
