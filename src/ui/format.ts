/** Number/date formatting for the planner card and map labels. */

const AU_KM = 149_597_870.7;

export function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  const s = Math.floor(sec % 60);
  return `${m}m ${s}s`;
}

export function fmtLag(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function fmtAu(km: number): string {
  const au = km / AU_KM;
  return au >= 10 ? `${au.toFixed(1)} AU` : `${au.toFixed(2)} AU`;
}

export function fmtVelocity(kmS: number): string {
  const c = kmS / 299_792.458;
  const kms =
    kmS >= 1000 ? `${(kmS / 1000).toFixed(1)}k km/s` : `${kmS.toFixed(0)} km/s`;
  return `${kms} (${(c * 100).toFixed(2)}% c)`;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${fmtDate(ms)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
