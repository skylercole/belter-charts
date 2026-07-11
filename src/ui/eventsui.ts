/**
 * Canon timeline UI: event markers on the scrubber, prev/next event
 * navigation, an event card with blurb + citation, and spoiler mode —
 * events beyond the "I have read up to" marker stay hidden.
 */
import { EVENTS, type CanonEvent } from "../timeline";
import { fmtDate } from "./format";
import { BOOKS } from "./spoiler";
import { ERA_END_MS, ERA_START_MS, store } from "./store";

export function mountEventsUi(
  app: HTMLElement,
  timebar: HTMLElement,
  onFocus: (bodyId: string) => void
) {
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
    const level = store.getState().spoilerBook;
    return EVENTS.filter((e) => e.spoiler <= level);
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
    const spoilerLevel = store.getState().spoilerBook;
    card.dataset.spoiler = String(e.spoiler);
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
        store.getState().setSpoilerBook(Number((ev.target as HTMLSelectElement).value));
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

  // The gate can change from the panel control too: refresh the scrubber
  // marks, keep an open card's select in step, and close a card whose
  // event just fell behind the gate.
  store.subscribe((s, prev) => {
    if (s.spoilerBook === prev.spoilerBook) return;
    renderMarks();
    const sel = card.querySelector<HTMLSelectElement>("#spoiler-sel");
    if (sel) sel.value = String(s.spoilerBook);
    if (Number(card.dataset.spoiler ?? "1") > s.spoilerBook) {
      card.classList.add("hidden");
    }
  });

  renderMarks();
}
