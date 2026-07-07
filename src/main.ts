import "./style.css";
import { track } from "./analytics";
import { loadEphemeris } from "./ephemeris";
import { Map2D } from "./map2d";
import { Scene3D } from "./scene";
import { effectiveAccelG, planFlight } from "./planner";
import { TimelineEphemeris } from "./timeline";
import { mountAbout } from "./ui/about";
import { mountFeedback } from "./ui/feedback";
import { mountEventsUi } from "./ui/eventsui";
import { parseShareUrl } from "./ui/share";
import { mountNavRail } from "./ui/navrail";
import { mountPanel } from "./ui/panel";
import { mountTimebar } from "./ui/timebar";
import { maybeStartTour } from "./ui/tour";
import { store } from "./ui/store";

/** Keyboard flight: H home, [ ] cycle, 1-8 planets, 9 Ceres, 0 Sol, G route. */
const DIGIT_FOCUS: Record<string, string> = {
  Digit1: "mercury",
  Digit2: "venus",
  Digit3: "earth",
  Digit4: "mars",
  Digit5: "jupiter",
  Digit6: "saturn",
  Digit7: "uranus",
  Digit8: "neptune",
  Digit9: "ceres",
  Digit0: "sun",
};

function bindKeyboard(scene: Scene3D) {
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLSelectElement ||
      t instanceof HTMLTextAreaElement
    )
      return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code in DIGIT_FOCUS) scene.focus(DIGIT_FOCUS[e.code]);
    else if (e.code === "KeyH") scene.goHome();
    else if (e.code === "BracketRight") scene.cycleFocus(1);
    else if (e.code === "BracketLeft") scene.cycleFocus(-1);
    else if (e.code === "KeyG") scene.frameRoute();
  });
}

async function boot() {
  const base = import.meta.env.BASE_URL;
  const eph = new TimelineEphemeris(await loadEphemeris(`${base}ephem`));
  document.getElementById("loading")!.remove();

  // Shared plan in the URL: restore state before the panels mount.
  const shared = parseShareUrl(location.search);
  if (shared) {
    const s = store.getState();
    s.setShip(shared.shipId);
    s.setOrigin(shared.originId);
    s.setDest(shared.destId);
    s.setAccel(shared.accelG);
    s.setHonesty(shared.honesty);
    s.setTime(shared.timeMs);
  }

  mountPanel(document.getElementById("panel")!, eph);
  mountTimebar(document.getElementById("timebar")!);
  mountAbout(document.getElementById("app")!, document.getElementById("about-btn")!);
  mountFeedback(document.getElementById("app")!, document.getElementById("feedback-btn")!);

  if (shared) {
    track("shared-link-opened");
    // re-plan the shared route
    try {
      const s = store.getState();
      s.setPlan(
        planFlight(
          eph,
          s.originId,
          s.destId,
          new Date(s.timeMs),
          effectiveAccelG(s.accelG, s.honesty)
        )
      );
    } catch {
      /* out-of-era share links just land on the date */
    }
  }

  const use2d = new URLSearchParams(location.search).get("view") === "2d";
  const app = document.getElementById("app")!;

  let render: (s: ReturnType<typeof store.getState>, dt: number) => void;

  const timebarEl = document.getElementById("timebar")!;
  if (use2d) {
    const canvas = document.getElementById("map") as HTMLCanvasElement;
    const map = new Map2D(canvas, eph);
    render = (s) => map.render(s.timeMs, s.plan);
    mountEventsUi(app, timebarEl, () => {});
  } else {
    document.getElementById("map")!.remove();
    const container = document.createElement("div");
    container.id = "scene3d";
    app.prepend(container);
    const scene = new Scene3D(container, eph, base);
    render = (s, dt) => scene.render(s, dt);
    mountNavRail(app, {
      onSelect: (id) => scene.focus(id),
      onHome: () => scene.goHome(),
      current: () => scene.controls.focusId,
    });
    bindKeyboard(scene);
    mountEventsUi(app, timebarEl, (id) => scene.focus(id));
  }

  // The ride is a full-screen experience: the planner panel gets out of the way.
  store.subscribe((s, prev) => {
    if (s.ride !== prev.ride) app.classList.toggle("riding", s.ride);
  });

  maybeStartTour({ sharedArrival: !!shared });

  let lastFrame = performance.now();
  function frame(now: number) {
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    const s = store.getState();
    if (s.playing) {
      s.setTime(s.timeMs + s.speedDaysPerSec * 86_400_000 * dt);
    }
    render(store.getState(), dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  const el = document.getElementById("loading")!;
  el.textContent = `failed to load: ${e.message}`;
  console.error(e);
});
