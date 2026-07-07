/**
 * Feedback modal: message + optional reply email, POSTed to Web3Forms
 * (static site, no backend). GitHub issues as the failure fallback.
 */
import { track } from "../analytics";

// Public by design (Web3Forms keys are client-side safe).
// Get one free at https://web3forms.com — replace before deploying.
const WEB3FORMS_KEY = "ef760623-b640-4f7b-8ad5-001909717fa9";
const ENDPOINT = "https://api.web3forms.com/submit";
const ISSUES_URL = "https://github.com/skylercole/belter-charts/issues/new";

export function mountFeedback(app: HTMLElement, trigger: HTMLElement) {
  const modal = document.createElement("div");
  modal.id = "feedback-modal";
  modal.classList.add("hidden");
  modal.innerHTML = `
    <div class="about-box feedback-box">
      <button class="about-close">✕</button>
      <h2>Feedback</h2>
      <form id="feedback-form">
        <label>What's on your mind?
          <textarea name="message" rows="5" required
            placeholder="bugs, ideas, canon complaints…"></textarea>
        </label>
        <label>Email — optional, only if you want a reply
          <input type="email" name="email" placeholder="you@…" />
        </label>
        <input type="checkbox" name="botcheck" class="botcheck" tabindex="-1" autocomplete="off" />
        <p class="feedback-error hidden"></p>
        <button type="submit" class="primary">Send</button>
      </form>
      <p class="feedback-done hidden">Thanks — message received. ✔</p>
    </div>
  `;
  app.appendChild(modal);

  const form = modal.querySelector<HTMLFormElement>("#feedback-form")!;
  const errorEl = modal.querySelector<HTMLParagraphElement>(".feedback-error")!;
  const doneEl = modal.querySelector<HTMLParagraphElement>(".feedback-done")!;
  const submitBtn = form.querySelector<HTMLButtonElement>("button[type=submit]")!;

  const close = () => modal.classList.add("hidden");
  trigger.addEventListener("click", () => {
    modal.classList.remove("hidden");
    form.classList.remove("hidden");
    doneEl.classList.add("hidden");
    track("feedback-opened");
  });
  modal.querySelector(".about-close")!.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    const data = new FormData(form);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: "Belter Charts feedback",
          message: data.get("message"),
          email: data.get("email") || undefined,
          botcheck: data.get("botcheck"),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      form.reset();
      form.classList.add("hidden");
      doneEl.classList.remove("hidden");
      track("feedback-sent");
      setTimeout(close, 2000);
    } catch {
      errorEl.innerHTML = `Couldn't send — try again, or
        <a href="${ISSUES_URL}" target="_blank" rel="noopener">open an issue on GitHub</a>.`;
      errorEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send";
    }
  });
}
