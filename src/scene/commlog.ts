/**
 * Comm chatter: a radio log strip that plays scripted lines at fractions of
 * the flight. Lines are queued by sim-time so scrubbing skips cleanly.
 */
import { BODY_BY_ID } from "../data/bodies";
import type { FlightPlan } from "../planner";

interface CommLine {
  /** when to fire, as fraction of travel time (0..1) */
  at: number;
  text: string;
}

function routeScript(plan: FlightPlan): CommLine[] {
  const dest = BODY_BY_ID.get(plan.destId)?.name ?? plan.destId;
  const origin = BODY_BY_ID.get(plan.originId)?.name ?? plan.originId;
  const heavy = plan.accelG > 2;
  return [
    { at: 0.001, text: `${origin} control: departure burn approved. Channel clear.` },
    ...(heavy
      ? [{ at: 0.004, text: "medical: juice administered. Try to breathe normal, sasa ke?" }]
      : []),
    { at: 0.03, text: `nav: on the wire for ${dest}. Drive nominal.` },
    { at: 0.25, text: "nav: quarter burn done. Coffee if you can lift the cup." },
    { at: 0.46, text: "nav: flip in a few. Stow everything, ke?" },
    { at: 0.485, text: "ALL HANDS: brace for flip. Drive going dark." },
    { at: 0.515, text: "nav: flip complete. Tail-first, braking burn lit." },
    { at: 0.75, text: `nav: three quarters. ${dest} traffic has our vector.` },
    { at: 0.96, text: `${dest} approach: slot confirmed, bring her in easy.` },
    { at: 0.999, text: "dock: clamps engaged. Welcome aboard, beratna." },
  ];
}

export class CommLog {
  private root: HTMLDivElement;
  private plan: FlightPlan | null = null;
  private script: CommLine[] = [];
  private fired = new Set<number>();
  private lastFrac = 0;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "comm-log";
    this.root.classList.add("hidden");
    container.appendChild(this.root);
  }

  /** Replace the script (used by scenarios like Epstein's flight). */
  setCustomScript(plan: FlightPlan, lines: CommLine[]) {
    this.plan = plan;
    this.script = lines;
    this.reset();
  }

  setPlan(plan: FlightPlan | null) {
    if (plan === this.plan) return;
    this.plan = plan;
    this.script = plan ? routeScript(plan) : [];
    this.reset();
  }

  private reset() {
    this.fired.clear();
    this.lastFrac = 0;
    this.root.innerHTML = "";
  }

  update(visible: boolean, timeMs: number) {
    this.root.classList.toggle("hidden", !visible || !this.plan);
    if (!visible || !this.plan) return;
    const frac =
      (timeMs - this.plan.depart.getTime()) / 1000 / this.plan.travelTimeSec;
    // scrubbed backwards: rebuild
    if (frac < this.lastFrac - 0.02) this.reset();
    this.lastFrac = frac;

    for (let i = 0; i < this.script.length; i++) {
      if (this.fired.has(i) || frac < this.script[i].at) continue;
      // don't spam lines that are long past (e.g. after a forward scrub)
      if (frac - this.script[i].at < 0.1) this.push(this.script[i].text);
      this.fired.add(i);
    }
  }

  private push(text: string) {
    const line = document.createElement("div");
    line.className = "comm-line";
    line.textContent = `▸ ${text}`;
    this.root.appendChild(line);
    while (this.root.children.length > 4) this.root.firstChild!.remove();
  }
}

export type { CommLine };
