/**
 * Three.js scene. Non-negotiables from Plan.md 3:
 * - Floating origin: the focused body (or the ship) sits at world (0,0,0);
 *   every visual's coordinates are rewritten per frame as
 *   (heliocentric - origin) computed in Float64 on the CPU. The camera never
 *   leaves the origin's neighborhood, so there is no far-from-origin jitter
 *   by construction.
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
import { planFlight, shipPosition } from "../planner";
import { fmtDuration } from "../ui/format";
import { store, type AppState } from "../ui/store";
import { buildBodies, type BodyVisual } from "./bodies3d";
import { FocusControls, SHIP_FOCUS } from "./controls";
import { RideHud } from "./hud";
import { ShipVisual, type BurnPhase } from "./ship";
import { EngineSound } from "./sound";
import { TightbeamVisual } from "./tightbeam";
import { TrajectoryVisual } from "./trajectory";

const ORBIT_SAMPLES = 360;
const ORBIT_CACHE_DAYS = 45;
const AU_KM = 149_597_870.7;
/** travel-time labels refresh when the clock crosses a 6 h bucket */
const TT_BUCKET_MS = 6 * 3_600_000;

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  readonly controls: FocusControls;
  private visuals: Map<string, BodyVisual>;
  private trajectory: TrajectoryVisual;
  private shipVisual: ShipVisual;
  private tightbeam: TightbeamVisual;
  private hud: RideHud;
  private sound = new EngineSound();
  private sunLight: THREE.PointLight;
  private orbitLines = new Map<string, { line: THREE.Line; path: OrbitPath }>();
  private lastPlan: AppState["plan"] = null;
  private lastPhase: BurnPhase = "off";
  private ttKey = "";

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
    this.shipVisual = new ShipVisual(this.scene);
    this.tightbeam = new TightbeamVisual(this.scene);
    this.hud = new RideHud(container);
    this.buildOrbitLines();

    // Runs synchronously inside the Engage click's dispatch, so the
    // AudioContext is created within a user gesture.
    store.subscribe((s, prev) => {
      if (s.ride && !prev.ride) {
        this.sound.unlock();
        this.controls.focus(SHIP_FOCUS);
      }
      if (!s.ride && prev.ride) {
        this.sound.stop();
        if (this.controls.focusId === SHIP_FOCUS) {
          this.controls.focus(s.plan?.destId ?? s.destId);
        }
      }
      if (s.muted !== prev.muted) this.sound.setMuted(s.muted);
    });

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

  /** Time-to-everywhere: refresh label sub-lines when inputs change. */
  private updateTravelTimes(s: Pick<AppState, "originId" | "accelG" | "timeMs">) {
    const key = `${s.originId}|${s.accelG}|${Math.floor(s.timeMs / TT_BUCKET_MS)}`;
    if (key === this.ttKey) return;
    this.ttKey = key;
    const date = new Date(s.timeMs);
    for (const v of this.visuals.values()) {
      if (v.def.kind === "star" || v.def.id === s.originId) {
        v.timeEl.textContent = v.def.id === s.originId ? "◉ origin" : "";
        continue;
      }
      try {
        const plan = planFlight(this.eph, s.originId, v.def.id, date, s.accelG);
        v.timeEl.textContent = fmtDuration(plan.travelTimeSec);
      } catch {
        v.timeEl.textContent = "";
      }
    }
  }

  render(s: AppState, dt: number) {
    const date = new Date(s.timeMs);
    const jdNow = dateToJd(date);

    const resolve = (id: string, d: Date): Vec3 => {
      if (id === SHIP_FOCUS) {
        if (!s.plan) return this.eph.stateOf(s.destId, d).pos;
        const t = (d.getTime() - s.plan.depart.getTime()) / 1000;
        return shipPosition(s.plan, t);
      }
      return this.eph.stateOf(id, d).pos;
    };

    const originKm = this.controls.update(dt, resolve, date);
    const camOff = this.controls.cameraOffset();
    this.camera.position.set(camOff.x, camOff.y, camOff.z);
    this.camera.lookAt(0, 0, 0);

    const kmPerPx = (p: Vec3) => this.kmPerPixelAt(p, originKm, camOff);

    // Bodies
    for (const v of this.visuals.values()) {
      const pos =
        v.def.kind === "star"
          ? { x: 0, y: 0, z: 0 }
          : this.eph.stateOf(v.def.id, date).pos;
      v.group.position.set(pos.x - originKm.x, pos.y - originKm.y, pos.z - originKm.z);

      const px = kmPerPx(pos);
      const apparentPx = (2 * v.def.radiusKm) / px;
      const showDot = apparentPx < 5;
      v.sprite.visible = showDot;
      if (showDot) {
        const sc = (v.def.kind === "planet" ? 7 : 5) * px;
        v.sprite.scale.set(sc, sc, 1);
      }
      v.labelEl.classList.toggle("focused", v.def.id === this.controls.focusId);

      if (v.mesh && v.def.spinHours) {
        const spin = (2 * Math.PI * (s.timeMs / 3_600_000)) / v.def.spinHours;
        // Spheres are tilted pole-to-+Z via rotation.x; their native pole is
        // +Y, so spin goes on rotation.y. Packed models (Eros) are already
        // +Z-pole in their body frame, so spin goes on rotation.z.
        if (v.def.model) v.mesh.rotation.z = spin;
        else v.mesh.rotation.y = spin;
      }
    }

    this.updateTravelTimes(s);

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

    // Trajectory chord + flip marker
    if (s.plan !== this.lastPlan) {
      this.trajectory.setPlan(s.plan);
      this.lastPlan = s.plan;
    }
    this.trajectory.update(originKm, kmPerPx);

    // Ship
    const shipState = this.shipVisual.update(
      s.plan,
      s.timeMs,
      originKm,
      kmPerPx,
      s.ride ? 30 : 12,
      dt
    );
    const phase: BurnPhase = shipState?.phase ?? "off";

    // Ride bookkeeping: sound, flip cue, auto-exit at arrival.
    if (s.ride && s.plan) {
      if (phase === "flip" && this.lastPhase === "burn") this.sound.flipCue();
      const thrust =
        phase === "burn" || phase === "brake"
          ? 0.35 + 0.65 * Math.min(s.plan.accelG / 5, 1)
          : 0;
      this.sound.setThrust(thrust);

      const tSec = (s.timeMs - s.plan.depart.getTime()) / 1000;
      if (tSec > s.plan.travelTimeSec * 1.02) {
        s.setRide(false);
        s.setPlaying(false);
        s.setSpeed(2);
      }
    }
    this.lastPhase = phase;
    this.hud.update(s.ride, s.plan, s.timeMs, phase);

    // Tightbeam
    if (s.beamStartMs !== null) {
      const alive = this.tightbeam.update(
        true,
        this.eph,
        s.originId,
        s.destId,
        date,
        originKm,
        kmPerPx
      );
      if (!alive) s.clearBeam();
    } else {
      this.tightbeam.update(false, this.eph, s.originId, s.destId, date, originKm, kmPerPx);
    }

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
