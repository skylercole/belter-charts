/**
 * About panel: unofficial disclaimer, the honesty-toggle story, and
 * CREDITS.md rendered inline. Opened from the panel footer or "?".
 */
import credits from "../../CREDITS.md?raw";

const GITHUB_URL = ""; // fill in when the repo goes public

/** minimal markdown: #/## headers, - lists, **bold**, bare links */
function mdToHtml(md: string): string {
  const esc = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = esc.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    if (inList) {
      html += "</ul>";
      inList = false;
    }
    if (line.startsWith("## ")) html += `<h4>${inline(line.slice(3))}</h4>`;
    else if (line.startsWith("# ")) html += `<h3>${inline(line.slice(2))}</h3>`;
    else if (line.trim() === "") html += "";
    else html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(
      /(https?:\/\/[^\s)]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );
}

export function mountAbout(app: HTMLElement, panelRoot: HTMLElement) {
  const btn = document.createElement("button");
  btn.className = "ghost";
  btn.id = "about-btn";
  btn.textContent = "ⓘ about & credits";
  panelRoot.appendChild(btn);

  const modal = document.createElement("div");
  modal.id = "about-modal";
  modal.classList.add("hidden");
  modal.innerHTML = `
    <div class="about-box">
      <button class="about-close">✕</button>
      <h2>Belter Charts</h2>
      <p class="about-disclaimer">
        An <b>unofficial, non-commercial fan project</b>. Not affiliated with,
        endorsed by, or connected to James S. A. Corey, Orbit Books, Alcon
        Entertainment, or Amazon Studios. Book-derived names are used
        nominatively. If you hold rights and object to anything here, it
        comes down fast.
      </p>
      <p>
        Real ephemerides (JPL Horizons, astronomy-engine), canon locations,
        brachistochrone flight planning. The <b>honest physics / canon feel</b>
        toggle exists because the books' stated drive accelerations produce
        trips about 10x faster than the books narrate — pick your truth and
        argue in the comments.
      </p>
      ${GITHUB_URL ? `<p><a href="${GITHUB_URL}" target="_blank" rel="noopener">Source on GitHub</a></p>` : ""}
      <div class="about-credits">${mdToHtml(credits)}</div>
    </div>
  `;
  app.appendChild(modal);

  const close = () => modal.classList.add("hidden");
  btn.addEventListener("click", () => modal.classList.remove("hidden"));
  modal.querySelector(".about-close")!.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
