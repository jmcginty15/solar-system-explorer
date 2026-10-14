import { Vector3 } from "three";

/**
 * ICRF (J2000) coordinates of Kepler-90 as seen from the Solar System.
 * Distance ≈ 2790 ly (Draco).
 *
 * Scene orientation (invariable plane = XY) is built in `exoplanetFrame.ts`.
 */
export const KEPLER90_RA_HOURS = 18;
export const KEPLER90_RA_MINUTES = 57;
export const KEPLER90_RA_SECONDS = 44.0383126392;
/** Degrees, J2000. */
export const KEPLER90_RA_DEG =
  KEPLER90_RA_HOURS * 15 + KEPLER90_RA_MINUTES / 4 + KEPLER90_RA_SECONDS / 240;

export const KEPLER90_DEC_DEG = 49 + 18 / 60 + 18.496454184 / 3600;

/** Heliocentric distance (light-years); background parallax neglected for the EXR sky. */
export const KEPLER90_DISTANCE_LY = 2790;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Unit vector in ICRF from the Sun/Earth toward Kepler-90. */
export function kepler90DirectionFromSolIcrf(): Vector3 {
  const alpha = degToRad(KEPLER90_RA_DEG);
  const delta = degToRad(KEPLER90_DEC_DEG);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}
