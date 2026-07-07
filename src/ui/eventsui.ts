/**
 * Canon timeline UI: event markers on the scrubber, prev/next event
 * navigation, an event card with blurb + citation, and spoiler mode —
 * events beyond the "I have read up to" marker stay hidden.
 */
import { EVENTS, type CanonEvent } from "../timeline";
import { fmtDate } from "./format";
import { ERA_END_MS, ERA_START_MS, store } from "./store";

const SPOILER_KEY = "fnb-spoiler-book";
const BOOKS = [
  "Leviathan Wakes",
  "Caliban's War",
  "Abaddon's Gate",
  "Cibola Burn",
  "Nemesis Games",
  "Babylon's Ashes",
];

export function mountEventsUi(
  app: HTMLElement,
  timebar: HTMLElement,
  onFocus: (bodyId: string) => void
) {
  let spoilerLevel = Number(localStorage.getItem(SPOILER_KEY) ?? "1");

  // --- markers over the scrubber ---
  const scrub = timebar.querySelector<HTMLInputElement>("#scrub")!;
  const wrap = document.createElement("div");
  wrap.className = "scrub-wrap";
  scrub.parentElement!.insertBefore(wrap, scrub);
  wrap.appendChild(scrub);
  const marks = document.createElement("div");
  marks.id = "event-marks";
  wrap.appendChild(marks);

  // --- prev/next buttons ---
  const prevBtn = document.createElement("button");
  prevBtn.id = "ev-prev";
  prevBtn.textContent = "◄ ev";
  prevBtn.dataset.tip = "previous canon event";
  const nextBtn = document.createElement("button");
  nextBtn.id = "ev-next";
  nextBtn.textContent = "ev ►";
  nextBtn.dataset.tip = "next canon event";
  wrap.parentElement!.insertBefore(prevBtn, wrap);
  wrap.parentElement!.insertBefore(nextBtn, wrap.nextSibling);

  // --- event card ---
  const card = document.createElement("div");
  card.id = "event-card";
  card.classList.add("hidden");
  app.appendChild(card);

  function visibleEvents(): CanonEvent[] {
    return EVENTS.filter((e) => e.spoiler <= spoilerLevel);
  }

  function renderMarks() {
    marks.innerHTML = "";
    for (const e of visibleEvents()) {
      const tick = document.createElement("button");
      tick.className = "event-tick";
      tick.style.left = `${(100 * (e.dateMs - ERA_START_MS)) / (ERA_END_MS - ERA_START_MS)}%`;
      tick.title = `${e.title} — ${fmtDate(e.dateMs)}`;
      tick.addEventListener("click", () => jumpTo(e));
      marks.appendChild(tick);
    }
  }

  function showCard(e: CanonEvent) {
    card.innerHTML = `
      <div class="ec-head">
        <span class="ec-book">book ${e.spoiler} · ${BOOKS[e.spoiler - 1]}</span>
        <button class="ec-close">✕</button>
      </div>
      <h3>${e.title}</h3>
      <div class="ec-date">${fmtDate(e.dateMs)} XTE</div>
      <p>${e.blurb}</p>
      ${e.hint ? `<p class="ec-hint">${e.hint}</p>` : ""}
      <div class="ec-cite">${e.citation}</div>
      <label class="ec-spoiler">I have read up to:
        <select id="spoiler-sel">
          ${BOOKS.map(
            (b, i) =>
              `<option value="${i + 1}" ${i + 1 === spoilerLevel ? "selected" : ""}>${i + 1} · ${b}</option>`
          ).join("")}
        </select>
      </label>
    `;
    card.classList.remove("hidden");
    card.querySelector(".ec-close")!.addEventListener("click", () =>
      card.classList.add("hidden")
    );
    card.querySelector<HTMLSelectElement>("#spoiler-sel")!.addEventListener(
      "change",
      (ev) => {
        spoilerLevel = Number((ev.target as HTMLSelectElement).value);
        localStorage.setItem(SPOILER_KEY, String(spoilerLevel));
        renderMarks();
      }
    );
  }

  function jumpTo(e: CanonEvent) {
    const s = store.getState();
    s.setPlaying(false);
    s.setTime(e.dateMs);
    onFocus(e.focus);
    showCard(e);
  }

  prevBtn.addEventListener("click", () => {
    const t = store.getState().timeMs;
    const list = visibleEvents();
    const prev = [...list].reverse().find((e) => e.dateMs < t - 1000);
    if (prev) jumpTo(prev);
  });
  nextBtn.addEventListener("click", () => {
    const t = store.getState().timeMs;
    const next = visibleEvents().find((e) => e.dateMs > t + 1000);
    if (next) jumpTo(next);
  });

  renderMarks();
}
