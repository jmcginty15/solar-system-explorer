/**
 * Synthesize a relative BodyState from catalog Keplerian elements at a Julian date.
 */
import type { KeplerianElements, StellarSystemId } from "../data/types";
import {
  classicalElementsToState,
  type ClassicalOrbitalElements,
} from "../simulation/orbitalElements";
import { G } from "../simulation/nbody";
import {
  meanToTrueAnomaly,
  trueAnomalyAtTransitRad,
  trueToMeanAnomaly,
} from "../simulation/keplerAnomalies";
import type { BodyState } from "./bodyState";
import { skyElementsInInvariableScene } from "./exoplanetFrame";

const TWO_PI = 2 * Math.PI;
const SECONDS_PER_DAY = 86_400;

function wrapTwoPi(angleRad: number): number {
  const a = angleRad % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/**
 * Map catalog elements into the active scene frame.
 *
 * Sky-plane exoplanet elements are rotated into the system invariable frame
 * (scene XY). Coplanar systems get i ≈ 0 whether they are edge-on or face-on
 * from Earth. `referencePlane: "orbital"` elements are already in that frame.
 */
function elementsInSceneFrame(
  elements: KeplerianElements,
  stellarSystemId: StellarSystemId | null | undefined,
): {
  inclinationRad: number;
  raanRad: number;
  argPeriapsisRad: number;
} {
  const referencePlane = elements.referencePlane ?? "sky";

  if (
    referencePlane === "orbital" ||
    !stellarSystemId ||
    stellarSystemId === "sol"
  ) {
    return {
      inclinationRad: elements.inclinationRad,
      raanRad: elements.raanRad ?? 0,
      argPeriapsisRad: elements.argPeriapsisRad,
    };
  }

  return skyElementsInInvariableScene(elements, stellarSystemId);
}

/**
 * Mean anomaly at `jd`.
 * - With `periastronJd`: M = n (t − T_peri) (RV / classical Kepler).
 * - Otherwise: from the transit epoch — at mid-transit, ν = π/2 − ω ⇒ M_tra;
 *   then M = M_tra + n (t − t_tra).
 */
export function meanAnomalyAtJd(
  elements: KeplerianElements,
  jd: number,
): number {
  const periodS = elements.periodS;
  if (!(periodS > 0)) return 0;
  const n = TWO_PI / periodS;
  if (elements.periastronJd != null) {
    const dtS = (jd - elements.periastronJd) * SECONDS_PER_DAY;
    return wrapTwoPi(n * dtS);
  }
  if (elements.transitJd == null) return 0;
  const nuTra = trueAnomalyAtTransitRad(elements.argPeriapsisRad);
  const mTra = trueToMeanAnomaly(nuTra, elements.eccentricity);
  const dtS = (jd - elements.transitJd) * SECONDS_PER_DAY;
  return wrapTwoPi(mTra + n * dtS);
}

/**
 * Relative state of a body about a fixed central mass at Julian date `jd`
 * (scene-frame meters / m/s). Central body is assumed at the origin.
 */
export function bodyStateFromKeplerianElements(
  elements: KeplerianElements,
  centralMassKg: number,
  bodyMassKg: number,
  jd: number,
  stellarSystemId?: StellarSystemId | null,
): BodyState | null {
  if (!(centralMassKg > 0) || !(elements.semiMajorAxisM > 0)) return null;
  if (!(elements.periodS > 0)) return null;

  const mu = G * (centralMassKg + Math.max(0, bodyMassKg));
  const e = elements.eccentricity;
  if (!(e >= 0) || e >= 1) return null;

  const a = elements.semiMajorAxisM;
  const p = a * (1 - e * e);
  if (!(p > 0)) return null;

  const meanAnomalyRad = meanAnomalyAtJd(elements, jd);
  const trueAnomalyRad = meanToTrueAnomaly(meanAnomalyRad, e);
  const frame = elementsInSceneFrame(elements, stellarSystemId);

  const classical: ClassicalOrbitalElements = {
    semiMajorAxisM: a,
    eccentricity: e,
    inclinationRad: frame.inclinationRad,
    raanRad: frame.raanRad,
    argPeriapsisRad: frame.argPeriapsisRad,
    trueAnomalyRad,
    semiLatusRectumM: p,
    angularMomentumM2S: Math.sqrt(mu * p),
  };

  const state = classicalElementsToState(classical, mu);
  if (!state) return null;
  return {
    positionM: state.positionM,
    velocityMS: state.velocityMS,
  };
}
