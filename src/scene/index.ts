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
import { track } from "../analytics";
import { arrivalMode, BODIES, BODY_BY_ID } from "../data/bodies";
import type { ArrivalMode } from "../data/bodies";
import type { Ephemeris } from "../ephemeris";
import { sampleOrbitPath, type OrbitPath } from "../ephemeris/orbitpath";
import { dateToJd } from "../ephemeris/time";
import type { Vec3 } from "../ephemeris/vec";
import { distance } from "../ephemeris/vec";
import { effectiveAccelG, planFlight, shipPosition } from "../planner";
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
import { TARGET_PATH_PTS, TrajectoryVisual } from "./trajectory";

const ORBIT_SAMPLES = 360;
const ORBIT_CACHE_DAYS = 45;
const AU_KM = 149_597_870.7;
/** pseudo focus id: midpoint of the planned route */
const ROUTE_FOCUS = "__route__";
/** ride-start seat: tuned so the intercept sits inside the FOV (verified) */
const RIDE_SEAT_PITCH = 0.3;
const RIDE_SEAT_DIST = 0.3;
/** pseudo focus id: live midpoint between ship and target (docking view) */
const DOCK_FOCUS = "__dock__";
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
  private targetPathScratch = new Float64Array(TARGET_PATH_PTS * 3);
  private rideBaseSpeed = 2;
  /** docking epilogue: wall-clock scripted glide after arrival */
  private dockAnim: {
    startWall: number;
    fromPos: Vec3;
    endPos: Vec3;
    arriveMs: number;
    thunked: boolean;
    puffs: number;
    mode: ArrivalMode;
    /** log-space dolly endpoints: one continuous zoom synced to the glide */
    dollyFromLn: number;
    dollyToLn: number;
  } | null = null;
  /** last drawn sim ship position; the epilogue glide starts here, not at a fixed offset */
  private lastShipPos: Vec3 | null = null;
  private fillLight: THREE.PointLight;

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
      // PBR reflections on hulls/stations from the same panorama
      this.scene.environment = tex;
      this.scene.environmentIntensity = 0.5;
    });

    this.sunLight = new THREE.PointLight(0xffffff, 2.4, 0, 0);
    this.scene.add(this.sunLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.07));
    // Camera-side fill so night-side arrivals stay readable; lit only
    // during the docking epilogue.
    this.fillLight = new THREE.PointLight(0xcfe0f5, 0, 0, 0);
    this.scene.add(this.fillLight);

    this.visuals = buildBodies(this.scene, base, (id) => this.controls.focus(id));
    this.trajectory = new TrajectoryVisual(this.scene);
    this.shipVisual = new ShipVisual(this.scene, base);
    this.shipVisual.setHull(store.getState().shipId);
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
        this.rideBaseSpeed = s.speedDaysPerSec;
        this.sound.unlock();
        rideMusic.unlock();
        if (s.plan) {
          // wall-clock ride length picks the track (short hop vs epic)
          const wallSec = s.plan.travelTimeSec / 86_400 / s.speedDaysPerSec;
          rideMusic.start(s.scenario === "epstein" ? 45 : wallSec);
        }
        this.controls.focus(SHIP_FOCUS);
        this.controls.rideLock = true;
        // Cinematic chase seat: above the ecliptic, behind the ship, view
        // blended toward the target and Sol so the route and the inner
        // system spread out ahead.
        if (s.plan) {
          const dp = s.plan.departPos;
          const chord = {
            x: s.plan.arrivePos.x - dp.x,
            y: s.plan.arrivePos.y - dp.y,
            z: s.plan.arrivePos.z - dp.z,
          };
          // View aims at the target, skewed toward Sol — but the skew is
          // clamped to ±15° so the intercept always stays inside the FOV.
          const thetaTarget = Math.atan2(chord.y, chord.x);
          const thetaSun = Math.atan2(-dp.y, -dp.x);
          let skew = thetaSun - thetaTarget;
          while (skew > Math.PI) skew -= 2 * Math.PI;
          while (skew < -Math.PI) skew += 2 * Math.PI;
          skew = Math.min(Math.max(skew, -0.26), 0.26);
          const theta = thetaTarget + skew;
          this.controls.setOrientation(
            Math.atan2(-Math.sin(theta), -Math.cos(theta)),
            RIDE_SEAT_PITCH
          );
          // High seat: far enough back that the route, its ellipses and the
          // inner system spread out below (the ship is screen-constant, so
          // it stays visible at any distance).
          this.controls.setDistTarget(
            Math.min(Math.max(s.plan.distanceKm * RIDE_SEAT_DIST, 5e6), 1.8e8)
          );
        }
        this.braceWarned = false;
        this.epitaphShown = false;
        this.lastShipPos = null;
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
        if (this.controls.focusId === SHIP_FOCUS || this.controls.focusId === DOCK_FOCUS) {
          this.controls.focus(
            prev.scenario === "epstein" ? "mars" : (s.plan?.destId ?? s.destId)
          );
        }
      }
      if (s.muted !== prev.muted) {
        this.sound.setMuted(s.muted);
        rideMusic.setMuted(s.muted);
      }
      if (s.shipId !== prev.shipId) this.shipVisual.setHull(s.shipId);
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
      // moons: heliocentric orbit lines are illegible wiggles; skip
      if (def.kind === "star" || def.kind === "moon") continue;
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
  private updateTravelTimes(
    s: Pick<AppState, "originId" | "accelG" | "timeMs" | "honesty">
  ) {
    const g = effectiveAccelG(s.accelG, s.honesty);
    const key = `${s.originId}|${g}|${Math.floor(s.timeMs / TT_BUCKET_MS)}`;
    if (key === this.ttKey) return;
    this.ttKey = key;
    const date = new Date(s.timeMs);
    for (const v of this.visuals.values()) {
      if (v.def.kind === "star" || v.def.id === s.originId) {
        v.timeEl.textContent = v.def.id === s.originId ? "◉ origin" : "";
        continue;
      }
      if (!this.eph.exists(v.def.id, date)) {
        v.timeEl.textContent = "";
        continue;
      }
      try {
        const plan = planFlight(this.eph, s.originId, v.def.id, date, g);
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
      if (id === DOCK_FOCUS) {
        if (!s.plan) return this.eph.stateOf(s.destId, d).pos;
        const t = (d.getTime() - s.plan.depart.getTime()) / 1000;
        const ship = shipPosition(s.plan, t);
        const target = this.eph.stateOf(s.plan.destId, d).pos;
        return {
          x: (ship.x + target.x) / 2,
          y: (ship.y + target.y) / 2,
          z: (ship.z + target.z) / 2,
        };
      }
      return this.eph.stateOf(id, d).pos;
    };

    // attract mode drives the controls when everything is idle
    this.attract.update(dt, s.playing || s.ride || s.beamStartMs !== null);

    // Travel-time sublabels are origin-relative — meaningless mid-ride.
    this.labelRenderer.domElement.classList.toggle("riding", s.ride);

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

    // Bodies (BODIES order puts parents before their moons)
    const framePos = new Map<string, Vec3>();
    for (const v of this.visuals.values()) {
      // timeline existence: Eros after Venus impact, the Ring before it appears
      const exists = this.eph.exists(v.def.id, date);
      v.group.visible = exists;
      if (!exists) {
        v.label.visible = false;
        continue;
      }
      const pos =
        v.def.kind === "star"
          ? { x: 0, y: 0, z: 0 }
          : this.eph.stateOf(v.def.id, date).pos;
      framePos.set(v.def.id, pos);
      v.group.position.set(pos.x - originKm.x, pos.y - originKm.y, pos.z - originKm.z);

      const px = kmPerPx(pos);

      // moons declutter: hidden until they visually separate from the parent
      let moonVisible = true;
      if (v.def.kind === "moon") {
        const parentPos = framePos.get(v.def.moon!.parent);
        if (parentPos) {
          const sepPx =
            Math.hypot(
              pos.x - parentPos.x,
              pos.y - parentPos.y,
              pos.z - parentPos.z
            ) / px;
          moonVisible = sepPx > 26;
        }
      }
      v.label.visible = moonVisible;

      const apparentPx = (2 * v.def.radiusKm) / px;
      const showDot = apparentPx < 5 && !cockpitActive && moonVisible;
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
      // Earth's day/night shader tracks the real sun direction
      if (v.mesh) {
        const mat = v.mesh.material as THREE.ShaderMaterial;
        if (mat.userData?.isDayNight) {
          const r = Math.hypot(pos.x, pos.y, pos.z) || 1;
          mat.uniforms.uSunDir.value.set(-pos.x / r, -pos.y / r, -pos.z / r);
        }
      }
    }

    this.updateTravelTimes(s);

    // Sun light sits at the sun
    this.sunLight.position.set(-originKm.x, -originKm.y, -originKm.z);

    // Orbit lines: refresh samples when the clock drifts, rewrite
    // origin-relative coords every frame.
    for (const def of BODIES) {
      if (def.kind === "star" || def.kind === "moon") continue;
      const entry = this.orbitLines.get(def.id)!;
      const exists = this.eph.exists(def.id, date);
      entry.line.visible = exists;
      if (!exists) continue;
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
    if (s.plan) {
      const tSec = (s.timeMs - s.plan.depart.getTime()) / 1000;
      // Retire the overlay once the flight is well over — otherwise the
      // target visibly sails away from a stale chord and reads as a miss.
      this.trajectory.setExpired(tSec > s.plan.travelTimeSec + 6 * 3600 || !!this.dockAnim);
      this.trajectory.update(originKm, kmPerPx);
      // Mid-flight: the target's own future path to the intercept point.
      if (tSec > 0 && tSec < s.plan.travelTimeSec && this.eph.exists(s.plan.destId, date)) {
        const n = TARGET_PATH_PTS;
        for (let i = 0; i < n; i++) {
          const f = i / (n - 1);
          const when = new Date(s.timeMs + (s.plan.travelTimeSec - tSec) * 1000 * f);
          const p = this.eph.stateOf(s.plan.destId, when).pos;
          this.targetPathScratch[i * 3] = p.x;
          this.targetPathScratch[i * 3 + 1] = p.y;
          this.targetPathScratch[i * 3 + 2] = p.z;
        }
        this.trajectory.updateTargetPath(this.targetPathScratch, n, originKm);
      } else {
        this.trajectory.updateTargetPath(this.targetPathScratch, 0, originKm);
      }
    } else {
      this.trajectory.update(originKm, kmPerPx);
    }

    // Ride bookkeeping: sound, brace warning, flip cue, g overlay, endings.
    if (s.ride && s.plan) {
      const tSec = (s.timeMs - s.plan.depart.getTime()) / 1000;
      const epstein = s.scenario === "epstein";
      if (shipState) this.lastShipPos = shipState.pos;

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

      // Docking view: braking makes the target angularly diverge from the
      // intercept point until the final seconds (lateral shrinks ~t, range
      // ~t^2). In the last quarter, pull the chase cam back to frame both
      // ship and target so the convergence is visible, and taper sim speed
      // so the merge doesn't flash past.
      const progress = tSec / s.plan.travelTimeSec;
      if (!epstein && shipState && progress > 0.75 && progress < 1 && !this.dockAnim) {
        if (!s.cockpit) {
          // focus the live ship-target midpoint: both guaranteed in frame
          if (this.controls.focusId !== DOCK_FOCUS) this.controls.focus(DOCK_FOCUS);
          const target = this.eph.stateOf(s.plan.destId, date).pos;
          const sep = distance(shipState.pos, target);
          this.controls.setDistTarget(Math.max(2500, sep * 1.15));
        }
        if (progress > 0.97) {
          const f = Math.max(0.35, (1 - progress) / 0.03);
          s.setSpeed(this.rideBaseSpeed * f);
        }
      }

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
        // Docking epilogue: freeze sim, glide the last stretch on wall time.
        if (!this.dockAnim && tSec >= s.plan.travelTimeSec) {
          const destDef = BODY_BY_ID.get(s.plan.destId);
          const radius = Math.max(destDef?.radiusKm ?? 5, 2);
          const mode = arrivalMode(destDef);
          // dock/land end against the hull/surface; orbit/hold stand off
          const endK = { dock: 1.15, land: 1.06, orbit: 2.2, hold: 1.6 }[mode];
          const back = {
            x: s.plan.departPos.x - s.plan.arrivePos.x,
            y: s.plan.departPos.y - s.plan.arrivePos.y,
            z: s.plan.departPos.z - s.plan.arrivePos.z,
          };
          const bl = Math.hypot(back.x, back.y, back.z) || 1;
          const at = (k: number): Vec3 => ({
            x: s.plan!.arrivePos.x + (back.x / bl) * radius * k,
            y: s.plan!.arrivePos.y + (back.y / bl) * radius * k,
            z: s.plan!.arrivePos.z + (back.z / bl) * radius * k,
          });
          // Glide in from wherever the ship was last drawn: no teleport.
          const dLast = this.lastShipPos
            ? distance(this.lastShipPos, s.plan.arrivePos)
            : radius * 8;
          const startK = Math.min(Math.max(dLast / radius, 3), 8);
          const dollyTo = Math.max(radius * 5, 40);
          this.dockAnim = {
            startWall: performance.now(),
            fromPos: at(startK),
            endPos: at(endK),
            arriveMs: s.plan.arrive.getTime(),
            thunked: false,
            puffs: 0,
            mode,
            // floor at dollyTo: never dolly outward on a user already zoomed in
            dollyFromLn: Math.log(Math.max(this.controls.dist, dollyTo)),
            dollyToLn: Math.log(dollyTo),
          };
          s.setPlaying(false);
          // Snap the frozen clock to exact arrival so the final comm lines
          // fire and the scrub-cancel window is centered.
          s.setTime(this.dockAnim.arriveMs);
          this.sound.setThrust(0);
          // Camera rail: sit on the approach side, biased sunward so the
          // lit limb faces us; the glide path then stays in frame and is
          // never occluded by the body.
          const ax = back.x / bl;
          const ay = back.y / bl;
          const az = back.z / bl;
          const rs =
            Math.hypot(s.plan.arrivePos.x, s.plan.arrivePos.y, s.plan.arrivePos.z) || 1;
          let cx = ax - (0.7 * s.plan.arrivePos.x) / rs;
          let cy = ay - (0.7 * s.plan.arrivePos.y) / rs;
          let cz = az - (0.7 * s.plan.arrivePos.z) / rs;
          const cl = Math.hypot(cx, cy, cz) || 1;
          cx /= cl;
          cy /= cl;
          cz /= cl;
          const desiredYaw = Math.atan2(cy, cx);
          const desiredPitch = Math.asin(Math.min(Math.max(cz, -1), 1)) + 0.15;
          // unwrap so the damped ease rotates the short way around
          let dy = desiredYaw - this.controls.yaw;
          dy = ((dy % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
          this.controls.setOrientation(this.controls.yaw + dy, desiredPitch);
          this.controls.focus(s.plan.destId);
          this.controls.setDistTarget(Math.exp(this.dockAnim.dollyFromLn));
        }
      }
    } else {
      this.overlays.setG(0, false);
    }

    // Drive the docking epilogue (wall clock; sim is frozen at arrival).
    // Fill light is re-raised below while the epilogue runs; zeroing it
    // here first covers every exit path.
    this.fillLight.intensity = 0;
    let hudPhase = phase;
    if (this.dockAnim && s.ride && s.plan) {
      const da = this.dockAnim;
      // user scrubbed away or exited: cancel cleanly
      if (Math.abs(s.timeMs - da.arriveMs) > 120_000) {
        this.dockAnim = null;
        s.setRide(false);
        s.setSpeed(2);
      } else {
        const wall = (performance.now() - da.startWall) / 1000;
        const p = Math.min(wall / 5.5, 1);
        const eased = p * p * (3 - 2 * p);
        const glide = {
          x: da.fromPos.x + (da.endPos.x - da.fromPos.x) * eased,
          y: da.fromPos.y + (da.endPos.y - da.fromPos.y) * eased,
          z: da.fromPos.z + (da.endPos.z - da.fromPos.z) * eased,
        };
        this.shipVisual.updateDocking(s.plan, glide, originKm, kmPerPx, 30, wall);
        hudPhase = "dock";
        // dolly synced to the glide: one continuous log-space move; the
        // wheel regains control once the glide settles
        if (p < 1) {
          this.controls.setDistTarget(
            Math.exp(da.dollyFromLn + (da.dollyToLn - da.dollyFromLn) * eased)
          );
        }
        // fill: ramp in over 1.5 s, fade out over the last 0.8 s
        const rIn = Math.min(wall / 1.5, 1);
        const rOut = Math.min(Math.max((7.2 - wall) / 0.8, 0), 1);
        this.fillLight.intensity = 0.5 * rIn * rIn * (3 - 2 * rIn) * rOut;
        this.fillLight.position.copy(this.camera.position);
        // sparse RCS hisses as the glide corrects
        const dueTuffs = p < 1 ? Math.floor(p * 4) : 4;
        if (dueTuffs > da.puffs) {
          da.puffs = dueTuffs;
          this.sound.rcsPuff();
        }
        if (p >= 1 && !da.thunked) {
          da.thunked = true;
          const mode = da.mode;
          // orbit/hold: no clamps or skids to slam home, so no thunk
          if (mode === "dock" || mode === "land") this.sound.dockThunk();
          this.overlays.flash(
            {
              dock: "DOCKING CLAMPS ENGAGED",
              land: "TOUCHDOWN — SKIDS DOWN",
              orbit: "ORBITAL INSERTION COMPLETE",
              hold: "STATION-KEEPING AT THE RING",
            }[mode],
            "info",
            2400
          );
          track("docking-complete");
        }
        if (wall > 7.2) {
          this.dockAnim = null;
          s.setRide(false);
          s.setSpeed(2);
        }
      }
    } else if (this.dockAnim && !s.ride) {
      this.dockAnim = null; // user hit release couch mid-epilogue
    }

    this.lastPhase = phase;
    this.hud.update(s.ride, s.plan, s.timeMs, hudPhase, s.scenario, s.cockpit);
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
