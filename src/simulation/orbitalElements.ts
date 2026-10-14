/**
 * Classical (Keplerian) orbital elements ↔ Cartesian state (Vallado / Curtis).
 * Relative state about a central body with gravitational parameter μ (m³/s²).
 */

import type { Vec3 } from "./kepler";

const TWO_PI = 2 * Math.PI;
/** Treat |e| below this as circular; |i| / node below this as equatorial. */
const DEFAULT_ELEMENT_TOL = 1e-8;

export type ClassicalOrbitalElements = {
  /** Semimajor axis (m). +elliptic, ∞ parabolic, −hyperbolic. */
  semiMajorAxisM: number;
  /** Eccentricity (≥ 0). */
  eccentricity: number;
  /** Inclination i (rad), [0, π]. */
  inclinationRad: number;
  /**
   * Right ascension of the ascending node Ω (rad), [0, 2π).
   * Set to 0 for equatorial orbits (node undefined).
   */
  raanRad: number;
  /**
   * Argument of periapsis ω (rad), [0, 2π).
   * Set to 0 for circular orbits (periapsis undefined).
   */
  argPeriapsisRad: number;
  /**
   * True anomaly ν (rad), [0, 2π).
   * For circular orbits this is the argument of latitude (from the node)
   * or true longitude (equatorial circular).
   */
  trueAnomalyRad: number;
  /** Semi-latus rectum p = h²/μ (m). */
  semiLatusRectumM: number;
  /** |h| specific angular momentum (m²/s). */
  angularMomentumM2S: number;
};

