/**
 * Runtime tidal-lock orientation: IAU W at epoch, then keep the same face
 * toward the lock barycenter; coast at the last spin rate after eject.
 */
import { MathUtils, Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import type { BodyData, BodyId } from "../data/types";
import { BODIES } from "../data";
import {
  orbitReferenceBarycenter,
  planetarySystemBarycenterFrame,
  primaryHasBoundSatellites,
  type NbodyBody,
} from "../simulation";
import { evaluateIauOrientation, iauBodyAxesIcrf } from "./iauOrientation";
import { icrfToSceneMatrixForBody } from "./sceneFrame";
import { iauPrimeMeridianRateDegPerDay } from "./tidalLocking";

const MIN_EQ_LEN_SQ = 1e-24;

const _toBary = new Vector3();
const _vRel = new Vector3();
const _pole = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _eq = new Vector3();
const _x0 = new Vector3();
const _y0 = new Vector3();
const _tmp = new Vector3();
const _basis = new Matrix4();
const _axisAngle = new Quaternion();

export type TidalLockRuntime = {
  id: BodyId;
  /**
   * Angle (rad) from body +X to the equatorial projection of the
   * body→barycenter vector, about +Z, captured at epoch from IAU W.
   */
  faceOffsetRad: number;
  mode: "locked" | "coasting";
  /**
   * For a bound satellite: parent id at epoch.
   * For a system primary locked to its own barycenter: null.
   */
  lockParentId: BodyId | null;
  /** Heaviest moon bound to a tidally locked primary at epoch; else null. */
  largestMoonId: BodyId | null;
  /** Spin rate about body +Z (rad/s, right-hand); used when coasting. */
  spinRateRadS: number;
  /** Frozen spin pole (invariable) once coasting. */
  coastPole: Vector3 | null;
  /** Body→invariable orientation while coasting. */
  coastOrientation: Quaternion | null;
  /** Effective IAU-style W (deg) for atmosphere / ring lag. */
  wDeg: number;
};

function largestBoundMoonId(
  primaryId: BodyId,
  bodies: readonly NbodyBody[],
): BodyId | null {
  let bestId: BodyId | null = null;
  let bestMass = 0;
  for (const body of bodies) {
    if (body.parentId !== primaryId) continue;
    if (!(body.mass > bestMass)) continue;
    bestMass = body.mass;
    bestId = body.id;
  }
  return bestId;
}

const _poleBasis = new Vector3();
const _x0Basis = new Vector3();
const _y0Basis = new Vector3();

/** IAU north-pole / W=0 equatorial basis in the body's scene frame (scratch). */
function iauPoleBasisScene(
  alpha0Deg: number,
  delta0Deg: number,
  icrfToScene: Matrix3,
): { pole: Vector3; x0: Vector3; y0: Vector3 } {
  const axes = iauBodyAxesIcrf(alpha0Deg, delta0Deg, 0);
  return {
    pole: _poleBasis.copy(axes.z).applyMatrix3(icrfToScene).normalize(),
    x0: _x0Basis.copy(axes.x).applyMatrix3(icrfToScene).normalize(),
    y0: _y0Basis.copy(axes.y).applyMatrix3(icrfToScene).normalize(),
  };
}

/**
 * Project `world` onto the equator of `pole` (unit). Returns false when the
 * vector is nearly parallel to the pole.
 */
function projectEquatorial(
  world: Vector3,
  pole: Vector3,
  out: Vector3,
): boolean {
  out.copy(world).addScaledVector(pole, -world.dot(pole));
  if (out.lengthSq() < MIN_EQ_LEN_SQ) return false;
  out.normalize();
  return true;
}

/** Angle from equatorial basis +X₀ to `eq` about `pole` (rad, −π…π). */
function equatorialAngleRad(eq: Vector3, x0: Vector3, y0: Vector3): number {
  return Math.atan2(eq.dot(y0), eq.dot(x0));
}

function wrapPi(angleRad: number): number {
  const a =
    (((angleRad + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return a - Math.PI;
}

function orientationFromPoleAndX(
  pole: Vector3,
  x: Vector3,
  target: Quaternion,
): Quaternion {
  _y.crossVectors(pole, x).normalize();
  // Re-orthogonalize x in case of drift.
  _x.crossVectors(_y, pole).normalize();
  _basis.makeBasis(_x, _y, pole);
  return target.setFromRotationMatrix(_basis);
}

/**
 * Angular rate of the body→barycenter vector about `pole` (rad/s).
 * Equals the geometric tidal-lock spin rate about that pole.
 */
function sweepRateAboutPoleRadS(
  body: NbodyBody,
  frame: {
    positionM: { x: number; y: number; z: number };
    velocityMS: { x: number; y: number; z: number };
  },
  pole: Vector3,
): number | null {
  _toBary.set(
    frame.positionM.x - body.state.positionM.x,
    frame.positionM.y - body.state.positionM.y,
    frame.positionM.z - body.state.positionM.z,
  );
  _vRel.set(
    frame.velocityMS.x - body.state.velocityMS.x,
    frame.velocityMS.y - body.state.velocityMS.y,
    frame.velocityMS.z - body.state.velocityMS.z,
  );
  if (!projectEquatorial(_toBary, pole, _eq)) return null;
  // r_perp² for the full vector's equatorial component.
  const rPerpSq = _toBary.dot(_toBary) - _toBary.dot(pole) ** 2;
  if (!(rPerpSq > MIN_EQ_LEN_SQ)) return null;
  // (r × v) · pole / |r_perp|²
  _tmp.crossVectors(_toBary, _vRel);
  return _tmp.dot(pole) / rPerpSq;
}

/**
 * Aim point for tidal lock: bound moons → system COM; tidally locked
 * heliocentric planets (TRAPPIST-1) → host star; otherwise orbit reference.
 */
function tidalLockAimFrame(
  body: NbodyBody,
  bodies: readonly NbodyBody[],
): {
  positionM: { x: number; y: number; z: number };
  velocityMS: { x: number; y: number; z: number };
} | null {
  if (body.parentId) {
    return planetarySystemBarycenterFrame(body.parentId, bodies);
  }
  if (primaryHasBoundSatellites(body.id, bodies)) {
    return planetarySystemBarycenterFrame(body.id, bodies);
  }
  const meta = BODIES[body.id];
  if (meta?.tidallyLocked) {
    const star = bodies.find((candidate) => {
      const c = BODIES[candidate.id];
      return Boolean(c && (c.type === "star" || c.glowAndLight));
    });
    if (star && star.id !== body.id) {
      return {
        positionM: star.state.positionM,
        velocityMS: star.state.velocityMS,
      };
    }
  }
  return orbitReferenceBarycenter(body, bodies);
}

function lockedOrientation(
  body: NbodyBody,
  bodies: readonly NbodyBody[],
  alpha0Deg: number,
  delta0Deg: number,
  faceOffsetRad: number,
  icrfToScene: Matrix3,
  outQuat: Quaternion,
  outPole: Vector3,
  outX: Vector3,
): { wDeg: number; spinRateRadS: number | null } | null {
  const frame = tidalLockAimFrame(body, bodies);
  if (!frame) return null;

  _toBary.set(
    frame.positionM.x - body.state.positionM.x,
    frame.positionM.y - body.state.positionM.y,
    frame.positionM.z - body.state.positionM.z,
  );
  if (_toBary.lengthSq() < MIN_EQ_LEN_SQ) return null;

  const { pole, x0, y0 } = iauPoleBasisScene(alpha0Deg, delta0Deg, icrfToScene);
  outPole.copy(pole);
  _x0.copy(x0);
  _y0.copy(y0);

  if (!projectEquatorial(_toBary, outPole, _eq)) return null;

  const sweepRad = equatorialAngleRad(_eq, _x0, _y0);
  // Body +X lies faceOffset behind the sub-barycenter longitude.
  const xAngle = sweepRad - faceOffsetRad;
  outX
    .copy(_x0)
    .multiplyScalar(Math.cos(xAngle))
    .addScaledVector(_y0, Math.sin(xAngle))
    .normalize();
  orientationFromPoleAndX(outPole, outX, outQuat);
  const spinRateRadS = sweepRateAboutPoleRadS(body, frame, outPole);
  return { wDeg: MathUtils.radToDeg(xAngle), spinRateRadS };
}

function shouldCoast(
  runtime: TidalLockRuntime,
  bodies: readonly NbodyBody[],
): boolean {
  if (runtime.mode === "coasting") return true;

  if (runtime.lockParentId != null) {
    const self = bodies.find((b) => b.id === runtime.id);
    return !self || self.parentId !== runtime.lockParentId;
  }

  if (runtime.largestMoonId != null) {
    const moon = bodies.find((b) => b.id === runtime.largestMoonId);
    return !moon || moon.parentId !== runtime.id;
  }

  return false;
}

/**
 * Create per-body tidal-lock runtime state at an epoch query.
 * Initial face offset is taken from the IAU orientation at `(d, T)`.
 */
export function initTidalLockRuntimes(
  bodies: readonly NbodyBody[],
  catalog: Record<BodyId, BodyData>,
  d: number,
  T: number,
): Map<BodyId, TidalLockRuntime> {
  const map = new Map<BodyId, TidalLockRuntime>();
  const scratchQ = new Quaternion();

  for (const body of bodies) {
    const meta = catalog[body.id];
    if (!meta?.tidallyLocked) continue;

    const angles = evaluateIauOrientation(meta.iauOrientation, d, T);
    const icrfToScene = icrfToSceneMatrixForBody(meta);
    const iauQ = (() => {
      const axes = iauBodyAxesIcrf(
        angles.alpha0Deg,
        angles.delta0Deg,
        angles.wDeg,
      );
      const x = axes.x.clone().applyMatrix3(icrfToScene).normalize();
      const y = axes.y.clone().applyMatrix3(icrfToScene).normalize();
      const z = axes.z.clone().applyMatrix3(icrfToScene).normalize();
      return scratchQ.setFromRotationMatrix(_basis.makeBasis(x, y, z));
    })();

    const frame = tidalLockAimFrame(body, bodies);
    let faceOffsetRad = 0;
    let spinRateRadS =
      MathUtils.degToRad(
        iauPrimeMeridianRateDegPerDay(meta.iauOrientation, d),
      ) / 86_400;
    if (frame) {
      _toBary.set(
        frame.positionM.x - body.state.positionM.x,
        frame.positionM.y - body.state.positionM.y,
        frame.positionM.z - body.state.positionM.z,
      );
      const { pole, x0, y0 } = iauPoleBasisScene(
        angles.alpha0Deg,
        angles.delta0Deg,
        icrfToScene,
      );
      // Body +X from IAU orientation.
      _x.set(1, 0, 0).applyQuaternion(iauQ).normalize();
      if (
        projectEquatorial(_toBary, pole, _eq) &&
        projectEquatorial(_x, pole, _tmp)
      ) {
        const sweepRad = equatorialAngleRad(_eq, x0, y0);
        const xAngle = equatorialAngleRad(_tmp, x0, y0);
        faceOffsetRad = wrapPi(sweepRad - xAngle);
      }
      const geometricRate = sweepRateAboutPoleRadS(body, frame, pole);
      if (geometricRate != null) spinRateRadS = geometricRate;
    }

    const isPrimary =
      body.parentId == null && primaryHasBoundSatellites(body.id, bodies);

    map.set(body.id, {
      id: body.id,
      faceOffsetRad,
      mode: "locked",
      lockParentId: body.parentId,
      largestMoonId: isPrimary ? largestBoundMoonId(body.id, bodies) : null,
      spinRateRadS,
      coastPole: null,
      coastOrientation: null,
      wDeg: angles.wDeg,
    });
  }

  return map;
}

export type TidalLockStepResult = {
  orientation: Quaternion;
  wDeg: number;
};

/**
 * Advance one tidally locked body: face the lock barycenter, or coast after eject.
 * `dtSeconds` is the simulation step (0 on epoch load / pause sync).
 */
function advanceCoasting(
  runtime: TidalLockRuntime,
  dtSeconds: number,
  outOrientation: Quaternion,
): TidalLockStepResult {
  const coastQ = runtime.coastOrientation!;
  const coastPole = runtime.coastPole!;
  if (dtSeconds > 0 && Number.isFinite(runtime.spinRateRadS)) {
    _axisAngle.setFromAxisAngle(coastPole, runtime.spinRateRadS * dtSeconds);
    coastQ.premultiply(_axisAngle).normalize();
    runtime.wDeg += MathUtils.radToDeg(runtime.spinRateRadS * dtSeconds);
  }
  outOrientation.copy(coastQ);
  return { orientation: outOrientation, wDeg: runtime.wDeg };
}

export function stepTidalLockOrientation(
  runtime: TidalLockRuntime,
  body: NbodyBody,
  bodies: readonly NbodyBody[],
  catalog: Record<BodyId, BodyData>,
  d: number,
  T: number,
  dtSeconds: number,
  outOrientation: Quaternion,
): TidalLockStepResult {
  if (
    runtime.mode === "coasting" &&
    runtime.coastOrientation &&
    runtime.coastPole
  ) {
    return advanceCoasting(runtime, dtSeconds, outOrientation);
  }

  // Eject before re-locking so we don't aim at the wrong barycenter for a frame.
  if (shouldCoast(runtime, bodies)) {
    if (runtime.coastOrientation && runtime.coastPole) {
      runtime.mode = "coasting";
      return advanceCoasting(runtime, dtSeconds, outOrientation);
    }
    // No prior locked pose (degenerate); freeze identity.
    runtime.mode = "coasting";
    runtime.coastOrientation = outOrientation.identity().clone();
    runtime.coastPole = new Vector3(0, 0, 1);
    return { orientation: outOrientation, wDeg: runtime.wDeg };
  }

  const meta = catalog[body.id];
  if (!meta) {
    outOrientation.identity();
    return { orientation: outOrientation, wDeg: runtime.wDeg };
  }

  const angles = evaluateIauOrientation(meta.iauOrientation, d, T);
  const locked = lockedOrientation(
    body,
    bodies,
    angles.alpha0Deg,
    angles.delta0Deg,
    runtime.faceOffsetRad,
    icrfToSceneMatrixForBody(meta),
    outOrientation,
    _pole,
    _x,
  );

  if (!locked) {
    if (runtime.coastOrientation) {
      outOrientation.copy(runtime.coastOrientation);
    }
    return { orientation: outOrientation, wDeg: runtime.wDeg };
  }

  if (locked.spinRateRadS != null) {
    runtime.spinRateRadS = locked.spinRateRadS;
  }
  runtime.wDeg = locked.wDeg;

  if (!runtime.coastOrientation) {
    runtime.coastOrientation = outOrientation.clone();
  } else {
    runtime.coastOrientation.copy(outOrientation);
  }
  // Keep a pole stash for an instantaneous eject on a later frame.
  if (!runtime.coastPole) {
    runtime.coastPole = _pole.clone();
  } else {
    runtime.coastPole.copy(_pole);
  }

  return { orientation: outOrientation, wDeg: runtime.wDeg };
}
