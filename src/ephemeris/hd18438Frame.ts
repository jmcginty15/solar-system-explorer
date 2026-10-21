import { Vector3 } from "three";

/**
 * ICRF (J2000) coordinates of HD 18438 as seen from the Solar System.
 * Distance ≈ 734 ly (Camelopardalis); Gaia DR2 parallax 4.443 mas.
 *
 * Scene orientation (invariable plane = XY) is built in `exoplanetFrame.ts`.
 */
export const HD18438_RA_HOURS = 3;
export const HD18438_RA_MINUTES = 6;
export const HD18438_RA_SECONDS = 7.84053;
/** Degrees, J2000. */
export const HD18438_RA_DEG =
  HD18438_RA_HOURS * 15 + HD18438_RA_MINUTES / 4 + HD18438_RA_SECONDS / 240;

export const HD18438_DEC_DEG = 79 + 25 / 60 + 6.727 / 3600;

/** Heliocentric distance (light-years); background parallax neglected for the EXR sky. */
export const HD18438_DISTANCE_LY = 734.09;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Unit vector in ICRF from the Sun/Earth toward HD 18438. */
export function hd18438DirectionFromSolIcrf(): Vector3 {
  const alpha = degToRad(HD18438_RA_DEG);
  const delta = degToRad(HD18438_DEC_DEG);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}
