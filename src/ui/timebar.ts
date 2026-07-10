/** Timeline scrubber: era slider, date display, play/pause, speed. */
import { fmtDateTime } from "./format";
import { ERA_END_MS, ERA_START_MS, store } from "./store";

const SPEEDS = [
  { d: 0.25, label: "6 h/s" },
  { d: 2, label: "2 d/s" },
  { d: 15, label: "15 d/s" },
  { d: 90, label: "90 d/s" },
];

export function mountTimebar(root: HTMLElement) {
  root.innerHTML = `
    <button id="play" data-tip="play / pause time (space)" data-tip-pos="right" aria-label="play or pause time">▶</button>
    <select id="speed">
      ${SPEEDS.map((s) => `<option value="${s.d}">${s.label}</option>`).join("")}
    </select>
    <input id="scrub" type="range" min="${ERA_START_MS}" max="${ERA_END_MS}" step="3600000" />
    <span id="clock"></span>
    <button id="traffic-btn" data-tip="toggle ambient system traffic (Miller's plot)" data-tip-pos="left" aria-label="toggle traffic"></button>
  `;

  const play = root.querySelector<HTMLButtonElement>("#play")!;
  const speed = root.querySelector<HTMLSelectElement>("#speed")!;
  const scrub = root.querySelector<HTMLInputElement>("#scrub")!;
  const clock = root.querySelector<HTMLSpanElement>("#clock")!;
  const trafficBtn = root.querySelector<HTMLButtonElement>("#traffic-btn")!;

  trafficBtn.addEventListener("click", () => {
    const s = store.getState();
    s.setTraffic(!s.trafficOn);
  });

  speed.value = String(store.getState().speedDaysPerSec);

  play.addEventListener("click", () => store.getState().togglePlaying());
  window.addEventListener("keydown", (e) => {
    if (
      e.code === "Space" &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      store.getState().togglePlaying();
    }
  });
  speed.addEventListener("change", () => store.getState().setSpeed(Number(speed.value)));
  scrub.addEventListener("input", () => store.getState().setTime(Number(scrub.value)));

  function render() {
    const s = store.getState();
    play.textContent = s.playing ? "❚❚" : "▶";
    scrub.value = String(s.timeMs);
    clock.textContent = fmtDateTime(s.timeMs) + " XTE";
    trafficBtn.textContent = s.trafficOn ? "⋮ traffic on" : "⋮ traffic off";
    trafficBtn.classList.toggle("off", !s.trafficOn);
  }

  store.subscribe(render);
  render();
}
