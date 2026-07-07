/**
 * First-visit spotlight tour: dims the app, glides a bright cutout across
 * the main UI surfaces, one tooltip card per stop. Hand-rolled — no library.
 */
import { track } from "../analytics";
import { store } from "./store";

const TOUR_KEY = "fnb-tour-done";
const PAD = 6;
const MARGIN = 12;

interface TourStep {
  /** selectors; the union of their rects is spotlighted */
  targets: string[];
  /** used instead when no target resolves */
  fallback?: string;
  title: string;
  body: string;
  /** preferred tooltip side; flips if it would overflow */
  side: "left" | "right" | "top" | "bottom";
}

const STEPS: TourStep[] = [
  {
    targets: ["#panel .route-row"],
    title: "Chart a course",
    body: "Pick origin and destination — Earth to Ceres, or anywhere in the well, beltalowda.",
    side: "right",
  },
  {
    targets: ["#panel .hull-row"],
    title: "Pick your hull",
    body: "From a Belter rock-hopper to a Donnager-class battleship — each hull has its own comfortable burn.",
    side: "right",
  },
  {
    targets: ["#g-row", "#honesty-row"],
    title: "Set the burn",
    body: "Choose your g. <i>Honest physics</i> flies the books' stated thrust; <i>canon feel</i> flies what the story narrates. Pick your truth.",
    side: "right",
  },
  {
    targets: ["#plan-btn"],
    title: "Flip and burn",
    body: "Plan a brachistochrone: accelerate to the midpoint, flip, decelerate. Then ride the burn in the chase cam.",
    side: "right",
  },
  {
    targets: ["#nav-rail"],
    title: "Fly the system",
    body: "One click tightbeams the camera to any rock, Mercury to Neptune. Clicking bodies in the chart works too.",
    side: "left",
  },
  {
    targets: ["#timebar .scrub-wrap"],
    fallback: "#timebar",
    title: "Twenty-five years of canon",
    body: "Scrub 2340–2365. The ticks are canon events — spoiler-gated to the book you've read up to.",
    side: "top",
  },
  {
    targets: ["#epstein-btn", "#about-btn"],
    title: "Stories and fine print",
    body: "Ride Solomon Epstein's last flight, or hit ⓘ for controls, credits — and to replay this tour.",
    side: "right",
  },
];

let active = false;

function visible(sel: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(sel);
  return el && el.getClientRects().length > 0 ? el : null;
}

/** All visible target elements for a step; their union rect is spotlighted. */
function stepEls(step: TourStep): HTMLElement[] {
  const els = step.targets.map(visible).filter((e): e is HTMLElement => !!e);
  if (els.length === 0 && step.fallback) {
    const fb = visible(step.fallback);
    if (fb) return [fb];
  }
  return els;
}

/** Auto-start on a first direct visit; share-link arrivals keep their view clear. */
export function maybeStartTour(opts: { sharedArrival: boolean }): void {
  if (opts.sharedArrival || localStorage.getItem(TOUR_KEY)) return;
  localStorage.setItem(TOUR_KEY, "1");
  // let the first scene frame paint behind the dimmer
  requestAnimationFrame(() => requestAnimationFrame(() => startTour("auto")));
}

