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

export function getSpoilerLevel(): number {
  return Number(localStorage.getItem(SPOILER_KEY) ?? "1");
}

export function setSpoilerLevel(level: number): void {
  localStorage.setItem(SPOILER_KEY, String(level));
}
