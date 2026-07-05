declare global {
  interface Window {
    goatcounter?: {
      count: (opts: { path: string; title?: string; event?: boolean }) => void;
    };
  }
}

/** Fire a GoatCounter custom event. No-op if count.js is blocked or not yet loaded. */
export function track(path: string): void {
  window.goatcounter?.count({ path, event: true });
}
