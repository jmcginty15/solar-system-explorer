import { Matrix3 } from "three";
import type { BodyData, StellarSystemId } from "../data/types";
import { exoplanetSceneBasis } from "./exoplanetFrame";
import { ICRF_TO_INVARIABLE } from "./invariableFrame";

/** ICRF → active star-system scene frame. */
export function icrfToSceneMatrix(systemId: StellarSystemId): Matrix3 {
  switch (systemId) {
    case "sol":
      return ICRF_TO_INVARIABLE;
    default:
      return exoplanetSceneBasis(systemId).icrfToScene;
  }
}

/** Scene-frame transform for a catalog body's home star system. */
export function icrfToSceneMatrixForBody(body: BodyData): Matrix3 {
  return icrfToSceneMatrix(body.stellarSystemId ?? "sol");
}
