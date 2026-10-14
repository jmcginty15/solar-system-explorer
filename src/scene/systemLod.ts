import { MathUtils, type PerspectiveCamera } from "three";
import type { BodyId } from "../data";
import {
  furthestSystemOrbitScaleM,
  liveSystemBodyIds,
  orbitalParentMapFromBodies,
  planetarySystemFocusIdsFromParents,
  systemMemberBodies,
  type NbodyBody,
  type SystemFocusId,
} from "../simulation";
import { apparentSizePx } from "./visibility";

/**
 * Tag LOD by apparent system diameter (px): below this, only the system tag;
 * above the far edge, only individual object tags. Smoothstep blends between.
 */
export const SYSTEM_TAG_LOD_SYSTEM_ONLY_PX = 56;
export const SYSTEM_TAG_LOD_MEMBERS_ONLY_PX = 180;

/**
 * Member-orbit LOD: same diameter metric as tags, but the fade sits farther
 * out so moon/primary orbits linger after member tags have gone.
 */
export const SYSTEM_ORBIT_LOD_SYSTEM_ONLY_PX = 28;
export const SYSTEM_ORBIT_LOD_MEMBERS_ONLY_PX = 100;

/** Match body-label ring scale used when measuring system on-screen size. */
const SYSTEM_LOD_RADIUS_SCALE = 1.5;

export type SystemLodState = {
  /** Apparent system diameter in CSS px (0 when unknown). */
  diameterPx: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  worldRadiusM: number;
};

/** memberWeight 1 when near, 0 when far (system-only). */
export function systemMemberLodWeight(
  diameterPx: number,
  systemOnlyPx: number,
  membersOnlyPx: number,
): number {
  // THREE.MathUtils.smoothstep(x, min, max) — not GLSL (edge0, edge1, x).
  return MathUtils.smoothstep(diameterPx, systemOnlyPx, membersOnlyPx);
}

export function systemTagLodWeights(diameterPx: number): {
  systemWeight: number;
  memberWeight: number;
} {
  const memberWeight = systemMemberLodWeight(
    diameterPx,
    SYSTEM_TAG_LOD_SYSTEM_ONLY_PX,
    SYSTEM_TAG_LOD_MEMBERS_ONLY_PX,
  );
  return { systemWeight: 1 - memberWeight, memberWeight };
}

/** Member-orbit opacity weight (1 near → 0 far). */
export function systemOrbitMemberLodWeight(diameterPx: number): number {
  return systemMemberLodWeight(
    diameterPx,
    SYSTEM_ORBIT_LOD_SYSTEM_ONLY_PX,
    SYSTEM_ORBIT_LOD_MEMBERS_ONLY_PX,
  );
}

/**
 * Per live planetary system: on-screen size + COM, plus body→system membership.
 * Diameter uses furthest bound-moon orbit scale (same metric as system tags).
 */
export function computeSystemLodStates(
  camera: PerspectiveCamera,
  viewportHeightPx: number,
  bodies: readonly NbodyBody[],
): {
  bySystemId: Map<SystemFocusId, SystemLodState>;
  bodySystemId: Map<BodyId, SystemFocusId>;
} {
  const parentByBody = orbitalParentMapFromBodies(bodies);
  const activeSystemIds = planetarySystemFocusIdsFromParents(parentByBody);
  const bySystemId = new Map<SystemFocusId, SystemLodState>();
  const bodySystemId = new Map<BodyId, SystemFocusId>();

  for (const systemId of activeSystemIds) {
    for (const bodyId of liveSystemBodyIds(systemId, parentByBody)) {
      bodySystemId.set(bodyId, systemId);
    }

    const members = systemMemberBodies(systemId, bodies);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let mass = 0;
    for (const body of members) {
      if (!(body.mass > 0)) continue;
      mass += body.mass;
      cx += body.mass * body.state.positionM.x;
      cy += body.mass * body.state.positionM.y;
      cz += body.mass * body.state.positionM.z;
    }
    if (!(mass > 0)) {
      bySystemId.set(systemId, {
        diameterPx: 0,
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        worldRadiusM: 0,
      });
      continue;
    }
    cx /= mass;
    cy /= mass;
    cz /= mass;

    const orbitScaleM = furthestSystemOrbitScaleM(members, systemId);
    const worldRadiusM =
      orbitScaleM != null && orbitScaleM > 0
        ? SYSTEM_LOD_RADIUS_SCALE * orbitScaleM
        : 0;
    const distanceM = Math.max(
      Math.hypot(
        cx - camera.position.x,
        cy - camera.position.y,
        cz - camera.position.z,
      ),
      1,
    );
    // Unknown size → treat as fully zoomed out (system-only).
    const diameterPx =
      worldRadiusM > 0
        ? apparentSizePx(worldRadiusM, distanceM, camera, viewportHeightPx)
        : 0;

    bySystemId.set(systemId, {
      diameterPx,
      centerX: cx,
      centerY: cy,
      centerZ: cz,
      worldRadiusM,
    });
  }

  return { bySystemId, bodySystemId };
}
