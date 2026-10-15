import { Matrix3, Vector3 } from "three";
import type { BodyId } from "../data";
import type { BodyState } from "./bodyState";

/**
 * HD 80606 / HD 80607 wide binary (Struve 1341) in Ursa Major.
 *
 * Astrometry (Gaia / Wikipedia): proper motions, parallaxes, RVs, and
 * distances match the catalog inputs used for kinematics. ICRF coordinates
 * come from the same Gaia solution so the ~20.6″ sky separation is defined.
 *
 * Positions use the mean of the two catalog distances for both stars. The
 * 0.1 ly line-of-sight gap is smaller than differential-parallax noise and
 * would place the pair on an unbound hyperbolic relative orbit; a shared
 * distance recovers the observed plane-of-sky geometry (~1,200 AU projected).
 * Tangential speeds still use each star’s own distance with its μ and RV.
 */

export const HD80606_RA_HOURS = 9;
export const HD80606_RA_MINUTES = 22;
export const HD80606_RA_SECONDS = 37.5769;
export const HD80606_RA_DEG =
  HD80606_RA_HOURS * 15 + HD80606_RA_MINUTES / 4 + HD80606_RA_SECONDS / 240;
export const HD80606_DEC_DEG = 50 + 36 / 60 + 13.43 / 3600;

export const HD80607_RA_HOURS = 9;
export const HD80607_RA_MINUTES = 22;
export const HD80607_RA_SECONDS = 39.7369;
export const HD80607_RA_DEG =
  HD80607_RA_HOURS * 15 + HD80607_RA_MINUTES / 4 + HD80607_RA_SECONDS / 240;
export const HD80607_DEC_DEG = 50 + 36 / 60 + 13.945 / 3600;

/** Catalog distances (ly); mean used for sky-plane positions. */
export const HD80606_DISTANCE_LY = 215.4;
export const HD80607_DISTANCE_LY = 215.3;
/** Mass-weighted / mean system distance for UI + skybox. */
export const HD80606_SYSTEM_DISTANCE_LY =
  0.5 * (HD80606_DISTANCE_LY + HD80607_DISTANCE_LY);

const LY_M = 9.460_730_472_580_8e15;
const MAS_TO_RAD = Math.PI / (180 * 3_600_000);
const SECONDS_PER_YEAR = 365.25 * 86_400;
const HD80606_MASS_KG = 1.05 * 1.988_475e30;
const HD80607_MASS_KG = 1.0 * 1.988_475e30;

type AstrometricStar = {
  id: "hd80606" | "hd80607";
  raDeg: number;
  decDeg: number;
  distanceLy: number;
  /** Proper motion μ_α* (mas/yr). */
  pmRaMasYr: number;
  /** Proper motion μ_δ (mas/yr). */
  pmDecMasYr: number;
  /** Heliocentric radial velocity (km/s); positive = recession. */
  radialVelocityKms: number;
  massKg: number;
};

const HD80606_ASTROMETRY: AstrometricStar = {
  id: "hd80606",
  raDeg: HD80606_RA_DEG,
  decDeg: HD80606_DEC_DEG,
  distanceLy: HD80606_DISTANCE_LY,
  pmRaMasYr: 56.022,
  pmDecMasYr: 10.331,
  radialVelocityKms: 3.6,
  massKg: HD80606_MASS_KG,
};

const HD80607_ASTROMETRY: AstrometricStar = {
  id: "hd80607",
  raDeg: HD80607_RA_DEG,
  decDeg: HD80607_DEC_DEG,
  distanceLy: HD80607_DISTANCE_LY,
  pmRaMasYr: 52.656,
  pmDecMasYr: 9.938,
  radialVelocityKms: 3.3,
  massKg: HD80607_MASS_KG,
};

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function directionIcrf(raDeg: number, decDeg: number): Vector3 {
  const alpha = degToRad(raDeg);
  const delta = degToRad(decDeg);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}

/** Unit vector in ICRF from the Sun/Earth toward the binary barycenter. */
export function hd80606DirectionFromSolIcrf(): Vector3 {
  const m06 = HD80606_ASTROMETRY.massKg;
  const m07 = HD80607_ASTROMETRY.massKg;
  const d06 = directionIcrf(HD80606_RA_DEG, HD80606_DEC_DEG);
  const d07 = directionIcrf(HD80607_RA_DEG, HD80607_DEC_DEG);
  return d06
    .multiplyScalar(m06)
    .addScaledVector(d07, m07)
    .multiplyScalar(1 / (m06 + m07))
    .normalize();
}

