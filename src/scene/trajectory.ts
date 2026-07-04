/**
 * Flight-plan visuals: dashed chord, flip cross, ship dot. Vertices are
 * rewritten every frame in origin-relative km (Float64 math on the CPU), so
 * they inherit floating-origin stability.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Vec3 } from "../ephemeris/vec";
import { shipPosition, type FlightPlan } from "../planner";

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
  private plan: FlightPlan | null = null;

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

    scene.add(this.line, this.flip, this.intercept);
    this.setPlan(null);
  }

  setPlan(plan: FlightPlan | null) {
    this.plan = plan;
    this.line.visible = this.flip.visible = this.intercept.visible = !!plan;
    if (plan) {
      // Dash pattern scaled to the chord so it reads at any route length.
      const mat = this.line.material as THREE.LineDashedMaterial;
      mat.dashSize = plan.distanceKm / 80;
      mat.gapSize = plan.distanceKm / 120;
    }
  }

  update(originKm: Vec3, kmPerPixelAt: (p: Vec3) => number) {
    const plan = this.plan;
    if (!plan) return;

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
