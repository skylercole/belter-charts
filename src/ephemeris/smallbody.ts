/**
 * Reader for packed small-body ephemeris files (.fnb) produced by
 * tools/fetch-horizons.ts.
 *
 * Layout (little-endian):
 *   0  u8[4]   magic "FNB1"
 *   4  f64     JD TDB of first sample
 *   12 f64     step in days
 *   20 u32     sample count
 *   24 f32[n*6] per sample: x, y, z (km), vx, vy, vz (km/s)
 *
 * Frame: heliocentric ecliptic J2000.
 *
 * Interpolation: cubic Hermite per component. Positions and velocities at
 * segment endpoints give exact C1 interpolation; with daily samples the
 * truncation error is far below the 0.1% acceptance band (verified in tests
 * against off-grid Horizons spot checks).
 */
import type { Vec3 } from "./vec";
import { dateToJd } from "./time";

export interface StateVector {
  pos: Vec3; // km
  vel: Vec3; // km/s
}

const HEADER_BYTES = 24;
const FLOATS_PER_SAMPLE = 6;

export class SmallBodyEphemeris {
  readonly jdStart: number;
  readonly stepDays: number;
  readonly count: number;
  private readonly data: Float32Array;

  constructor(buf: ArrayBuffer) {
    const view = new DataView(buf);
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    if (magic !== "FNB1") {
      throw new Error(`bad ephemeris file magic: ${magic}`);
    }
    this.jdStart = view.getFloat64(4, true);
    this.stepDays = view.getFloat64(12, true);
    this.count = view.getUint32(20, true);
    const expected = HEADER_BYTES + this.count * FLOATS_PER_SAMPLE * 4;
    if (buf.byteLength !== expected) {
      throw new Error(`ephemeris file size ${buf.byteLength}, expected ${expected}`);
    }
    this.data = new Float32Array(buf, HEADER_BYTES, this.count * FLOATS_PER_SAMPLE);
  }

  get jdEnd(): number {
    return this.jdStart + (this.count - 1) * this.stepDays;
  }

  covers(jd: number): boolean {
    return jd >= this.jdStart && jd <= this.jdEnd;
  }

  stateAtJd(jd: number): StateVector {
    if (!this.covers(jd)) {
      throw new RangeError(
        `JD ${jd} outside ephemeris range [${this.jdStart}, ${this.jdEnd}]`
      );
    }
    const u = (jd - this.jdStart) / this.stepDays;
    let i = Math.floor(u);
    if (i >= this.count - 1) i = this.count - 2; // jd exactly at end
    const t = u - i;

    const dtSec = this.stepDays * 86_400;
    const a = i * FLOATS_PER_SAMPLE;
    const b = (i + 1) * FLOATS_PER_SAMPLE;
    const d = this.data;

    // Hermite basis
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    // Derivatives of the basis w.r.t. t, for velocity output.
    const g00 = 6 * t2 - 6 * t;
    const g10 = 3 * t2 - 4 * t + 1;
    const g01 = -6 * t2 + 6 * t;
    const g11 = 3 * t2 - 2 * t;

    const pos = { x: 0, y: 0, z: 0 };
    const vel = { x: 0, y: 0, z: 0 };
    const axes: (keyof Vec3)[] = ["x", "y", "z"];
    for (let k = 0; k < 3; k++) {
      const p0 = d[a + k];
      const p1 = d[b + k];
      const v0 = d[a + 3 + k] * dtSec; // km per segment
      const v1 = d[b + 3 + k] * dtSec;
      pos[axes[k]] = h00 * p0 + h10 * v0 + h01 * p1 + h11 * v1;
      vel[axes[k]] = (g00 * p0 + g10 * v0 + g01 * p1 + g11 * v1) / dtSec;
    }
    return { pos, vel };
  }

  stateAt(date: Date): StateVector {
    return this.stateAtJd(dateToJd(date));
  }
}

export async function loadSmallBody(url: string): Promise<SmallBodyEphemeris> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: HTTP ${res.status}`);
  return new SmallBodyEphemeris(await res.arrayBuffer());
}
