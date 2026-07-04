/**
 * Nav rail: grouped body list on the right edge for one-click flying, plus
 * a system-view button. Highlight tracks the scene's current focus.
 */
import { BODIES } from "../data/bodies";

export interface NavRailHooks {
  onSelect(id: string): void;
  onHome(): void;
  /** current focus id, polled for highlighting */
  current(): string;
}

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "inner", ids: ["mercury", "venus", "earth", "luna", "mars"] },
  {
    title: "belt",
    ids: ["ceres", "eros", "vesta", "pallas", "hygiea", "juno", "tycho", "anderson"],
  },
  { title: "outer", ids: ["jupiter", "saturn", "uranus", "neptune"] },
  {
    title: "moons",
    ids: ["io", "europa", "ganymede", "callisto", "titan", "phoebe"],
  },
];

export function mountNavRail(container: HTMLElement, hooks: NavRailHooks) {
  const byId = new Map(BODIES.map((b) => [b.id, b]));
  const root = document.createElement("nav");
  root.id = "nav-rail";
  root.innerHTML = `
    <button class="nav-home" title="whole-system view (H)">⌂ system</button>
    ${GROUPS.map(
      (g) => `
      <div class="nav-group">
        <div class="nav-group-title">${g.title}</div>
        ${g.ids
          .map((id) => {
            const b = byId.get(id)!;
            return `<button class="nav-body" data-id="${id}" title="focus ${b.name}">
              <span class="nav-dot" style="background:${b.color}"></span>${b.name.replace(" Station", "")}
            </button>`;
          })
          .join("")}
      </div>`
    ).join("")}
  `;
  container.appendChild(root);

  root.querySelector(".nav-home")!.addEventListener("click", hooks.onHome);
  root.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".nav-body");
    if (btn) hooks.onSelect(btn.dataset.id!);
  });

  const buttons = [...root.querySelectorAll<HTMLButtonElement>(".nav-body")];
  setInterval(() => {
    const cur = hooks.current();
    for (const b of buttons) b.classList.toggle("active", b.dataset.id === cur);
  }, 300);
}
