import { Vector3 } from "three";
import type { BodyState } from "./bodyState";

/**
 * Unit normal to a body's heliocentric orbital plane in the scene frame:
 * (r − r☉) × (v − v☉).
 */
export function heliocentricOrbitalPole(
  body: BodyState,
  sun: BodyState,
): Vector3 {
  const r = new Vector3(
    body.positionM.x - sun.positionM.x,
    body.positionM.y - sun.positionM.y,
    body.positionM.z - sun.positionM.z,
  );
  const v = new Vector3(
    body.velocityMS.x - sun.velocityMS.x,
    body.velocityMS.y - sun.velocityMS.y,
    body.velocityMS.z - sun.velocityMS.z,
  );
  return new Vector3().crossVectors(r, v).normalize();
}
