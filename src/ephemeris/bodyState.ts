/** Cartesian state in meters / meters per second (ICRF / J2000 when from SPK). */
export type BodyState = {
  positionM: { x: number; y: number; z: number };
  velocityMS: { x: number; y: number; z: number };
};
