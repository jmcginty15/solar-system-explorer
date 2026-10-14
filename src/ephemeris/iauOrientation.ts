import { MathUtils, Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import type {
  BodyData,
  IauAngleSeries,
  IauOrientationModel,
  IauOrientationSeries,
} from "../data/types";
import { ICRF_TO_INVARIABLE } from "./invariableFrame";
import { icrfToSceneMatrixForBody } from "./sceneFrame";

export type EvaluatedIauAngles = {
  alpha0Deg: number;
  delta0Deg: number;
  wDeg: number;
};

function evaluateLinear(series: IauAngleSeries, d: number, T: number): number {
  return (
    series.constant +
    (series.perCentury ?? 0) * T +
    (series.perDay ?? 0) * d +
    (series.perDaySquared ?? 0) * d * d
  );
}

function evaluateSeries(
  series: IauOrientationSeries,
  auxiliaries: Record<string, number>,
  d: number,
  T: number,
): number {
  let value = evaluateLinear(series, d, T);
  for (const term of series.periodic ?? []) {
    const base = auxiliaries[term.angle];
    if (base === undefined) {
      throw new Error(`Unknown IAU auxiliary angle "${term.angle}"`);
    }
    const angleRad = MathUtils.degToRad((term.multiple ?? 1) * base);
    value += (term.sinCoeff ?? 0) * Math.sin(angleRad);
    value += (term.cosCoeff ?? 0) * Math.cos(angleRad);
  }
  return value;
}

/** Evaluate α₀, δ₀, W (degrees, ICRF) at days/centuries from J2000. */
export function evaluateIauOrientation(
  model: IauOrientationModel,
  d: number,
  T: number,
): EvaluatedIauAngles {
  const auxiliaries: Record<string, number> = {};
  for (const [name, series] of Object.entries(model.auxiliaryAngles ?? {})) {
    auxiliaries[name] = evaluateLinear(series, d, T);
  }

  return {
    alpha0Deg: evaluateSeries(model.northPoleRa, auxiliaries, d, T),
    delta0Deg: evaluateSeries(model.northPoleDec, auxiliaries, d, T),
    wDeg: evaluateSeries(model.primeMeridian, auxiliaries, d, T),
  };
}

/**
 * Body-fixed → ICRF rotation from IAU α₀, δ₀, W.
 * Body +Z = north pole; +X = prime meridian (W from node Q).
 *
 * Columns of the returned basis are body axes expressed in ICRF.
 */
export function iauBodyAxesIcrf(
  alpha0Deg: number,
  delta0Deg: number,
  wDeg: number,
): { x: Vector3; y: Vector3; z: Vector3 } {
  const alpha = MathUtils.degToRad(alpha0Deg);
  const delta = MathUtils.degToRad(delta0Deg);
  const w = MathUtils.degToRad(wDeg);

  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const cosD = Math.cos(delta);
  const sinD = Math.sin(delta);
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);

  // North pole in ICRF.
  const pole = new Vector3(cosD * cosA, cosD * sinA, sinD);
  // Node Q: α = α₀ + 90°, δ = 0.
  const nodeQ = new Vector3(-sinA, cosA, 0);
  // Direction of increasing W from Q (pole × Q), unit length.
  const poleCrossQ = new Vector3().crossVectors(pole, nodeQ).normalize();

  const x = new Vector3()
    .copy(nodeQ)
    .multiplyScalar(cosW)
    .addScaledVector(poleCrossQ, sinW)
    .normalize();
  const z = pole;
  const y = new Vector3().crossVectors(z, x).normalize();

  return { x, y, z };
}

/**
 * Quaternion that orients a body group (local +Z = pole, +X = prime meridian)
 * into the active scene frame at the given epoch.
 *
 * `icrfToScene` defaults to the solar-system invariable frame.
 */
export function iauOrientationQuaternion(
  model: IauOrientationModel,
  d: number,
  T: number,
  icrfToScene: Matrix3 = ICRF_TO_INVARIABLE,
): Quaternion {
  const { alpha0Deg, delta0Deg, wDeg } = evaluateIauOrientation(model, d, T);
  const axes = iauBodyAxesIcrf(alpha0Deg, delta0Deg, wDeg);

  // Body axes in ICRF → rotate each into the scene frame.
  const xScene = axes.x.clone().applyMatrix3(icrfToScene).normalize();
  const yScene = axes.y.clone().applyMatrix3(icrfToScene).normalize();
  const zScene = axes.z.clone().applyMatrix3(icrfToScene).normalize();

  // Matrix whose columns are body axes in the scene = body→scene.
  const matrix = new Matrix4().makeBasis(xScene, yScene, zScene);
  return new Quaternion().setFromRotationMatrix(matrix);
}

/**
 * Orientation for a body at epoch from its IAU α₀, δ₀, W model,
 * using that body's star-system scene frame.
 */
export function orientationQuaternionForBody(
  body: BodyData,
  d: number,
  T: number,
): Quaternion {
  return iauOrientationQuaternion(
    body.iauOrientation,
    d,
    T,
    icrfToSceneMatrixForBody(body),
  );
}
