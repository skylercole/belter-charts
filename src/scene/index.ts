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
import { BODIES, BODY_BY_ID } from "../data/bodies";
import type { Ephemeris } from "../ephemeris";
import { sampleOrbitPath, type OrbitPath } from "../ephemeris/orbitpath";
import { dateToJd } from "../ephemeris/time";
import type { Vec3 } from "../ephemeris/vec";

import { planFlight, shipPosition } from "../planner";
import { fmtDuration } from "../ui/format";
import { store, type AppState } from "../ui/store";
import { AttractMode } from "./attract";
import { buildBodies, type BodyVisual } from "./bodies3d";
import { Cockpit } from "./cockpit";
import { CommLog } from "./commlog";
import { FocusControls, SHIP_FOCUS } from "./controls";
import { EPSTEIN_EPITAPH, EPSTEIN_SCRIPT } from "./epstein";
import { RideHud } from "./hud";
import { rideMusic } from "./music";
import { RideOverlays } from "./overlays";
import { ShipVisual, type BurnPhase } from "./ship";
import { EngineSound } from "./sound";
import { TightbeamVisual } from "./tightbeam";
import { OrbitTrails } from "./trails";
import { TrajectoryVisual } from "./trajectory";

const ORBIT_SAMPLES = 360;
const ORBIT_CACHE_DAYS = 45;
const AU_KM = 149_597_870.7;
/** pseudo focus id: midpoint of the planned route */
const ROUTE_FOCUS = "__route__";
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
  private overlays: RideOverlays;
  private commLog: CommLog;
  private cockpit: Cockpit;
  private trails: OrbitTrails;
  private attract: AttractMode;
  private sound = new EngineSound();
  private sunLight: THREE.PointLight;
  private orbitLines = new Map<string, { line: THREE.Line; path: OrbitPath }>();
  private lastPlan: AppState["plan"] = null;
  private lastPhase: BurnPhase = "off";
  private braceWarned = false;
  private epitaphShown = false;
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

    // Near plane 0.5 m: the log depth buffer keeps precision, and hull
    // close-ups (46 m ship) need it.
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.0005, 2e10);
    this.camera.up.set(0, 0, 1); // ecliptic north

    this.controls = new FocusControls(this.renderer.domElement, 9 * AU_KM);
    rideMusic.setBaseUrl(base);

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
    this.shipVisual = new ShipVisual(this.scene, base);
    this.tightbeam = new TightbeamVisual(this.scene);
    this.hud = new RideHud(container);
    this.overlays = new RideOverlays(container);
    this.commLog = new CommLog(container);
    this.cockpit = new Cockpit(this.scene, container);
    this.trails = new OrbitTrails(this.scene);
    this.attract = new AttractMode(this.controls, this.renderer.domElement);
    this.buildOrbitLines();
    this.bindDoubleClick();

    // Runs synchronously inside the Engage click's dispatch, so the
    // AudioContexts are created within a user gesture.
    store.subscribe((s, prev) => {
      if (s.ride && !prev.ride) {
        this.sound.unlock();
        rideMusic.unlock();
        if (s.plan) {
          // wall-clock ride length picks the track (short hop vs epic)
          const wallSec = s.plan.travelTimeSec / 86_400 / s.speedDaysPerSec;
          rideMusic.start(s.scenario === "epstein" ? 45 : wallSec);
        }
        this.controls.focus(SHIP_FOCUS);
        this.controls.rideLock = true;
        this.braceWarned = false;
        this.epitaphShown = false;
        if (s.scenario === "epstein" && s.plan) {
          this.commLog.setCustomScript(s.plan, EPSTEIN_SCRIPT);
        } else {
          this.commLog.setPlan(s.plan);
        }
        if (s.accelG > 2) {
          this.overlays.flash("JUICE ADMINISTERED", "juice");
          this.sound.heartbeat();
        }
      }
      if (!s.ride && prev.ride) {
        this.controls.rideLock = false;
        this.sound.stop();
        rideMusic.stop();
        this.overlays.setG(0, false);
        this.overlays.hideEpitaph();
        if (this.controls.focusId === SHIP_FOCUS) {
          this.controls.focus(
            prev.scenario === "epstein" ? "mars" : (s.plan?.destId ?? s.destId)
          );
        }
      }
      if (s.muted !== prev.muted) {
        this.sound.setMuted(s.muted);
        rideMusic.setMuted(s.muted);
      }
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

  /** Pull back to the whole-system view. */
  goHome() {
    this.controls.focus("sun");
    this.controls.setDistTarget(9 * AU_KM);
  }

  /** Frame the planned route: focus the chord midpoint, fit the chord. */
  frameRoute(): boolean {
    const plan = store.getState().plan;
    if (!plan) return false;
    this.controls.focus(ROUTE_FOCUS);
    this.controls.setDistTarget(Math.max(plan.distanceKm * 0.8, 5000));
    return true;
  }

  /** Cycle focus through the body list (dir = +1 / -1). */
  cycleFocus(dir: number) {
    const ids = BODIES.map((b) => b.id);
    const idx = ids.indexOf(this.controls.focusId);
    const next = ids[(idx + dir + ids.length) % ids.length];
    this.controls.focus(next);
  }

  private bindDoubleClick() {
    this.renderer.domElement.addEventListener("dblclick", (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      let best: { id: string; d: number } | null = null;
      const v = new THREE.Vector3();
      for (const vis of this.visuals.values()) {
        v.copy(vis.group.position).project(this.camera);
        if (v.z > 1) continue; // behind camera
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h;
        const d = Math.hypot(sx - mx, sy - my);
        if (d < 26 && (!best || d < best.d)) best = { id: vis.def.id, d };
      }
      if (best) this.controls.focus(best.id);
    });
  }

  /** km of world space per screen pixel at heliocentric point p. */
  private kmPerPixelAt(p: Vec3, originKm: Vec3, camWorld: THREE.Vector3): number {
    const dx = p.x - (originKm.x + camWorld.x);
    const dy = p.y - (originKm.y + camWorld.y);
    const dz = p.z - (originKm.z + camWorld.z);
    const d = Math.hypot(dx, dy, dz);
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
      if (id === ROUTE_FOCUS) {
        if (!s.plan) return this.eph.stateOf(s.originId, d).pos;
        return {
          x: (s.plan.departPos.x + s.plan.arrivePos.x) / 2,
          y: (s.plan.departPos.y + s.plan.arrivePos.y) / 2,
          z: (s.plan.departPos.z + s.plan.arrivePos.z) / 2,
        };
      }
      return this.eph.stateOf(id, d).pos;
    };

    // attract mode drives the controls when everything is idle
    this.attract.update(dt, s.playing || s.ride || s.beamStartMs !== null);

    const originKm = this.controls.update(dt, resolve, date);

    // Ship state first (drives camera in cockpit mode).
    const shipState = this.shipVisual.update(
      s.plan,
      s.timeMs,
      originKm,
      (p) => this.kmPerPixelAt(p, originKm, this.camera.position),
      s.ride ? 30 : 12,
      dt
    );
    const phase: BurnPhase = shipState?.phase ?? "off";
    const thrusting = phase === "burn" || phase === "brake";

    const cockpitActive = !!(s.ride && s.cockpit && s.plan && shipState);
    this.cockpit.setVisible(cockpitActive);
    this.shipVisual.group.visible = !!shipState && !cockpitActive;

    const shake = thrusting ? Math.min(s.accelG / 6, 1.5) : 0;
    if (cockpitActive && s.plan) {
      this.cockpit.update(
        this.camera,
        s.plan,
        s.timeMs,
        this.shipVisual.group.quaternion,
        this.shipVisual.group.position,
        shake
      );
      const arriveWorld = new THREE.Vector3(
        s.plan.arrivePos.x - originKm.x,
        s.plan.arrivePos.y - originKm.y,
        s.plan.arrivePos.z - originKm.z
      );
      this.camera.updateMatrixWorld();
      this.cockpit.placeDestMarker(
        this.camera,
        arriveWorld,
        BODY_BY_ID.get(s.plan.destId)?.name ?? "destination"
      );
    } else {
      const camOff = this.controls.cameraOffset();
      this.camera.position.set(camOff.x, camOff.y, camOff.z);
      const look = this.controls.lookTarget();
      this.camera.lookAt(look.x, look.y, look.z);
      if (s.ride && shake > 0) {
        // chase-cam judder scaled to thrust
        const j = 0.0035 * shake * this.controls.dist;
        this.camera.position.x += (Math.random() - 0.5) * j;
        this.camera.position.y += (Math.random() - 0.5) * j;
        this.camera.position.z += (Math.random() - 0.5) * j;
      }
    }

    const kmPerPx = (p: Vec3) => this.kmPerPixelAt(p, originKm, this.camera.position);

    // Bodies
    for (const v of this.visuals.values()) {
      const pos =
        v.def.kind === "star"
          ? { x: 0, y: 0, z: 0 }
          : this.eph.stateOf(v.def.id, date).pos;
      v.group.position.set(pos.x - originKm.x, pos.y - originKm.y, pos.z - originKm.z);

      const px = kmPerPx(pos);
      const apparentPx = (2 * v.def.radiusKm) / px;
      const showDot = apparentPx < 5 && !cockpitActive;
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

    // Trails
    this.trails.update(this.eph, s.timeMs, s.speedDaysPerSec, s.playing, originKm);

    // Trajectory chord + flip marker
    if (s.plan !== this.lastPlan) {
      this.trajectory.setPlan(s.plan);
      this.commLog.setPlan(s.plan);
      this.lastPlan = s.plan;
    }
    this.trajectory.update(originKm, kmPerPx);

    // Ride bookkeeping: sound, brace warning, flip cue, g overlay, endings.
    if (s.ride && s.plan) {
      const tSec = (s.timeMs - s.plan.depart.getTime()) / 1000;
      const epstein = s.scenario === "epstein";

      this.overlays.setG(phase === "flip" || phase === "off" ? 0 : s.plan.accelG, thrusting);

      // brace warning shortly before the flip
      const w = Math.max(s.plan.travelTimeSec * 0.012, 30);
      if (!epstein && !this.braceWarned && phase === "burn" && tSec > s.plan.flipTimeSec - 5 * w) {
        this.braceWarned = true;
        this.overlays.flash("BRACE FOR FLIP", "brace", 2600);
        this.sound.braceKlaxon();
      }
      if (phase === "flip" && this.lastPhase === "burn") {
        this.sound.flipCue();
        this.sound.creaks();
      }
      if (phase !== this.lastPhase) rideMusic.setFlip(phase === "flip");

      // rumble sits under the soundtrack: duck it while music plays
      const duck = rideMusic.isPlaying() ? 0.45 : 1;
      const thrust = thrusting ? (0.35 + 0.65 * Math.min(s.plan.accelG / 5, 1)) * duck : 0;
      this.sound.setThrust(thrust);

      if (epstein) {
        // fuel out at the pseudo-flip: cut everything, show the epitaph
        if (tSec >= s.plan.flipTimeSec && !this.epitaphShown) {
          this.epitaphShown = true;
          s.setPlaying(false);
          this.sound.setThrust(0);
          rideMusic.stop();
          this.sound.creaks();
          this.overlays.showEpitaph(EPSTEIN_EPITAPH, () => {
            s.setRide(false);
            s.setSpeed(2);
          });
        }
      } else {
        // Burn complete: cut the music right at arrival, even if the ride
        // lingers (docked pause, user scrubbing around the end).
        if (tSec >= s.plan.travelTimeSec && rideMusic.isPlaying()) {
          rideMusic.stop();
        }
        if (tSec > s.plan.travelTimeSec * 1.02) {
          this.sound.dockThunk();
          this.overlays.flash("DOCKING CLAMPS ENGAGED", "info", 2600);
          s.setRide(false);
          s.setPlaying(false);
          s.setSpeed(2);
        }
      }
    } else {
      this.overlays.setG(0, false);
    }
    this.lastPhase = phase;
    this.hud.update(s.ride, s.plan, s.timeMs, phase, s.scenario, s.cockpit);
    this.commLog.update(s.ride, s.timeMs);

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
