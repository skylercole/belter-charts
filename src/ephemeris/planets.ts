/**
 * Planet (and Sun/Moon-capable) state vectors via astronomy-engine.
 * Output frame matches the packed small-body files: heliocentric ecliptic
 * J2000, km, km/s.
 */
import {
  Body,
  HelioState,
  KM_PER_AU,
  Rotation_EQJ_ECL,
} from "astronomy-engine";
import type { StateVector } from "./smallbody";

const KM_PER_AU_PER_DAY = KM_PER_AU / 86_400; // AU/day -> km/s

// Rotation from J2000 equatorial to J2000 ecliptic; constant matrix.
const R = Rotation_EQJ_ECL().rot;

function rotate(x: number, y: number, z: number) {
  return {
    x: R[0][0] * x + R[1][0] * y + R[2][0] * z,
    y: R[0][1] * x + R[1][1] * y + R[2][1] * z,
    z: R[0][2] * x + R[1][2] * y + R[2][2] * z,
  };
}

export type PlanetName =
  | "mercury"
  | "venus"
  | "earth"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune";

const BODY_MAP: Record<PlanetName, Body> = {
  mercury: Body.Mercury,
  venus: Body.Venus,
  earth: Body.Earth,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
};

export function planetState(name: PlanetName, date: Date): StateVector {
  const s = HelioState(BODY_MAP[name], date);
  const pos = rotate(s.x * KM_PER_AU, s.y * KM_PER_AU, s.z * KM_PER_AU);
  const vel = rotate(
    s.vx * KM_PER_AU_PER_DAY,
    s.vy * KM_PER_AU_PER_DAY,
    s.vz * KM_PER_AU_PER_DAY
  );
  return { pos, vel };
}
