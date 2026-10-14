import { Vector3 } from "three";

/**
 * ICRF (J2000) coordinates of HD 10180 as seen from the Solar System.
 * Distance ≈ 127.1 ly (Hydrus).
 *
 * Scene orientation (invariable plane = XY) is built in `exoplanetFrame.ts`.
 */
export const HD10180_RA_HOURS = 1;
export const HD10180_RA_MINUTES = 37;
export const HD10180_RA_SECONDS = 53.57724;
/** Degrees, J2000. */
export const HD10180_RA_DEG =
  HD10180_RA_HOURS * 15 + HD10180_RA_MINUTES / 4 + HD10180_RA_SECONDS / 240;

export const HD10180_DEC_DEG = -(60 + 30 / 60 + 41.4821 / 3600);

/** Heliocentric distance (light-years); background parallax neglected for the EXR sky. */
export const HD10180_DISTANCE_LY = 127.1;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Unit vector in ICRF from the Sun/Earth toward HD 10180. */
export function hd10180DirectionFromSolIcrf(): Vector3 {
  const alpha = degToRad(HD10180_RA_DEG);
  const delta = degToRad(HD10180_DEC_DEG);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}
