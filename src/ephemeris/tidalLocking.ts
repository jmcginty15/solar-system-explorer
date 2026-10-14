/**
 * Detect 1:1 tidal locking by comparing sidereal rotation (IAU W rate)
 * to the osculating orbital period about the body's parent-system barycenter.
 */
import type { BodyData, BodyId, IauOrientationModel } from "../data/types";
import {
  keplerStateAboutBarycenter,
  orbitReferenceBarycenter,
  updateOrbitalParents,
  stateToClassicalElements,
  type NbodyBody,
} from "../simulation";
import { daysFromJ2000 } from "./time";

/** Relative |P_rot − P_orb| / P_orb threshold for "nearly equal". */
export const TIDAL_LOCK_PERIOD_TOLERANCE = 0.05;

export type TidalLockAuditEntry = {
  id: BodyId;
  name: string;
  /** Parent used for the system barycenter (null → solar-system COM). */
  orbitParentId: BodyId | null;
  orbitalPeriodS: number | null;
  rotationPeriodS: number | null;
  /** |P_rot − P_orb| / P_orb when both periods are finite and positive. */
  relativeDiff: number | null;
  tidallyLocked: boolean;
  skipReason?: string;
};

/** Mean dW/dd from the IAU prime-meridian series (deg/day; sign = sense). */
export function iauPrimeMeridianRateDegPerDay(
  model: IauOrientationModel,
  d: number,
): number {
  const series = model.primeMeridian;
  return (series.perDay ?? 0) + 2 * (series.perDaySquared ?? 0) * d;
}

/**
 * Sidereal rotation period from the mean IAU W rate (seconds).
 * Uses |dW/dd|; ignores periodic terms.
 */
export function siderealRotationPeriodSeconds(
  wDotDegPerDay: number,
): number | null {
  const absRate = Math.abs(wDotDegPerDay);
  if (!(absRate > 0) || !Number.isFinite(absRate)) return null;
  return (360 / absRate) * 86_400;
}

/** Sidereal period from osculating a and μ; null if unbound / invalid. */
export function orbitalPeriodSecondsFromElements(
  semiMajorAxisM: number,
  eccentricity: number,
  mu: number,
): number | null {
  if (!(mu > 0) || !(semiMajorAxisM > 0) || !(eccentricity < 1)) return null;
  if (!Number.isFinite(semiMajorAxisM)) return null;
  return (
    2 *
    Math.PI *
    Math.sqrt((semiMajorAxisM * semiMajorAxisM * semiMajorAxisM) / mu)
  );
}

/**
 * Osculating orbital period of `body` about its parent-system barycenter
 * (same reference frame / μ as the scene orbit ellipses).
 */
export function orbitalPeriodAboutParentBarycenterS(
  body: NbodyBody,
  bodies: readonly NbodyBody[],
): number | null {
  const frame = orbitReferenceBarycenter(body, bodies);
  if (!frame) return null;
  const state = keplerStateAboutBarycenter(
    body.state.positionM,
    body.state.velocityMS,
    body.mass,
    frame,
  );
  if (!state) return null;
  const elements = stateToClassicalElements(
    state.relativePositionM,
    state.relativeVelocityMS,
    state.mu,
  );
  if (!elements) return null;
  return orbitalPeriodSecondsFromElements(
    elements.semiMajorAxisM,
    elements.eccentricity,
    state.mu,
  );
}

/** True when rotation and orbital periods match within the relative tolerance. */
export function periodsIndicateTidalLock(
  rotationPeriodS: number,
  orbitalPeriodS: number,
  tolerance = TIDAL_LOCK_PERIOD_TOLERANCE,
): boolean {
  if (
    !(rotationPeriodS > 0) ||
    !(orbitalPeriodS > 0) ||
    !Number.isFinite(rotationPeriodS) ||
    !Number.isFinite(orbitalPeriodS)
  ) {
    return false;
  }
  const relativeDiff =
    Math.abs(rotationPeriodS - orbitalPeriodS) / orbitalPeriodS;
  return relativeDiff <= tolerance;
}

/**
 * Audit every body in `bodies` at Julian date `jd`.
 * Updates `parentId` via Hill/energy hierarchy before comparing periods.
 */
export function auditTidalLocking(
  bodies: NbodyBody[],
  jd: number,
  catalog: Record<BodyId, BodyData>,
  options?: {
    tolerance?: number;
  },
): TidalLockAuditEntry[] {
  const tolerance = options?.tolerance ?? TIDAL_LOCK_PERIOD_TOLERANCE;
  const d = daysFromJ2000(jd);

  updateOrbitalParents(bodies);

  const entries: TidalLockAuditEntry[] = [];
  for (const body of bodies) {
    const meta = catalog[body.id];
    const name = meta?.name ?? body.id;
    const orbitParentId = body.parentId;

    if (!meta?.iauOrientation) {
      entries.push({
        id: body.id,
        name,
        orbitParentId,
        orbitalPeriodS: null,
        rotationPeriodS: null,
        relativeDiff: null,
        tidallyLocked: false,
        skipReason: "missing IAU orientation",
      });
      continue;
    }

    const wDot = iauPrimeMeridianRateDegPerDay(meta.iauOrientation, d);
    const rotationPeriodS = siderealRotationPeriodSeconds(wDot);
    const orbitalPeriodS = orbitalPeriodAboutParentBarycenterS(body, bodies);

    let relativeDiff: number | null = null;
    let tidallyLocked = false;
    let skipReason: string | undefined;

    if (rotationPeriodS == null) {
      skipReason = "no IAU W rate";
    } else if (orbitalPeriodS == null) {
      skipReason = "no bound elliptical orbit about parent barycenter";
    } else {
      relativeDiff =
        Math.abs(rotationPeriodS - orbitalPeriodS) / orbitalPeriodS;
      tidallyLocked = relativeDiff <= tolerance;
    }

    entries.push({
      id: body.id,
      name,
      orbitParentId,
      orbitalPeriodS,
      rotationPeriodS,
      relativeDiff,
      tidallyLocked,
      skipReason,
    });
  }

  return entries;
}