export function startTour(source: "auto" | "replay"): void {
  if (active) return;
  const steps = STEPS.filter((s) => stepEls(s).length > 0);
  if (steps.length === 0) return;
  active = true;
  store.getState().setTourOpen(true);
  track(source === "auto" ? "tour-started" : "tour-replayed");

  const overlay = document.createElement("div");
  overlay.id = "tour-overlay";
  overlay.innerHTML = `
    <div class="tour-cutout"></div>
    <div class="tour-tip" role="dialog" aria-live="polite">
      <div class="tour-step-count"></div>
      <h3></h3>
      <p></p>
      <div class="tour-btns">
        <button class="tour-skip">skip</button>
        <button class="tour-back">◄ back</button>
        <button class="tour-next">next ►</button>
      </div>
    </div>
  `;
  document.getElementById("app")!.appendChild(overlay);

  const cutout = overlay.querySelector<HTMLElement>(".tour-cutout")!;
  const tip = overlay.querySelector<HTMLElement>(".tour-tip")!;
  const count = overlay.querySelector<HTMLElement>(".tour-step-count")!;
  const title = overlay.querySelector<HTMLElement>("h3")!;
  const body = overlay.querySelector<HTMLElement>("p")!;
  const skipBtn = overlay.querySelector<HTMLButtonElement>(".tour-skip")!;
  const backBtn = overlay.querySelector<HTMLButtonElement>(".tour-back")!;
  const nextBtn = overlay.querySelector<HTMLButtonElement>(".tour-next")!;

  let index = 0;
  let observer: ResizeObserver | null = null;

  function unionRect(els: HTMLElement[]): DOMRect {
    const rects = els.map((e) => e.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  }

  function placeTip(rect: DOMRect, side: TourStep["side"]) {
    // measured after content is set; clamped to the viewport
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fits = {
      right: rect.right + MARGIN + tw <= vw - MARGIN,
      left: rect.left - MARGIN - tw >= MARGIN,
      top: rect.top - MARGIN - th >= MARGIN,
      bottom: rect.bottom + MARGIN + th <= vh - MARGIN,
    };
    let s = side;
    if (!fits[s]) {
      const flip = { right: "left", left: "right", top: "bottom", bottom: "top" } as const;
      if (fits[flip[s]]) s = flip[s];
      else s = (Object.keys(fits) as (keyof typeof fits)[]).find((k) => fits[k]) ?? side;
    }
    let x: number, y: number;
    if (s === "right" || s === "left") {
      x = s === "right" ? rect.right + MARGIN : rect.left - MARGIN - tw;
      y = rect.top + rect.height / 2 - th / 2;
    } else {
      x = rect.left + rect.width / 2 - tw / 2;
      y = s === "top" ? rect.top - MARGIN - th : rect.bottom + MARGIN;
    }
    tip.style.left = `${Math.min(Math.max(x, MARGIN), vw - tw - MARGIN)}px`;
    tip.style.top = `${Math.min(Math.max(y, MARGIN), vh - th - MARGIN)}px`;
  }

  function position() {
    const step = steps[index];
    const els = stepEls(step);
    if (els.length === 0) return;
    const rect = unionRect(els);
    cutout.style.left = `${rect.left - PAD}px`;
    cutout.style.top = `${rect.top - PAD}px`;
    cutout.style.width = `${rect.width + PAD * 2}px`;
    cutout.style.height = `${rect.height + PAD * 2}px`;
    placeTip(rect, step.side);
  }

  function show(i: number, dir: 1 | -1 = 1) {
    // skip past steps whose targets vanished since the tour started
    while (i >= 0 && i < steps.length && stepEls(steps[i]).length === 0) i += dir;
    if (i < 0 || i >= steps.length) {
      end("completed");
      return;
    }
    index = i;
    const step = steps[i];
    const els = stepEls(step);
    els[0].scrollIntoView({ block: "nearest" });
    count.textContent = `${i + 1} / ${steps.length}`;
    title.textContent = step.title;
    body.innerHTML = step.body;
    backBtn.classList.toggle("hidden", i === 0);
    nextBtn.textContent = i === steps.length - 1 ? "finish ✓" : "next ►";
    position();
    observer?.disconnect();
    observer = new ResizeObserver(position);
    for (const el of els) observer.observe(el);
  }

  function end(reason: "completed" | "skipped") {
    if (!active) return;
    active = false;
    observer?.disconnect();
    window.removeEventListener("resize", position);
    window.removeEventListener("keydown", onKey, { capture: true });
    overlay.remove();
    store.getState().setTourOpen(false);
    track(reason === "completed" ? "tour-completed" : `tour-skipped-${index + 1}`);
  }

  function onKey(e: KeyboardEvent) {
    // the tour owns the keyboard: starve the app's window hotkeys
    e.stopPropagation();
    if (e.key === "Escape") end("skipped");
    else if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      show(index + 1);
    } else if (e.key === "ArrowLeft") show(index - 1, -1);
  }

  skipBtn.addEventListener("click", () => end("skipped"));
  backBtn.addEventListener("click", () => show(index - 1, -1));
  nextBtn.addEventListener("click", () => show(index + 1));
  window.addEventListener("resize", position);
  window.addEventListener("keydown", onKey, { capture: true });

  show(0);
}
