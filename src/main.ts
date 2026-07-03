import "./style.css";
import { loadEphemeris } from "./ephemeris";
import { Map2D } from "./map2d";
import { Scene3D } from "./scene";
import { mountPanel } from "./ui/panel";
import { mountTimebar } from "./ui/timebar";
import { store } from "./ui/store";

async function boot() {
  const base = import.meta.env.BASE_URL;
  const eph = await loadEphemeris(`${base}ephem`);
  document.getElementById("loading")!.remove();

  mountPanel(document.getElementById("panel")!, eph);
  mountTimebar(document.getElementById("timebar")!);

  const use2d = new URLSearchParams(location.search).get("view") === "2d";
  const app = document.getElementById("app")!;

  let render: (s: ReturnType<typeof store.getState>, dt: number) => void;

  if (use2d) {
    const canvas = document.getElementById("map") as HTMLCanvasElement;
    const map = new Map2D(canvas, eph);
    render = (s) => map.render(s.timeMs, s.plan);
  } else {
    document.getElementById("map")!.remove();
    const container = document.createElement("div");
    container.id = "scene3d";
    app.prepend(container);
    const scene = new Scene3D(container, eph, base);
    render = (s, dt) => scene.render(s, dt);
  }

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
