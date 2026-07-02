import "./style.css";
import { loadEphemeris } from "./ephemeris";
import { Map2D } from "./map2d";
import { mountPanel } from "./ui/panel";
import { mountTimebar } from "./ui/timebar";
import { store } from "./ui/store";

async function boot() {
  const eph = await loadEphemeris(`${import.meta.env.BASE_URL}ephem`);
  document.getElementById("loading")!.remove();

  const canvas = document.getElementById("map") as HTMLCanvasElement;
  const map = new Map2D(canvas, eph);
  mountPanel(document.getElementById("panel")!, eph);
  mountTimebar(document.getElementById("timebar")!);

  let lastFrame = performance.now();
  function frame(now: number) {
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    const s = store.getState();
    if (s.playing) {
      s.setTime(s.timeMs + s.speedDaysPerSec * 86_400_000 * dt);
    }
    map.render(s.timeMs, s.plan);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  const el = document.getElementById("loading")!;
  el.textContent = `failed to load: ${e.message}`;
  console.error(e);
});
