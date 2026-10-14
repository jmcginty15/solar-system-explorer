import { Matrix3, Vector3 } from "three";
import type { BodyState } from "./bodyState";

/**
 * Orientation of the solar-system invariable plane wrt ICRF at J2000.0
 * (Souami & Souchay 2012, complete system).
 * i = 23° 0′ 31.9″, Ω = 3° 51′ 9.4″.
 */
const INVARIABLE_INCLINATION_DEG = 23 + 0 / 60 + 31.9 / 3600;
const INVARIABLE_NODE_DEG = 3 + 51 / 60 + 9.4 / 3600;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Rotation that maps ICRF Cartesian coordinates into the scene frame
 * (XY = invariable plane, +Z = invariable north).
 *
 * Ascending node of the invariable plane on the ICRF equator → +X.
 * Invariable angular-momentum direction → +Z.
 */
function buildIcrfToInvariableMatrix(): Matrix3 {
  const i = degToRad(INVARIABLE_INCLINATION_DEG);
  const omega = degToRad(INVARIABLE_NODE_DEG);

  const cosO = Math.cos(omega);
  const sinO = Math.sin(omega);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);

  // Invariable +X = ascending node on ICRF equator.
  const xAxis = new Vector3(cosO, sinO, 0);
  // Invariable +Z = pole of the invariable plane in ICRF.
  const zAxis = new Vector3(sinI * sinO, -sinI * cosO, cosI);
  const yAxis = new Vector3().crossVectors(zAxis, xAxis).normalize();

  // Rows are the invariable basis expressed in ICRF → v_inv = M * v_icrf.
  return new Matrix3().set(
    xAxis.x,
    xAxis.y,
    xAxis.z,
    yAxis.x,
    yAxis.y,
    yAxis.z,
    zAxis.x,
    zAxis.y,
    zAxis.z,
  );
}

/** Cached ICRF → invariable rotation. */
export const ICRF_TO_INVARIABLE = buildIcrfToInvariableMatrix();

const _scratch = new Vector3();

/** Rotate an ICRF vector into the invariable frame (in place on a copy). */
export function icrfToInvariable(x: number, y: number, z: number): Vector3 {
  return _scratch.set(x, y, z).applyMatrix3(ICRF_TO_INVARIABLE).clone();
}

/** Transform an ICRF BodyState into invariable-frame meters / m/s. */
export function transformStateToInvariable(state: BodyState): BodyState {
  const p = icrfToInvariable(
    state.positionM.x,
    state.positionM.y,
    state.positionM.z,
  );
  const v = icrfToInvariable(
    state.velocityMS.x,
    state.velocityMS.y,
    state.velocityMS.z,
  );
  return {
    positionM: { x: p.x, y: p.y, z: p.z },
    velocityMS: { x: v.x, y: v.y, z: v.z },
  };
}
