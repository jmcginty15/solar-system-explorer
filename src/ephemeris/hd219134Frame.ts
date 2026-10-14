import { Vector3 } from "three";

/**
 * ICRF (J2000) coordinates of HD 219134 as seen from the Solar System.
 * Distance ≈ 21.34 ly (Cassiopeia).
 *
 * Scene orientation (invariable plane = XY) is built in `exoplanetFrame.ts`.
 */
export const HD219134_RA_HOURS = 23;
export const HD219134_RA_MINUTES = 13;
export const HD219134_RA_SECONDS = 16.97496;
/** Degrees, J2000. */
export const HD219134_RA_DEG =
  HD219134_RA_HOURS * 15 + HD219134_RA_MINUTES / 4 + HD219134_RA_SECONDS / 240;

export const HD219134_DEC_DEG = 57 + 10 / 60 + 6.0838 / 3600;

/** Heliocentric distance (light-years); background parallax neglected for the EXR sky. */
export const HD219134_DISTANCE_LY = 21.336;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Unit vector in ICRF from the Sun/Earth toward HD 219134. */
export function hd219134DirectionFromSolIcrf(): Vector3 {
  const alpha = degToRad(HD219134_RA_DEG);
  const delta = degToRad(HD219134_DEC_DEG);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}
