/**
 * Spoiler gate shared by the events UI and the stories menu: "I have read
 * up to book N" persists in localStorage; anything above N stays hidden.
 */

const SPOILER_KEY = "fnb-spoiler-book";

export const BOOKS = [
  "Leviathan Wakes",
  "Caliban's War",
  "Abaddon's Gate",
  "Cibola Burn",
  "Nemesis Games",
  "Babylon's Ashes",
];

/* The store reads the level at module init, which also runs under vitest's
 * node environment — hence the localStorage existence checks. */

export function getSpoilerLevel(): number {
  if (typeof localStorage === "undefined") return 1;
  return Number(localStorage.getItem(SPOILER_KEY) ?? "1");
}

export function setSpoilerLevel(level: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SPOILER_KEY, String(level));
}
