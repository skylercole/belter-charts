/**
 * Mobile gate: the app needs more room than a phone screen gives, so
 * viewports narrower than MIN_APP_WIDTH get a branded notice instead
 * of the app. Boot never runs behind it — no ephemeris fetch, no WebGL.
 */
import { track } from "../analytics";

export const MIN_APP_WIDTH = 768;

export function isViewportGated(): boolean {
  return window.innerWidth < MIN_APP_WIDTH;
}

/**
 * Mounts the full-screen gate. Calls onUngate exactly once if the
 * viewport grows to >= MIN_APP_WIDTH (window resize or device rotation).
 */
export function mountMobileGate(onUngate: () => void) {
  const gate = document.createElement("div");
  gate.id = "mobile-gate";
  gate.innerHTML = `
    <div class="gate-box">
      <svg class="gate-logo" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2.2" fill="#ffd27d"/>
        <ellipse cx="8" cy="8" rx="7" ry="2.8" fill="none" stroke="#7fd4a8" stroke-width="1"/>
      </svg>
      <h1>Belter Charts</h1>
      <p class="gate-sub">unofficial Expanse navigator</p>
      <p class="gate-msg">
        Belter Charts is designed for desktop. Plotting trajectories
        across the system needs a full bridge console &mdash; more room
        than this screen can give.
      </p>
      <p class="gate-hint">
        Come back on a display at least 768&nbsp;px wide, or rotate a
        tablet to landscape.
      </p>
    </div>
  `;
  document.body.appendChild(gate);
  track("mobile-gated");

  const mq = window.matchMedia(`(min-width: ${MIN_APP_WIDTH}px)`);
  const onChange = (e: MediaQueryListEvent) => {
    if (!e.matches) return;
    mq.removeEventListener("change", onChange);
    gate.remove();
    onUngate();
  };
  mq.addEventListener("change", onChange);
}
