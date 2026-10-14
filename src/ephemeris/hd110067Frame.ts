import { Vector3 } from "three";

/**
 * ICRF (J2000) coordinates of HD 110067 as seen from the Solar System.
 * Distance ≈ 105.09 ly (Coma Berenices).
 *
 * Scene orientation (invariable plane = XY) is built in `exoplanetFrame.ts`.
 */
export const HD110067_RA_HOURS = 12;
export const HD110067_RA_MINUTES = 39;
export const HD110067_RA_SECONDS = 21.50369;
/** Degrees, J2000. */
export const HD110067_RA_DEG =
  HD110067_RA_HOURS * 15 + HD110067_RA_MINUTES / 4 + HD110067_RA_SECONDS / 240;

export const HD110067_DEC_DEG = 20 + 1 / 60 + 40.036 / 3600;

/** Heliocentric distance (light-years); background parallax neglected for the EXR sky. */
export const HD110067_DISTANCE_LY = 105.09;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Unit vector in ICRF from the Sun/Earth toward HD 110067. */
export function hd110067DirectionFromSolIcrf(): Vector3 {
  const alpha = degToRad(HD110067_RA_DEG);
  const delta = degToRad(HD110067_DEC_DEG);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}
