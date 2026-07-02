/**
 * Three.js scene. Non-negotiables from Plan.md 3:
 * - Floating origin: the focused body sits at world (0,0,0); every visual's
 *   coordinates are rewritten per frame as (heliocentric - origin) computed
 *   in Float64 on the CPU. The camera never leaves the origin's neighborhood,
 *   so there is no far-from-origin jitter by construction.
 * - Logarithmic depth buffer.
 * - Internal units: km everywhere (1 three unit = 1 km), Float64 on the CPU.
 */
import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { BODIES } from "../data/bodies";
import type { Ephemeris } from "../ephemeris";
import { sampleOrbitPath, type OrbitPath } from "../ephemeris/orbitpath";
import { dateToJd } from "../ephemeris/time";
import type { Vec3 } from "../ephemeris/vec";
import { distance } from "../ephemeris/vec";
import type { FlightPlan } from "../planner";
import { buildBodies, type BodyVisual } from "./bodies3d";
import { FocusControls } from "./controls";
import { TrajectoryVisual } from "./trajectory";

const ORBIT_SAMPLES = 360;
const ORBIT_CACHE_DAYS = 45;
const AU_KM = 149_597_870.7;

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  readonly controls: FocusControls;
  private visuals: Map<string, BodyVisual>;
  private trajectory: TrajectoryVisual;
  private sunLight: THREE.PointLight;
  private orbitLines = new Map<string, { line: THREE.Line; path: OrbitPath }>();
  private lastPlan: FlightPlan | null = null;

  constructor(
    container: HTMLElement,
    private eph: Ephemeris,
    base: string
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "label-layer";
    container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2e10);
    this.camera.up.set(0, 0, 1); // ecliptic north

    this.controls = new FocusControls(this.renderer.domElement, 9 * AU_KM);

    // Skybox: Milky Way panorama (galactic orientation not aligned; v1).
    new THREE.TextureLoader().load(`${base}textures/skybox_milky_way.jpg`, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = tex;
      this.scene.backgroundIntensity = 0.35;
    });

    this.sunLight = new THREE.PointLight(0xffffff, 2.4, 0, 0);
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.07));

    this.visuals = buildBodies(this.scene, base, (id) => this.controls.focus(id));
    this.trajectory = new TrajectoryVisual(this.scene);
    this.buildOrbitLines();

    this.resize(container);
    window.addEventListener("resize", () => this.resize(container));
  }

  private resize(container: HTMLElement) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildOrbitLines() {
    for (const def of BODIES) {
      if (def.kind === "star") continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(ORBIT_SAMPLES * 3), 3)
      );
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color: new THREE.Color(def.color),
          transparent: true,
          opacity: 0.28,
        })
      );
      line.frustumCulled = false;
      this.scene.add(line);
      this.orbitLines.set(def.id, {
        line,
        path: { pts: new Float64Array(0), closed: false, jdCenter: -1e9 },
      });
    }
  }

  focus(bodyId: string) {
    this.controls.focus(bodyId);
  }

  /** km of world space per screen pixel at heliocentric point p. */
  private kmPerPixelAt(p: Vec3, originKm: Vec3, camWorld: Vec3): number {
    const camHelio = {
      x: originKm.x + camWorld.x,
      y: originKm.y + camWorld.y,
      z: originKm.z + camWorld.z,
    };
    const d = distance(p, camHelio);
    const h = this.renderer.domElement.clientHeight || 1;
    return (2 * d * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
  }

  render(timeMs: number, plan: FlightPlan | null, dt: number) {
    const date = new Date(timeMs);
    const jdNow = dateToJd(date);

    const originKm = this.controls.update(dt, this.eph, date);
    const camOff = this.controls.cameraOffset();
    this.camera.position.set(camOff.x, camOff.y, camOff.z);
    this.camera.lookAt(0, 0, 0);

    // Bodies
    for (const v of this.visuals.values()) {
      const pos =
        v.def.kind === "star"
          ? { x: 0, y: 0, z: 0 }
          : this.eph.stateOf(v.def.id, date).pos;
      v.group.position.set(pos.x - originKm.x, pos.y - originKm.y, pos.z - originKm.z);

      const kmPerPx = this.kmPerPixelAt(pos, originKm, camOff);
      const apparentPx = (2 * v.def.radiusKm) / kmPerPx;
      const showDot = apparentPx < 5;
      v.sprite.visible = showDot;
      if (showDot) {
        const s = (v.def.kind === "planet" ? 7 : 5) * kmPerPx;
        v.sprite.scale.set(s, s, 1);
      }
      // fade labels of belt objects when zoomed far out
      const isFocus = v.def.id === this.controls.focusId;
      v.labelEl.classList.toggle("focused", isFocus);

      if (v.mesh && v.def.spinHours) {
        const spin = (2 * Math.PI * (timeMs / 3_600_000)) / v.def.spinHours;
        // Spheres are tilted pole-to-+Z via rotation.x; their native pole is
        // +Y, so spin goes on rotation.y. Packed models (Eros) are already
        // +Z-pole in their body frame, so spin goes on rotation.z.
        if (v.def.model) v.mesh.rotation.z = spin;
        else v.mesh.rotation.y = spin;
      }
    }

    // Sun light sits at the sun
    this.sunLight.position.set(-originKm.x, -originKm.y, -originKm.z);

    // Orbit lines: refresh samples when the clock drifts, rewrite
    // origin-relative coords every frame.
    for (const def of BODIES) {
      if (def.kind === "star") continue;
      const entry = this.orbitLines.get(def.id)!;
      if (Math.abs(entry.path.jdCenter - jdNow) > ORBIT_CACHE_DAYS) {
        entry.path = sampleOrbitPath(this.eph, def, jdNow, ORBIT_SAMPLES);
      }
      const src = entry.path.pts;
      const attr = entry.line.geometry.attributes.position as THREE.BufferAttribute;
      const dst = attr.array as Float32Array;
      for (let i = 0; i < src.length; i += 3) {
        dst[i] = src[i] - originKm.x;
        dst[i + 1] = src[i + 1] - originKm.y;
        dst[i + 2] = src[i + 2] - originKm.z;
      }
      attr.needsUpdate = true;
    }

    // Trajectory
    if (plan !== this.lastPlan) {
      this.trajectory.setPlan(plan);
      this.lastPlan = plan;
    }
    this.trajectory.update(originKm, timeMs, (p) =>
      this.kmPerPixelAt(p, originKm, camOff)
    );

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
