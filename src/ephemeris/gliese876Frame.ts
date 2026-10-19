import { Vector3 } from "three";

/**
 * ICRF (J2000) coordinates of Gliese 876 as seen from the Solar System.
 * Distance ≈ 15.24 ly (Aquarius).
 *
 * Scene orientation (invariable plane = XY) is built in `exoplanetFrame.ts`.
 */
export const GLIESE876_RA_HOURS = 22;
export const GLIESE876_RA_MINUTES = 53;
export const GLIESE876_RA_SECONDS = 16.73258;
/** Degrees, J2000. */
export const GLIESE876_RA_DEG =
  GLIESE876_RA_HOURS * 15 +
  GLIESE876_RA_MINUTES / 4 +
  GLIESE876_RA_SECONDS / 240;

export const GLIESE876_DEC_DEG = -(14 + 15 / 60 + 49.3041 / 3600);

/** Heliocentric distance (light-years); background parallax neglected for the EXR sky. */
export const GLIESE876_DISTANCE_LY = 15.238;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Unit vector in ICRF from the Sun/Earth toward Gliese 876. */
export function gliese876DirectionFromSolIcrf(): Vector3 {
  const alpha = degToRad(GLIESE876_RA_DEG);
  const delta = degToRad(GLIESE876_DEC_DEG);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}
