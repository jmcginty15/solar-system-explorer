/**
 * Kepler-16 A/B eclipsing binary (Cygnus).
 *
 * Relative Keplerian elements (Doyle et al. / Wikipedia): secondary about the
 * primary, then split about the mutual barycenter so COM = scene origin.
 * Scene XY is the binary invariable plane (see `exoplanetFrame.ts`).
 */
import { Matrix3, Vector3 } from "three";
import type { BodyId } from "../data";
import { G } from "../simulation/nbody";
import {
  classicalElementsToState,
  type ClassicalOrbitalElements,
} from "../simulation/orbitalElements";
import { meanToTrueAnomaly } from "../simulation/keplerAnomalies";
import type { BodyState } from "./bodyState";
import { AU_M } from "./errorReport";

export const KEPLER16_RA_HOURS = 19;
export const KEPLER16_RA_MINUTES = 16;
export const KEPLER16_RA_SECONDS = 18.1759;
/** Degrees, J2000. */
export const KEPLER16_RA_DEG =
  KEPLER16_RA_HOURS * 15 + KEPLER16_RA_MINUTES / 4 + KEPLER16_RA_SECONDS / 240;

export const KEPLER16_DEC_DEG = 51 + 45 / 60 + 26.778 / 3600;

/** Heliocentric distance (light-years). */
export const KEPLER16_DISTANCE_LY = 245.4;

const M_SUN_KG = 1.988_475e30;
const SECONDS_PER_DAY = 86_400;
const TWO_PI = 2 * Math.PI;

export const KEPLER16A_MASS_KG = 0.704 * M_SUN_KG;
export const KEPLER16B_MASS_KG = 0.2054 * M_SUN_KG;

/** Relative semimajor axis (secondary about primary). */
export const KEPLER16_REL_SMA_M = 0.2257 * AU_M;
export const KEPLER16_ECCENTRICITY = 0.15962;
export const KEPLER16_INCLINATION_DEG = 90.30401;
export const KEPLER16_RAAN_DEG = 0;
/** Argument of periastron of the secondary (deg). */
export const KEPLER16_ARG_PERIAPSIS_SECONDARY_DEG = 263.67;
/**
 * Periastron epoch of the secondary (BJD ≈ JD for our clock).
 * Wikipedia / Doyle et al. ephemeris.
 */
export const KEPLER16_PERIASTRON_JD = 2_457_573.0995;

