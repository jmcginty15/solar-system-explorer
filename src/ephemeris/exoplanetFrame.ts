/**
 * Exoplanet scene frames: XY = system invariable plane, +Z = invariable north.
 *
 * Catalog Keplerian inclinations are sky-plane values (i = 0 face-on, i = π/2
 * edge-on). They are rotated into the invariable frame for state synthesis so
 * coplanar systems lie in XY regardless of whether they are edge-on or
 * face-on as seen from Earth.
 */
import { Matrix3, Vector3 } from "three";
import {
  BODIES,
  bodiesForStellarSystem,
  primaryStarId,
  STELLAR_SYSTEMS,
  type StellarSystemId,
} from "../data";
import type { KeplerianElements } from "../data/types";
import { G } from "../simulation/nbody";
import { hd10180DirectionFromSolIcrf } from "./hd10180Frame";
import { hd110067DirectionFromSolIcrf } from "./hd110067Frame";
import { hd219134DirectionFromSolIcrf } from "./hd219134Frame";
import {
  hd80606BinaryOrbitalPoleIcrf,
  hd80606DirectionFromSolIcrf,
} from "./hd80606Frame";
import { kepler90DirectionFromSolIcrf } from "./kepler90Frame";
import { trappist1DirectionFromSolIcrf } from "./trappist1Frame";

const TWO_PI = 2 * Math.PI;
const _icrfNorth = new Vector3(0, 0, 1);

export type ExoplanetSceneBasis = {
  icrfToScene: Matrix3;
  xAxisIcrf: Vector3;
  yAxisIcrf: Vector3;
  zAxisIcrf: Vector3;
  /** Unit vector Sol → star in ICRF. */
  directionFromSolIcrf: Vector3;
};

