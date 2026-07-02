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
    <button id="play" title="play/pause (space)">▶</button>
    <select id="speed">
      ${SPEEDS.map((s) => `<option value="${s.d}">${s.label}</option>`).join("")}
    </select>
    <input id="scrub" type="range" min="${ERA_START_MS}" max="${ERA_END_MS}" step="3600000" />
    <span id="clock"></span>
  `;

  const play = root.querySelector<HTMLButtonElement>("#play")!;
  const speed = root.querySelector<HTMLSelectElement>("#speed")!;
  const scrub = root.querySelector<HTMLInputElement>("#scrub")!;
  const clock = root.querySelector<HTMLSpanElement>("#clock")!;

  speed.value = String(store.getState().speedDaysPerSec);

  play.addEventListener("click", () => store.getState().togglePlaying());
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
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
  }

  store.subscribe(render);
  render();
}
