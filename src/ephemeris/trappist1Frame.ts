import { Vector3 } from "three";

/**
 * ICRF (J2000) coordinates of TRAPPIST-1 as seen from the Solar System.
 * Distance ≈ 40.66 ly (Aquarius).
 *
 * Scene orientation (invariable plane = XY) is built in `exoplanetFrame.ts`.
 */
export const TRAPPIST1_RA_HOURS = 23;
export const TRAPPIST1_RA_MINUTES = 6;
export const TRAPPIST1_RA_SECONDS = 29.368;
/** Degrees, J2000. */
export const TRAPPIST1_RA_DEG =
  TRAPPIST1_RA_HOURS * 15 +
  TRAPPIST1_RA_MINUTES / 4 +
  TRAPPIST1_RA_SECONDS / 240;

export const TRAPPIST1_DEC_DEG = -(5 + 2 / 60 + 29.04 / 3600);

/** Heliocentric distance (light-years); background parallax neglected for the EXR sky. */
export const TRAPPIST1_DISTANCE_LY = 40.66;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Unit vector in ICRF from the Sun/Earth toward TRAPPIST-1. */
export function trappist1DirectionFromSolIcrf(): Vector3 {
  const alpha = degToRad(TRAPPIST1_RA_DEG);
  const delta = degToRad(TRAPPIST1_DEC_DEG);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}
