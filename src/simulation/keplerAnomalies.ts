/**
 * Kepler equation helpers: mean anomaly ↔ eccentric anomaly ↔ true anomaly.
 */

const TWO_PI = 2 * Math.PI;
const MAX_ITERS = 50;
const TOL = 1e-14;

function wrapTwoPi(angleRad: number): number {
  const a = angleRad % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/** Solve Kepler's equation M = E − e sin E for elliptic orbits (Newton). */
export function meanToEccentricAnomaly(
  meanAnomalyRad: number,
  eccentricity: number,
): number {
  const M = wrapTwoPi(meanAnomalyRad);
  const e = eccentricity;
  if (!(e >= 0) || e >= 1) {
    // Parabolic / hyperbolic not supported for catalog exoplanets yet.
    return M;
  }
  if (e < 1e-12) return M;

  let E = e < 0.8 ? M : Math.PI;
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < TOL) break;
  }
  return wrapTwoPi(E);
}

/** Elliptic eccentric anomaly → true anomaly. */
export function eccentricToTrueAnomaly(
  eccentricAnomalyRad: number,
  eccentricity: number,
): number {
  const e = eccentricity;
  if (e < 1e-12) return wrapTwoPi(eccentricAnomalyRad);
  const cosE = Math.cos(eccentricAnomalyRad);
  const sinE = Math.sin(eccentricAnomalyRad);
  const denom = 1 - e * cosE;
  if (!(Math.abs(denom) > 1e-15)) return wrapTwoPi(eccentricAnomalyRad);
  const cosNu = (cosE - e) / denom;
  const sinNu = (Math.sqrt(Math.max(0, 1 - e * e)) * sinE) / denom;
  return wrapTwoPi(Math.atan2(sinNu, cosNu));
}

/** Mean anomaly → true anomaly for an elliptic orbit. */
export function meanToTrueAnomaly(
  meanAnomalyRad: number,
  eccentricity: number,
): number {
  return eccentricToTrueAnomaly(
    meanToEccentricAnomaly(meanAnomalyRad, eccentricity),
    eccentricity,
  );
}

/**
 * True anomaly at inferior conjunction / mid-transit for a sky-plane orbit.
 * Standard exoplanet relation: ν_tra ≈ π/2 − ω.
 */
export function trueAnomalyAtTransitRad(argPeriapsisRad: number): number {
  return wrapTwoPi(Math.PI / 2 - argPeriapsisRad);
}

/** True anomaly → eccentric anomaly (elliptic). */
export function trueToEccentricAnomaly(
  trueAnomalyRad: number,
  eccentricity: number,
): number {
  const e = eccentricity;
  if (e < 1e-12) return wrapTwoPi(trueAnomalyRad);
  const cosNu = Math.cos(trueAnomalyRad);
  const sinNu = Math.sin(trueAnomalyRad);
  const denom = 1 + e * cosNu;
  if (!(Math.abs(denom) > 1e-15)) return wrapTwoPi(trueAnomalyRad);
  const cosE = (e + cosNu) / denom;
  const sinE = (Math.sqrt(Math.max(0, 1 - e * e)) * sinNu) / denom;
  return wrapTwoPi(Math.atan2(sinE, cosE));
}

/** True anomaly → mean anomaly (elliptic). */
export function trueToMeanAnomaly(
  trueAnomalyRad: number,
  eccentricity: number,
): number {
  const E = trueToEccentricAnomaly(trueAnomalyRad, eccentricity);
  return wrapTwoPi(E - eccentricity * Math.sin(E));
}
