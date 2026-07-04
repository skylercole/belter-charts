/**
 * Runtime-painted equirect textures for moons with no cleanly-licensed map:
 * Io, Europa, Ganymede, Callisto, Titan. Stylized original art evoking the
 * real bodies (Io's sulfur blotches, Europa's lineae, Ganymede's terrain
 * patches, Callisto's bright speckle, Titan's haze bands). 1024x512 canvas,
 * generated once per session, seeded and deterministic.
 */
import * as THREE from "three";

const W = 1024;
const H = 512;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Painter = (ctx: CanvasRenderingContext2D, r: () => number) => void;

function blotches(
  ctx: CanvasRenderingContext2D,
  r: () => number,
  n: number,
  colors: string[],
  rMin: number,
  rMax: number,
  alpha: number
) {
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = H * (0.08 + 0.84 * r());
    const rad = rMin + r() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const c = colors[Math.floor(r() * colors.length)];
    g.addColorStop(0, c);
    g.addColorStop(1, "transparent");
    ctx.globalAlpha = alpha * (0.5 + r() * 0.5);
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    // wrap horizontally
    if (x - rad < 0) ctx.fillRect(x - rad + W, y - rad, rad * 2, rad * 2);
    if (x + rad > W) ctx.fillRect(x - rad - W, y - rad, rad * 2, rad * 2);
  }
  ctx.globalAlpha = 1;
}

const PAINTERS: Record<string, Painter> = {
  io(ctx, r) {
    ctx.fillStyle = "#d3bd62";
    ctx.fillRect(0, 0, W, H);
    blotches(ctx, r, 90, ["#e8d98a", "#c9a83e", "#b8933a"], 20, 90, 0.5);
    blotches(ctx, r, 40, ["#a8542a", "#8a3c22", "#c96a30"], 8, 40, 0.55); // volcanic rings
    blotches(ctx, r, 30, ["#f2ead0", "#e8e2c8"], 10, 50, 0.5); // SO2 frost
    // dark eruption dots
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = "rgba(40,26,16,0.75)";
      const x = r() * W;
      const y = H * (0.12 + 0.76 * r());
      ctx.beginPath();
      ctx.arc(x, y, 2 + r() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // polar darkening
    const pol = ctx.createLinearGradient(0, 0, 0, H);
    pol.addColorStop(0, "rgba(120,80,40,0.45)");
    pol.addColorStop(0.25, "transparent");
    pol.addColorStop(0.75, "transparent");
    pol.addColorStop(1, "rgba(120,80,40,0.45)");
    ctx.fillStyle = pol;
    ctx.fillRect(0, 0, W, H);
  },

  europa(ctx, r) {
    ctx.fillStyle = "#ded6c6";
    ctx.fillRect(0, 0, W, H);
    blotches(ctx, r, 50, ["#e8e2d6", "#cfc4ae"], 30, 110, 0.4);
    // lineae: long thin brown arcs
    ctx.lineCap = "round";
    for (let i = 0; i < 46; i++) {
      const x0 = r() * W;
      const y0 = r() * H;
      const len = 120 + r() * 420;
      const ang = r() * Math.PI;
      const bend = (r() - 0.5) * 0.9;
      ctx.strokeStyle = `rgba(${120 + r() * 40},${70 + r() * 30},${40 + r() * 25},${0.25 + r() * 0.3})`;
      ctx.lineWidth = 1 + r() * 2.5;
      ctx.beginPath();
      for (let s = 0; s <= 1.001; s += 0.1) {
        const a = ang + bend * s;
        const x = x0 + Math.cos(a) * len * s;
        const y = y0 + Math.sin(a) * len * s * 0.4;
        s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  },

  ganymede(ctx, r) {
    ctx.fillStyle = "#8d8577";
    ctx.fillRect(0, 0, W, H);
    // dark ancient terrain patches vs bright grooved terrain
    blotches(ctx, r, 26, ["#6a6154", "#5d564c"], 60, 170, 0.55);
    blotches(ctx, r, 30, ["#a9a294", "#b8b2a4"], 40, 120, 0.45);
    // bright young craters
    for (let i = 0; i < 60; i++) {
      const x = r() * W;
      const y = H * (0.06 + 0.88 * r());
      const rad = 1.5 + r() * 4;
      ctx.fillStyle = `rgba(235,232,224,${0.3 + r() * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  callisto(ctx, r) {
    ctx.fillStyle = "#655d52";
    ctx.fillRect(0, 0, W, H);
    blotches(ctx, r, 34, ["#585148", "#6e675c"], 40, 130, 0.5);
    // dense bright impact speckle - Callisto is saturated with craters
    for (let i = 0; i < 240; i++) {
      const x = r() * W;
      const y = H * (0.04 + 0.92 * r());
      const rad = 1 + r() * 3.5;
      ctx.fillStyle = `rgba(210,202,188,${0.2 + r() * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    // Valhalla-style big bright basin with faint rings
    const bx = W * 0.3;
    const by = H * 0.45;
    for (let k = 0; k < 4; k++) {
      ctx.strokeStyle = `rgba(200,190,175,${0.28 - k * 0.055})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(bx, by, 24 + k * 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(215,205,190,0.5)";
    ctx.beginPath();
    ctx.arc(bx, by, 20, 0, Math.PI * 2);
    ctx.fill();
  },

  titan(ctx, r) {
    // featureless haze: soft latitudinal bands, nothing sharp
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#b57f38");
    g.addColorStop(0.3, "#d8a558");
    g.addColorStop(0.55, "#e0b068");
    g.addColorStop(0.8, "#cf9c50");
    g.addColorStop(1, "#a87434");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const y = r() * H;
      const h = 3 + r() * 16;
      ctx.fillStyle = `rgba(${200 + r() * 30},${140 + r() * 30},${70 + r() * 25},0.12)`;
      ctx.fillRect(0, y, W, h);
    }
  },
};

const cache = new Map<string, THREE.Texture>();

export function proceduralTexture(id: string): THREE.Texture | null {
  const painter = PAINTERS[id];
  if (!painter) return null;
  const cached = cache.get(id);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  painter(ctx, rng(id.length * 2654435761 + id.charCodeAt(0)));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(id, tex);
  return tex;
}

/** ids that have painters */
export function hasProceduralTexture(id: string): boolean {
  return id in PAINTERS;
}

let regolith: THREE.Texture | null = null;
/**
 * Tiling gray regolith speckle, multiplied under rock vertex colors for
 * close-up surface detail.
 */
export function regolithTexture(): THREE.Texture {
  if (regolith) return regolith;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#b9b9b9";
  ctx.fillRect(0, 0, S, S);
  const r = rng(1337);
  for (let i = 0; i < 14000; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 0.5 + r() * 1.8;
    const l = 120 + r() * 150;
    ctx.fillStyle = `rgba(${l},${l},${l},${0.25 + r() * 0.4})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // a few larger soft patches
  for (let i = 0; i < 120; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 6 + r() * 22;
    const l = 150 + r() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${l},${l},${l},0.18)`);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  regolith = new THREE.CanvasTexture(c);
  regolith.wrapS = regolith.wrapT = THREE.RepeatWrapping;
  regolith.repeat.set(8, 4);
  regolith.colorSpace = THREE.SRGBColorSpace;
  regolith.anisotropy = 4;
  return regolith;
}