function equatorialBasis(
  raDeg: number,
  decDeg: number,
): {
  los: Vector3;
  east: Vector3;
  north: Vector3;
} {
  const alpha = degToRad(raDeg);
  const delta = degToRad(decDeg);
  const los = directionIcrf(raDeg, decDeg);
  const east = new Vector3(-Math.sin(alpha), Math.cos(alpha), 0);
  const north = new Vector3(
    -Math.sin(delta) * Math.cos(alpha),
    -Math.sin(delta) * Math.sin(alpha),
    Math.cos(delta),
  );
  return { los, east, north };
}

function heliocentricStateIcrf(
  star: AstrometricStar,
  positionDistanceLy: number,
): { positionM: Vector3; velocityMS: Vector3; massKg: number } {
  const { los, east, north } = equatorialBasis(star.raDeg, star.decDeg);
  const positionM = los.clone().multiplyScalar(positionDistanceLy * LY_M);
  const distanceM = star.distanceLy * LY_M;
  const vEast = (distanceM * star.pmRaMasYr * MAS_TO_RAD) / SECONDS_PER_YEAR;
  const vNorth = (distanceM * star.pmDecMasYr * MAS_TO_RAD) / SECONDS_PER_YEAR;
  const vLos = star.radialVelocityKms * 1000;
  const velocityMS = new Vector3()
    .addScaledVector(east, vEast)
    .addScaledVector(north, vNorth)
    .addScaledVector(los, vLos);
  return { positionM, velocityMS, massKg: star.massKg };
}

type IcrfStarState = {
  id: "hd80606" | "hd80607";
  positionM: Vector3;
  velocityMS: Vector3;
  massKg: number;
};

/** COM-relative ICRF states from the catalog astrometry. */
export function hd80606BinaryStatesIcrf(): IcrfStarState[] {
  const meanLy = HD80606_SYSTEM_DISTANCE_LY;
  const raw = [
    heliocentricStateIcrf(HD80606_ASTROMETRY, meanLy),
    heliocentricStateIcrf(HD80607_ASTROMETRY, meanLy),
  ];
  const ids: Array<"hd80606" | "hd80607"> = ["hd80606", "hd80607"];
  let totalMass = 0;
  const comP = new Vector3();
  const comV = new Vector3();
  for (const star of raw) {
    totalMass += star.massKg;
    comP.addScaledVector(star.positionM, star.massKg);
    comV.addScaledVector(star.velocityMS, star.massKg);
  }
  comP.multiplyScalar(1 / totalMass);
  comV.multiplyScalar(1 / totalMass);

  return raw.map((star, i) => ({
    id: ids[i]!,
    positionM: star.positionM.clone().sub(comP),
    velocityMS: star.velocityMS.clone().sub(comV),
    massKg: star.massKg,
  }));
}

/**
 * Binary orbital angular-momentum direction in ICRF (HD 80606 relative to
 * HD 80607). Used as the system invariable pole so the pair orbits in scene XY.
 */
export function hd80606BinaryOrbitalPoleIcrf(): Vector3 {
  const [a, b] = hd80606BinaryStatesIcrf();
  if (!a || !b) return new Vector3(0, 0, 1);
  const r = a.positionM.clone().sub(b.positionM);
  const v = a.velocityMS.clone().sub(b.velocityMS);
  const h = new Vector3().crossVectors(r, v);
  if (h.lengthSq() < 1e-40) return new Vector3(0, 0, 1);
  h.normalize();
  // Prefer the northern ICRF hemisphere for a stable handedness.
  if (h.z < 0) h.multiplyScalar(-1);
  return h;
}

/**
 * Initial n-body states in the HD 80606 scene frame (barycenter at the origin).
 */
export function hd80606BinaryStatesInScene(
  icrfToScene: Matrix3,
): Partial<Record<BodyId, BodyState>> {
  const states: Partial<Record<BodyId, BodyState>> = {};
  for (const star of hd80606BinaryStatesIcrf()) {
    const positionM = star.positionM.clone().applyMatrix3(icrfToScene);
    const velocityMS = star.velocityMS.clone().applyMatrix3(icrfToScene);
    states[star.id] = {
      positionM: { x: positionM.x, y: positionM.y, z: positionM.z },
      velocityMS: { x: velocityMS.x, y: velocityMS.y, z: velocityMS.z },
    };
  }
  return states;
}

/**
 * Approximate binary orbital period from the astrometric two-body energy
 * (used for the sim-speed slider ceiling).
 */
export function hd80606BinaryPeriodSeconds(): number {
  const G = 6.674_3e-11;
  const [a, b] = hd80606BinaryStatesIcrf();
  if (!a || !b) return 86_400;
  const r = a.positionM.distanceTo(b.positionM);
  const v = a.velocityMS.clone().sub(b.velocityMS).length();
  const mu = G * (a.massKg + b.massKg);
  const energy = 0.5 * v * v - mu / r;
  if (!(energy < 0)) return 86_400;
  const semiMajor = -mu / (2 * energy);
  return 2 * Math.PI * Math.sqrt((semiMajor * semiMajor * semiMajor) / mu);
}