function wrapTwoPi(angleRad: number): number {
  const a = angleRad % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

function clampAcos(cos: number): number {
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/** ICRF unit vector from the Sun toward the exoplanet host. */
export function exoplanetDirectionFromSolIcrf(
  systemId: StellarSystemId,
): Vector3 {
  switch (systemId) {
    case "trappist-1":
      return trappist1DirectionFromSolIcrf();
    case "hd-110067":
      return hd110067DirectionFromSolIcrf();
    case "hd-10180":
      return hd10180DirectionFromSolIcrf();
    case "hd-219134":
      return hd219134DirectionFromSolIcrf();
    case "kepler-90":
      return kepler90DirectionFromSolIcrf();
    case "hd-80606":
      return hd80606DirectionFromSolIcrf();
    case "sol":
      return new Vector3(1, 0, 0);
  }
}

/**
 * Sky-plane basis at the star (ICRF):
 * - +Z toward the observer (star → Sol)
 * - +X = ICRF north projected onto the plane of sky
 * - +Y completes the right-handed triad (≈ east)
 */
export function skyBasisFromDirection(directionFromSolIcrf: Vector3): {
  xSky: Vector3;
  ySky: Vector3;
  zSky: Vector3;
} {
  const zSky = directionFromSolIcrf.clone().multiplyScalar(-1).normalize();
  const xSky = _icrfNorth
    .clone()
    .addScaledVector(zSky, -_icrfNorth.dot(zSky))
    .normalize();
  // If LOS is nearly celestial north, fall back to ICRF +X projected.
  if (xSky.lengthSq() < 1e-12) {
    const fallback = new Vector3(1, 0, 0)
      .addScaledVector(zSky, -zSky.x)
      .normalize();
    xSky.copy(fallback);
  }
  const ySky = new Vector3().crossVectors(zSky, xSky).normalize();
  return { xSky, ySky, zSky };
}

/**
 * Unit orbital angular-momentum direction in ICRF from sky-plane (i, Ω).
 * When Ω is omitted, 0 is used so coplanar catalog planets share a node.
 */
export function skyOrbitalPoleIcrf(
  inclinationRad: number,
  raanRad: number,
  directionFromSolIcrf: Vector3,
): Vector3 {
  const { xSky, ySky, zSky } = skyBasisFromDirection(directionFromSolIcrf);
  const sinI = Math.sin(inclinationRad);
  const cosI = Math.cos(inclinationRad);
  const sinO = Math.sin(raanRad);
  const cosO = Math.cos(raanRad);
  // Standard: ĥ = (sin i sin Ω, −sin i cos Ω, cos i) in (x_sky, y_sky, z_sky).
  return new Vector3()
    .addScaledVector(xSky, sinI * sinO)
    .addScaledVector(ySky, -sinI * cosO)
    .addScaledVector(zSky, cosI)
    .normalize();
}

/**
 * Mass-weighted invariable pole for an exoplanet system from catalog Keplerians.
 * Falls back to the sky-frame +Z (toward observer) when no planets are present.
 *
 * HD 80606/07: always the binary orbital pole so scene XY is the stellar
 * invariable plane (the hot Jupiter is inclined relative to that plane).
 */
export function systemInvariablePoleIcrf(systemId: StellarSystemId): Vector3 {
  if (systemId === "hd-80606") {
    return hd80606BinaryOrbitalPoleIcrf();
  }

  const direction = exoplanetDirectionFromSolIcrf(systemId);
  const starId = primaryStarId(systemId);
  const starMass = BODIES[starId]?.mass ?? 0;
  const L = new Vector3(0, 0, 0);

  for (const body of bodiesForStellarSystem(systemId)) {
    const el = body.keplerianElements;
    if (!el || !(body.mass > 0) || !(el.semiMajorAxisM > 0)) continue;
    const e = el.eccentricity;
    if (!(e >= 0) || e >= 1) continue;
    const mu = G * (starMass + body.mass);
    const hMag = Math.sqrt(mu * el.semiMajorAxisM * (1 - e * e));
    if (!(hMag > 0)) continue;
    const raan = el.raanRad ?? 0;
    const pole = skyOrbitalPoleIcrf(el.inclinationRad, raan, direction);
    L.addScaledVector(pole, body.mass * hMag);
  }

  if (L.lengthSq() < 1e-60) {
    return direction.clone().multiplyScalar(-1).normalize();
  }

  L.normalize();
  // Prefer a pole on the observer-facing hemisphere when nearly face-on;
  // otherwise prefer the northern ICRF hemisphere for a stable handedness.
  const towardObserver = direction.clone().multiplyScalar(-1);
  if (Math.abs(L.dot(towardObserver)) > 0.2) {
    if (L.dot(towardObserver) < 0) L.multiplyScalar(-1);
  } else if (L.dot(_icrfNorth) < 0) {
    L.multiplyScalar(-1);
  }
  return L;
}

/**
 * Scene basis: +Z = invariable north, +X = toward Sol projected into that plane.
 */
export function buildExoplanetSceneBasis(
  systemId: StellarSystemId,
): ExoplanetSceneBasis {
  const directionFromSolIcrf = exoplanetDirectionFromSolIcrf(systemId);
  const zAxisIcrf = systemInvariablePoleIcrf(systemId);

  // From star toward Sol, in the invariable plane.
  const towardSol = directionFromSolIcrf.clone().multiplyScalar(-1);
  let xAxisIcrf = towardSol
    .clone()
    .addScaledVector(zAxisIcrf, -towardSol.dot(zAxisIcrf));
  if (xAxisIcrf.lengthSq() < 1e-12) {
    // Nearly face-on: Sol is along ±Z — pick a stable in-plane axis.
    xAxisIcrf = _icrfNorth
      .clone()
      .addScaledVector(zAxisIcrf, -_icrfNorth.dot(zAxisIcrf));
    if (xAxisIcrf.lengthSq() < 1e-12) {
      xAxisIcrf = new Vector3(1, 0, 0)
        .addScaledVector(zAxisIcrf, -zAxisIcrf.x)
        .normalize();
    } else {
      xAxisIcrf.normalize();
    }
  } else {
    xAxisIcrf.normalize();
  }

  const yAxisIcrf = new Vector3()
    .crossVectors(zAxisIcrf, xAxisIcrf)
    .normalize();

  const icrfToScene = new Matrix3().set(
    xAxisIcrf.x,
    xAxisIcrf.y,
    xAxisIcrf.z,
    yAxisIcrf.x,
    yAxisIcrf.y,
    yAxisIcrf.z,
    zAxisIcrf.x,
    zAxisIcrf.y,
    zAxisIcrf.z,
  );

  return {
    icrfToScene,
    xAxisIcrf,
    yAxisIcrf,
    zAxisIcrf,
    directionFromSolIcrf,
  };
}

const _basisCache = new Map<StellarSystemId, ExoplanetSceneBasis>();

/** Cached scene basis for an exoplanet system (not Sol). */
export function exoplanetSceneBasis(
  systemId: StellarSystemId,
): ExoplanetSceneBasis {
  if (systemId === "sol") {
    throw new Error("exoplanetSceneBasis is for exoplanet systems only");
  }
  let basis = _basisCache.get(systemId);
  if (!basis) {
    if (!(systemId in STELLAR_SYSTEMS) || STELLAR_SYSTEMS[systemId].usesSpk) {
      throw new Error(`No exoplanet frame for system "${systemId}"`);
    }
    basis = buildExoplanetSceneBasis(systemId);
    _basisCache.set(systemId, basis);
  }
  return basis;
}

/** Drop cached frames (e.g. after catalog hot-reload). */
export function clearExoplanetFrameCache(): void {
  _basisCache.clear();
}

export function exoplanetOrbitalPoleIcrfDeg(systemId: StellarSystemId): {
  raDeg: number;
  decDeg: number;
} {
  const { zAxisIcrf } = exoplanetSceneBasis(systemId);
  const raDeg =
    ((Math.atan2(zAxisIcrf.y, zAxisIcrf.x) * 180) / Math.PI + 360) % 360;
  const decDeg =
    (Math.asin(Math.min(1, Math.max(-1, zAxisIcrf.z))) * 180) / Math.PI;
  return { raDeg, decDeg };
}

/**
 * Map catalog sky-plane elements into the system invariable scene frame.
 * Inclination becomes the angle to the invariable pole (≈ 0 for coplanar systems).
 */
export function skyElementsInInvariableScene(
  elements: KeplerianElements,
  systemId: StellarSystemId,
): {
  inclinationRad: number;
  raanRad: number;
  argPeriapsisRad: number;
} {
  const basis = exoplanetSceneBasis(systemId);
  const raanSky = elements.raanRad ?? 0;
  const pole = skyOrbitalPoleIcrf(
    elements.inclinationRad,
    raanSky,
    basis.directionFromSolIcrf,
  );

  const inclinationRad = clampAcos(pole.dot(basis.zAxisIcrf));
  const node = new Vector3().crossVectors(basis.zAxisIcrf, pole);
  let raanRad: number;
  if (node.lengthSq() < 1e-16) {
    // Orbit in the invariable plane — keep the legacy periapsis convention.
    raanRad = elements.raanRad ?? wrapTwoPi(-elements.argPeriapsisRad);
  } else {
    node.normalize();
    raanRad = wrapTwoPi(
      Math.atan2(node.dot(basis.yAxisIcrf), node.dot(basis.xAxisIcrf)),
    );
  }

  return {
    inclinationRad,
    raanRad,
    argPeriapsisRad: elements.argPeriapsisRad,
  };
}
