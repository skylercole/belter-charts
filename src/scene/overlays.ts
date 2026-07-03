/**
 * Full-screen ride overlays: g-force vignette (grey-out), JUICE banner,
 * BRACE-FOR-FLIP banner, and the Epstein epitaph card. Pure DOM/CSS.
 */
export class RideOverlays {
  private vignette: HTMLDivElement;
  private banner: HTMLDivElement;
  private epitaph: HTMLDivElement;
  private bannerTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.vignette = document.createElement("div");
    this.vignette.id = "g-vignette";
    this.banner = document.createElement("div");
    this.banner.id = "ride-banner";
    this.banner.classList.add("hidden");
    this.epitaph = document.createElement("div");
    this.epitaph.id = "epitaph";
    this.epitaph.classList.add("hidden");
    container.append(this.vignette, this.banner, this.epitaph);
  }

  /** Grey-out intensity from sustained g (0 below 1.5 g, heavy at 10+). */
  setG(g: number, thrusting: boolean) {
    const x = thrusting ? Math.min(Math.max((g - 1.5) / 9, 0), 0.85) : 0;
    this.vignette.style.opacity = String(x);
  }

  flash(text: string, cls: "juice" | "brace" | "info", ms = 2200) {
    this.banner.textContent = text;
    this.banner.className = cls; // resets hidden
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.classList.add("hidden");
    }, ms);
  }

  showEpitaph(html: string, onClose: () => void) {
    this.epitaph.innerHTML = `${html}<button id="epitaph-close">return to the system</button>`;
    this.epitaph.classList.remove("hidden");
    this.epitaph.querySelector("#epitaph-close")!.addEventListener(
      "click",
      () => {
        this.hideEpitaph();
        onClose();
      },
      { once: true }
    );
  }

  hideEpitaph() {
    this.epitaph.classList.add("hidden");
  }
}