/** Sidereal period from Kepler’s law with catalog masses + a. */
export function kepler16BinaryPeriodSeconds(): number {
  const mu = G * (KEPLER16A_MASS_KG + KEPLER16B_MASS_KG);
  const a = KEPLER16_REL_SMA_M;
  return TWO_PI * Math.sqrt((a * a * a) / mu);
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function wrapTwoPi(angleRad: number): number {
  const a = angleRad % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/** Unit vector in ICRF from the Sun/Earth toward Kepler-16. */
export function kepler16DirectionFromSolIcrf(): Vector3 {
  const alpha = degToRad(KEPLER16_RA_DEG);
  const delta = degToRad(KEPLER16_DEC_DEG);
  const cosD = Math.cos(delta);
  return new Vector3(
    cosD * Math.cos(alpha),
    cosD * Math.sin(alpha),
    Math.sin(delta),
  );
}

/**
 * Sky-plane orbital pole of the relative binary (ICRF), used as the system
 * invariable north so the pair orbits in scene XY.
 */
export function kepler16BinaryOrbitalPoleIcrf(): Vector3 {
  // Inline sky basis (avoid importing exoplanetFrame — circular with this file).
  const direction = kepler16DirectionFromSolIcrf();
  const zSky = direction.clone().multiplyScalar(-1).normalize();
  const icrfNorth = new Vector3(0, 0, 1);
  let xSky = icrfNorth.clone().addScaledVector(zSky, -icrfNorth.dot(zSky));
  if (xSky.lengthSq() < 1e-12) {
    xSky = new Vector3(1, 0, 0).addScaledVector(zSky, -zSky.x).normalize();
  } else {
    xSky.normalize();
  }
  const ySky = new Vector3().crossVectors(zSky, xSky).normalize();

  const i = degToRad(KEPLER16_INCLINATION_DEG);
  const O = degToRad(KEPLER16_RAAN_DEG);
  const pole = new Vector3()
    .addScaledVector(xSky, Math.sin(i) * Math.sin(O))
    .addScaledVector(ySky, -Math.sin(i) * Math.cos(O))
    .addScaledVector(zSky, Math.cos(i))
    .normalize();

  const towardObserver = zSky;
  if (Math.abs(pole.dot(towardObserver)) > 0.2) {
    if (pole.dot(towardObserver) < 0) pole.multiplyScalar(-1);
  } else if (pole.z < 0) {
    pole.multiplyScalar(-1);
  }
  return pole;
}

/**
 * Relative state of B about A in the scene frame (binary invariable = XY),
 * then mass-split so both stars orbit the COM at the origin.
 */
export function kepler16BinaryStatesInScene(
  icrfToScene: Matrix3,
  julianDate: number,
): Partial<Record<BodyId, BodyState>> {
  const mu = G * (KEPLER16A_MASS_KG + KEPLER16B_MASS_KG);
  const periodS = kepler16BinaryPeriodSeconds();
  const n = TWO_PI / periodS;
  const meanAnomalyRad = wrapTwoPi(
    n * (julianDate - KEPLER16_PERIASTRON_JD) * SECONDS_PER_DAY,
  );
  const trueAnomalyRad = meanToTrueAnomaly(
    meanAnomalyRad,
    KEPLER16_ECCENTRICITY,
  );

  // Sky-plane relative elements (secondary about primary).
  const skyElements: ClassicalOrbitalElements = {
    semiMajorAxisM: KEPLER16_REL_SMA_M,
    eccentricity: KEPLER16_ECCENTRICITY,
    inclinationRad: degToRad(KEPLER16_INCLINATION_DEG),
    raanRad: degToRad(KEPLER16_RAAN_DEG),
    argPeriapsisRad: degToRad(KEPLER16_ARG_PERIAPSIS_SECONDARY_DEG),
    trueAnomalyRad,
    semiLatusRectumM:
      KEPLER16_REL_SMA_M * (1 - KEPLER16_ECCENTRICITY * KEPLER16_ECCENTRICITY),
    angularMomentumM2S: Math.sqrt(
      mu *
        KEPLER16_REL_SMA_M *
        (1 - KEPLER16_ECCENTRICITY * KEPLER16_ECCENTRICITY),
    ),
  };

  const relative = classicalElementsToState(skyElements, mu);
  if (!relative) return {};

  // Sky/ICRF basis for the relative state: classicalElementsToState uses
  // equatorial (X/Y/Z) axes. Map sky-plane elements into ICRF via the same
  // sky triad used for the orbital pole, then into the scene frame.
  const direction = kepler16DirectionFromSolIcrf();
  const zSky = direction.clone().multiplyScalar(-1).normalize();
  const icrfNorth = new Vector3(0, 0, 1);
  let xSky = icrfNorth.clone().addScaledVector(zSky, -icrfNorth.dot(zSky));
  if (xSky.lengthSq() < 1e-12) {
    xSky = new Vector3(1, 0, 0).addScaledVector(zSky, -zSky.x).normalize();
  } else {
    xSky.normalize();
  }
  const ySky = new Vector3().crossVectors(zSky, xSky).normalize();

  // classicalElementsToState: +Z = angular momentum for i, Ω in "equatorial"
  // coords. Interpret that equatorial frame as (xSky, ySky, zSky).
  const rEq = relative.positionM;
  const vEq = relative.velocityMS;
  const rIcrf = new Vector3()
    .addScaledVector(xSky, rEq.x)
    .addScaledVector(ySky, rEq.y)
    .addScaledVector(zSky, rEq.z);
  const vIcrf = new Vector3()
    .addScaledVector(xSky, vEq.x)
    .addScaledVector(ySky, vEq.y)
    .addScaledVector(zSky, vEq.z);

  const rScene = rIcrf.applyMatrix3(icrfToScene);
  const vScene = vIcrf.applyMatrix3(icrfToScene);

  const mTot = KEPLER16A_MASS_KG + KEPLER16B_MASS_KG;
  const fA = KEPLER16B_MASS_KG / mTot;
  const fB = KEPLER16A_MASS_KG / mTot;

  // r_rel = r_B − r_A ⇒ r_A = −fA·r_rel, r_B = +fB·r_rel
  return {
    kepler16A: {
      positionM: {
        x: -fA * rScene.x,
        y: -fA * rScene.y,
        z: -fA * rScene.z,
      },
      velocityMS: {
        x: -fA * vScene.x,
        y: -fA * vScene.y,
        z: -fA * vScene.z,
      },
    },
    kepler16B: {
      positionM: {
        x: fB * rScene.x,
        y: fB * rScene.y,
        z: fB * rScene.z,
      },
      velocityMS: {
        x: fB * vScene.x,
        y: fB * vScene.y,
        z: fB * vScene.z,
      },
    },
  };
}
