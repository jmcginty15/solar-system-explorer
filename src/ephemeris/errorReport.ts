/**
 * Compare live n-body states against SPK truth at the same Julian date.
 * API states are ICRF; they are transformed to the invariable frame before diff.
 */

import { BODIES, type BodyId } from "../data";
import {
  keplerStateAboutBarycenter,
  orbitReferenceBarycenter,
  stateToClassicalElements,
  type NbodyBody,
} from "../simulation";
import type { BodyState } from "./bodyState";
import { transformStateToInvariable } from "./invariableFrame";

const AU_M = 149_597_870_700;
const EARTH_RADIUS_M = 6_371_000;
/** Prefer km formatting below this absolute error. */
const KM_FORMAT_CEILING_AU = 0.01;

export type BodyErrorStatus =
  | "ok"
  | "missing_api"
  | "missing_sim"
  | "degenerate_elements";

export type RtnPositionErrorM = {
  radialM: number;
  alongTrackM: number;
  crossTrackM: number;
};

export type BodyErrorRow = {
  bodyId: BodyId;
  name: string;
  status: BodyErrorStatus;
  /** Absolute position error magnitude (m). Null when either side missing. */
  positionErrorM: number | null;
  /** Absolute velocity error magnitude (m/s). */
  velocityErrorMS: number | null;
  /** Semimajor-axis delta a_sim − a_spk (m). */
  deltaSemiMajorAxisM: number | null;
  /** Eccentricity delta e_sim − e_spk. */
  deltaEccentricity: number | null;
  /** Inclination delta i_sim − i_spk (rad). */
  deltaInclinationRad: number | null;
  /** RTN decomposition of absolute Δr in the SPK orbital frame. */
  rtnM: RtnPositionErrorM | null;
};

export type ErrorReportSummary = {
  comparedCount: number;
  missingApiCount: number;
  missingSimCount: number;
  maxPositionErrorM: number | null;
  medianPositionErrorM: number | null;
  maxVelocityErrorMS: number | null;
  /** Bodies with |Δr| greater than one Earth radius. */
  aboveEarthRadiusCount: number;
};

export type ErrorReport = {
  simJd: number;
  rows: BodyErrorRow[];
  summary: ErrorReportSummary;
};

type Vec3 = { x: number; y: number; z: number };