function wrapTwoPi(angleRad: number): number {
  const a = angleRad % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

function clampAcos(x: number): number {
  return Math.acos(Math.min(1, Math.max(-1, x)));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function mag(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Convert relative position/velocity to classical Keplerian elements.
 * Returns `null` when the state is degenerate (zero radius or angular momentum).
 */
export function stateToClassicalElements(
  positionM: Vec3,
  velocityMS: Vec3,
  mu: number,
  tol: number = DEFAULT_ELEMENT_TOL,
): ClassicalOrbitalElements | null {
  if (!(mu > 0)) return null;

  const r = mag(positionM);
  if (!(r > 0)) return null;

  const v2 = dot(velocityMS, velocityMS);
  const hVec = cross(positionM, velocityMS);
  const h = mag(hVec);
  if (!(h > 0)) return null;

  const energy = 0.5 * v2 - mu / r;
  const semiLatusRectumM = (h * h) / mu;

  let semiMajorAxisM: number;
  if (Math.abs(energy) < tol * (mu / r)) {
    semiMajorAxisM = Number.POSITIVE_INFINITY;
  } else {
    semiMajorAxisM = -mu / (2 * energy);
  }

  // Eccentricity vector: e = (1/μ) [(v² − μ/r) r − (r·v) v]
  const rDotV = dot(positionM, velocityMS);
  const eVec = scale(
    sub(scale(positionM, v2 - mu / r), scale(velocityMS, rDotV)),
    1 / mu,
  );
  const eccentricity = mag(eVec);

  const inclinationRad = clampAcos(hVec.z / h);

  // Line of nodes: n = ẑ × h
  const nVec = { x: -hVec.y, y: hVec.x, z: 0 };
  const n = mag(nVec);
  const equatorial = n < tol;
  const circular = eccentricity < tol;

  let raanRad = 0;
  if (!equatorial) {
    raanRad = Math.atan2(nVec.y, nVec.x);
    raanRad = wrapTwoPi(raanRad);
  }

  let argPeriapsisRad = 0;
  let trueAnomalyRad = 0;

  if (circular && equatorial) {
    // True longitude: angle from x-axis to r in the equatorial plane.
    trueAnomalyRad = wrapTwoPi(Math.atan2(positionM.y, positionM.x));
  } else if (circular) {
    // Argument of latitude: angle from node to r in the orbital plane.
    const cosU = dot(nVec, positionM) / (n * r);
    trueAnomalyRad = clampAcos(cosU);
    if (positionM.z < 0) trueAnomalyRad = TWO_PI - trueAnomalyRad;
    trueAnomalyRad = wrapTwoPi(trueAnomalyRad);
  } else if (equatorial) {
    // Longitude of periapsis + true anomaly from eccentricity / position.
    argPeriapsisRad = wrapTwoPi(Math.atan2(eVec.y, eVec.x));
    const cosNu = dot(eVec, positionM) / (eccentricity * r);
    trueAnomalyRad = clampAcos(cosNu);
    if (rDotV < 0) trueAnomalyRad = TWO_PI - trueAnomalyRad;
    trueAnomalyRad = wrapTwoPi(trueAnomalyRad);
  } else {
    const cosW = dot(nVec, eVec) / (n * eccentricity);
    argPeriapsisRad = clampAcos(cosW);
    if (eVec.z < 0) argPeriapsisRad = TWO_PI - argPeriapsisRad;
    argPeriapsisRad = wrapTwoPi(argPeriapsisRad);

    const cosNu = dot(eVec, positionM) / (eccentricity * r);
    trueAnomalyRad = clampAcos(cosNu);
    if (rDotV < 0) trueAnomalyRad = TWO_PI - trueAnomalyRad;
    trueAnomalyRad = wrapTwoPi(trueAnomalyRad);
  }

  return {
    semiMajorAxisM,
    eccentricity,
    inclinationRad,
    raanRad,
    argPeriapsisRad,
    trueAnomalyRad,
    semiLatusRectumM,
    angularMomentumM2S: h,
  };
}

/**
 * Convert classical Keplerian elements to a relative Cartesian state.
 * Uses periapsis / node conventions matching `stateToClassicalElements`
 * (including the circular / equatorial substitutions).
 */
export function classicalElementsToState(
  elements: ClassicalOrbitalElements,
  mu: number,
): { positionM: Vec3; velocityMS: Vec3 } | null {
  if (!(mu > 0)) return null;
  const p = elements.semiLatusRectumM;
  if (!(p > 0)) return null;

  const e = elements.eccentricity;
  const nu = elements.trueAnomalyRad;
  const cosNu = Math.cos(nu);
  const sinNu = Math.sin(nu);
  const denom = 1 + e * cosNu;
  if (!(Math.abs(denom) > 1e-15)) return null;

  const rPqw = {
    x: (p * cosNu) / denom,
    y: (p * sinNu) / denom,
    z: 0,
  };
  const sqrtMuP = Math.sqrt(mu / p);
  const vPqw = {
    x: -sqrtMuP * sinNu,
    y: sqrtMuP * (e + cosNu),
    z: 0,
  };

  // For circular orbits, trueAnomaly stores arg of latitude / true longitude
  // and argPeriapsis is 0 — same PQW→IJK rotation with ω = 0.
  const i = elements.inclinationRad;
  const O = elements.raanRad;
  const w = elements.argPeriapsisRad;

  const cosO = Math.cos(O);
  const sinO = Math.sin(O);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);

  const r11 = cosO * cosW - sinO * sinW * cosI;
  const r12 = -cosO * sinW - sinO * cosW * cosI;
  const r13 = sinO * sinI;
  const r21 = sinO * cosW + cosO * sinW * cosI;
  const r22 = -sinO * sinW + cosO * cosW * cosI;
  const r23 = -cosO * sinI;
  const r31 = sinW * sinI;
  const r32 = cosW * sinI;
  const r33 = cosI;

  const rotate = (v: Vec3): Vec3 => ({
    x: r11 * v.x + r12 * v.y + r13 * v.z,
    y: r21 * v.x + r22 * v.y + r23 * v.z,
    z: r31 * v.x + r32 * v.y + r33 * v.z,
  });

  return {
    positionM: rotate(rPqw),
    velocityMS: rotate(vPqw),
  };
}