function mag(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * RTN basis from truth relative position/velocity about the orbital center.
 * Returns null when the state is degenerate (zero radius or angular momentum).
 */
function rtnBasis(
  relPos: Vec3,
  relVel: Vec3,
): { rHat: Vec3; tHat: Vec3; nHat: Vec3 } | null {
  const r = mag(relPos);
  if (!(r > 0)) return null;
  const rHat = scale(relPos, 1 / r);
  const h = cross(relPos, relVel);
  const hMag = mag(h);
  if (!(hMag > 0)) return null;
  const nHat = scale(h, 1 / hMag);
  const tHat = cross(nHat, rHat);
  const tMag = mag(tHat);
  if (!(tMag > 0)) return null;
  return { rHat, tHat: scale(tHat, 1 / tMag), nHat };
}

function cloneState(state: BodyState): BodyState {
  return {
    positionM: { ...state.positionM },
    velocityMS: { ...state.velocityMS },
  };
}

function bodiesWithStates(
  template: readonly NbodyBody[],
  states: ReadonlyMap<BodyId, BodyState>,
): NbodyBody[] {
  const out: NbodyBody[] = [];
  for (const body of template) {
    const state = states.get(body.id);
    if (!state) continue;
    out.push({
      id: body.id,
      mass: body.mass,
      parentId: body.parentId,
      state: cloneState(state),
    });
  }
  return out;
}

function elementDeltas(
  simBody: NbodyBody,
  truthBody: NbodyBody,
  simBodies: readonly NbodyBody[],
  truthBodies: readonly NbodyBody[],
): {
  deltaSemiMajorAxisM: number | null;
  deltaEccentricity: number | null;
  deltaInclinationRad: number | null;
  degenerate: boolean;
  truthRel: { positionM: Vec3; velocityMS: Vec3 } | null;
} {
  const simFrame = orbitReferenceBarycenter(simBody, simBodies);
  const truthFrame = orbitReferenceBarycenter(truthBody, truthBodies);
  if (!simFrame || !truthFrame) {
    return {
      deltaSemiMajorAxisM: null,
      deltaEccentricity: null,
      deltaInclinationRad: null,
      degenerate: true,
      truthRel: null,
    };
  }

  const simKepler = keplerStateAboutBarycenter(
    simBody.state.positionM,
    simBody.state.velocityMS,
    simBody.mass,
    simFrame,
  );
  const truthKepler = keplerStateAboutBarycenter(
    truthBody.state.positionM,
    truthBody.state.velocityMS,
    truthBody.mass,
    truthFrame,
  );
  if (!simKepler || !truthKepler) {
    return {
      deltaSemiMajorAxisM: null,
      deltaEccentricity: null,
      deltaInclinationRad: null,
      degenerate: true,
      truthRel: null,
    };
  }

  const simEl = stateToClassicalElements(
    simKepler.relativePositionM,
    simKepler.relativeVelocityMS,
    simKepler.mu,
  );
  const truthEl = stateToClassicalElements(
    truthKepler.relativePositionM,
    truthKepler.relativeVelocityMS,
    truthKepler.mu,
  );
  if (!simEl || !truthEl) {
    return {
      deltaSemiMajorAxisM: null,
      deltaEccentricity: null,
      deltaInclinationRad: null,
      degenerate: true,
      truthRel: {
        positionM: truthKepler.relativePositionM,
        velocityMS: truthKepler.relativeVelocityMS,
      },
    };
  }

  return {
    deltaSemiMajorAxisM: simEl.semiMajorAxisM - truthEl.semiMajorAxisM,
    deltaEccentricity: simEl.eccentricity - truthEl.eccentricity,
    deltaInclinationRad: simEl.inclinationRad - truthEl.inclinationRad,
    degenerate: false,
    truthRel: {
      positionM: truthKepler.relativePositionM,
      velocityMS: truthKepler.relativeVelocityMS,
    },
  };
}

export type BuildErrorReportInput = {
  simJd: number;
  /** Live n-body particles (invariable frame). */
  simBodies: readonly NbodyBody[];
  /** ICRF states from `/api/ephemeris/states`. */
  apiStatesIcrf: Partial<Record<BodyId, BodyState>>;
};

/** Build a full error report from sim snapshot + API ICRF states. */
export function buildErrorReport(input: BuildErrorReportInput): ErrorReport {
  const { simJd, simBodies, apiStatesIcrf } = input;

  const simStateById = new Map<BodyId, BodyState>();
  for (const body of simBodies) {
    simStateById.set(body.id, body.state);
  }

  const truthStateById = new Map<BodyId, BodyState>();
  for (const [id, icrf] of Object.entries(apiStatesIcrf) as [
    BodyId,
    BodyState,
  ][]) {
    if (icrf) truthStateById.set(id, transformStateToInvariable(icrf));
  }

  const truthBodies = bodiesWithStates(simBodies, truthStateById);
  const truthBodyById = new Map(truthBodies.map((b) => [b.id, b]));

  const allIds = new Set<BodyId>();
  for (const body of simBodies) allIds.add(body.id);
  for (const id of truthStateById.keys()) allIds.add(id);

  const rows: BodyErrorRow[] = [];

  for (const bodyId of allIds) {
    const name = BODIES[bodyId]?.name ?? bodyId;
    const simBody = simBodies.find((b) => b.id === bodyId);
    const truthBody = truthBodyById.get(bodyId);
    const simState = simStateById.get(bodyId);
    const truthState = truthStateById.get(bodyId);

    if (!simState || !simBody) {
      rows.push({
        bodyId,
        name,
        status: "missing_sim",
        positionErrorM: null,
        velocityErrorMS: null,
        deltaSemiMajorAxisM: null,
        deltaEccentricity: null,
        deltaInclinationRad: null,
        rtnM: null,
      });
      continue;
    }

    if (!truthState || !truthBody) {
      rows.push({
        bodyId,
        name,
        status: "missing_api",
        positionErrorM: null,
        velocityErrorMS: null,
        deltaSemiMajorAxisM: null,
        deltaEccentricity: null,
        deltaInclinationRad: null,
        rtnM: null,
      });
      continue;
    }

    const dPos = sub(simState.positionM, truthState.positionM);
    const dVel = sub(simState.velocityMS, truthState.velocityMS);
    const positionErrorM = mag(dPos);
    const velocityErrorMS = mag(dVel);

    const els = elementDeltas(simBody, truthBody, simBodies, truthBodies);

    let rtnM: RtnPositionErrorM | null = null;
    if (els.truthRel) {
      const basis = rtnBasis(els.truthRel.positionM, els.truthRel.velocityMS);
      if (basis) {
        rtnM = {
          radialM: dot(dPos, basis.rHat),
          alongTrackM: dot(dPos, basis.tHat),
          crossTrackM: dot(dPos, basis.nHat),
        };
      }
    }

    rows.push({
      bodyId,
      name,
      status: els.degenerate ? "degenerate_elements" : "ok",
      positionErrorM,
      velocityErrorMS,
      deltaSemiMajorAxisM: els.deltaSemiMajorAxisM,
      deltaEccentricity: els.deltaEccentricity,
      deltaInclinationRad: els.deltaInclinationRad,
      rtnM,
    });
  }

  rows.sort((a, b) => {
    const aErr = a.positionErrorM;
    const bErr = b.positionErrorM;
    if (aErr == null && bErr == null) return a.name.localeCompare(b.name);
    if (aErr == null) return 1;
    if (bErr == null) return -1;
    return bErr - aErr;
  });

  const positionErrors = rows
    .map((r) => r.positionErrorM)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const velocityErrors = rows
    .map((r) => r.velocityErrorMS)
    .filter((v): v is number => v != null);

  const summary: ErrorReportSummary = {
    comparedCount: positionErrors.length,
    missingApiCount: rows.filter((r) => r.status === "missing_api").length,
    missingSimCount: rows.filter((r) => r.status === "missing_sim").length,
    maxPositionErrorM:
      positionErrors.length > 0
        ? positionErrors[positionErrors.length - 1]!
        : null,
    medianPositionErrorM: median(positionErrors),
    maxVelocityErrorMS:
      velocityErrors.length > 0 ? Math.max(...velocityErrors) : null,
    aboveEarthRadiusCount: positionErrors.filter((e) => e > EARTH_RADIUS_M)
      .length,
  };

  return { simJd, rows, summary };
}

/** Pick km vs AU for a representative length (prefer km under 0.01 AU). */
export function lengthUnitForMagnitude(meters: number | null): "km" | "au" {
  if (meters == null || !(meters > 0)) return "km";
  return meters / AU_M < KM_FORMAT_CEILING_AU ? "km" : "au";
}

export function formatLengthError(
  meters: number | null,
  unit?: "km" | "au",
): string {
  if (meters == null || !Number.isFinite(meters)) return "—";
  const u = unit ?? lengthUnitForMagnitude(Math.abs(meters));
  if (u === "au") {
    const au = meters / AU_M;
    const abs = Math.abs(au);
    const digits = abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
    return `${au.toFixed(digits)} AU`;
  }
  const km = meters / 1000;
  const abs = Math.abs(km);
  if (abs >= 1e6) return `${km.toExponential(2)} km`;
  if (abs >= 100) return `${km.toFixed(1)} km`;
  if (abs >= 1) return `${km.toFixed(2)} km`;
  return `${km.toFixed(3)} km`;
}

export function formatVelocityError(metersPerSec: number | null): string {
  if (metersPerSec == null || !Number.isFinite(metersPerSec)) return "—";
  const abs = Math.abs(metersPerSec);
  if (abs >= 1e6) return `${metersPerSec.toExponential(2)} m/s`;
  if (abs >= 100) return `${metersPerSec.toFixed(1)} m/s`;
  if (abs >= 1) return `${metersPerSec.toFixed(2)} m/s`;
  return `${metersPerSec.toFixed(3)} m/s`;
}

export function formatEccentricityDelta(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return "—";
  const abs = Math.abs(delta);
  if (abs >= 0.1) return delta.toFixed(4);
  if (abs >= 1e-4) return delta.toFixed(6);
  return delta.toExponential(2);
}

export function formatInclinationDeltaDeg(deltaRad: number | null): string {
  if (deltaRad == null || !Number.isFinite(deltaRad)) return "—";
  const deg = (deltaRad * 180) / Math.PI;
  const abs = Math.abs(deg);
  if (abs >= 1) return `${deg.toFixed(3)}°`;
  if (abs >= 0.001) return `${deg.toFixed(4)}°`;
  return `${deg.toExponential(2)}°`;
}

export function statusLabel(status: BodyErrorStatus): string {
  switch (status) {
    case "ok":
      return "OK";
    case "missing_api":
      return "Missing API";
    case "missing_sim":
      return "Missing sim";
    case "degenerate_elements":
      return "Degenerate els";
  }
}

export { EARTH_RADIUS_M, AU_M };
