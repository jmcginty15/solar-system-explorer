import { BODIES, type BodyId } from "../data";

/** CODATA 2018 — kept local to avoid a circular import with nbody. */
const G = 6.674_3e-11;

/** Bind when inside this fraction of the parent Hill radius (and ε < 0). */
export const HILL_BIND_FRACTION = 0.5;
/** Unbind when outside this fraction of the parent Hill radius (or ε ≥ 0). */
export const HILL_UNBIND_FRACTION = 0.9;
/**
 * New captures require parent mass ≥ this × child mass (excludes peer planets).
 * Current / catalog parents are always eligible so Earth–Moon / Pluto–Charon stay valid.
 */
export const MIN_PARENT_MASS_RATIO = 100;

export type HierarchyStateBody = {
  id: BodyId;
  mass: number;
  parentId: BodyId | null;
  state: {
    positionM: { x: number; y: number; z: number };
    velocityMS: { x: number; y: number; z: number };
  };
};

/**
 * Catalog / default non-Sun primary for moons; `null` means heliocentric (or Sun).
 * Seeds dynamic `parentId` and serves as a camera fallback.
 */
export function catalogOrbitalParentId(bodyId: BodyId): BodyId | null {
  switch (BODIES[bodyId].type) {
    case "terrestrial-satellite":
      return "earth";
    case "martian-satellite":
      return "mars";
    case "jovian-satellite":
      return "jupiter";
    case "saturnian-satellite":
      return "saturn";
    case "uranian-satellite":
      return "uranus";
    case "neptunian-satellite":
      return "neptune";
    case "plutonian-satellite":
      return "pluto";
    case "eridian-satellite":
      return "eris";
    case "haumean-satellite":
      return "haumea";
    case "quaoaran-satellite":
      return "quaoar";
    case "orcinian-satellite":
      return "orcus";
    case "salacian-satellite":
      return "salacia";
    case "kagarian-satellite":
      return "kagara";
    case "didymosian-satellite":
      return "didymos";
    case "patroclian-satellite":
      return "patroclus";
    default:
      return null;
  }
}

/** @deprecated Prefer `catalogOrbitalParentId`; kept as a stable alias. */
export const orbitalParentId = catalogOrbitalParentId;

/** Hill radius of `parent` relative to the Sun (meters). */
export function hillRadiusM(
  parentMass: number,
  parentHeliocentricDistanceM: number,
  sunMass: number,
): number {
  if (
    !(parentMass > 0) ||
    !(sunMass > 0) ||
    !(parentHeliocentricDistanceM > 0)
  ) {
    return 0;
  }
  return parentHeliocentricDistanceM * Math.cbrt(parentMass / (3 * sunMass));
}

/** Specific two-body orbital energy of `child` about `parent` (m²/s²). */
export function twoBodySpecificEnergy(
  parent: HierarchyStateBody,
  child: HierarchyStateBody,
): { r: number; eps: number; mu: number } {
  const pp = parent.state.positionM;
  const pv = parent.state.velocityMS;
  const cp = child.state.positionM;
  const cv = child.state.velocityMS;
  const dx = cp.x - pp.x;
  const dy = cp.y - pp.y;
  const dz = cp.z - pp.z;
  const r = Math.hypot(dx, dy, dz);
  const dvx = cv.x - pv.x;
  const dvy = cv.y - pv.y;
  const dvz = cv.z - pv.z;
  const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
  const mu = G * (parent.mass + child.mass);
  if (!(r > 0) || !(mu > 0)) {
    return { r: 0, eps: Number.POSITIVE_INFINITY, mu };
  }
  return { r, eps: 0.5 * v2 - mu / r, mu };
}

function centralStarBody(
  bodies: readonly HierarchyStateBody[],
  byId: Map<BodyId, HierarchyStateBody>,
): HierarchyStateBody | undefined {
  const sun = byId.get("sun");
  if (sun && sun.mass > 0) return sun;
  for (const body of bodies) {
    const catalog = BODIES[body.id];
    if ((catalog?.type === "star" || catalog?.glowAndLight) && body.mass > 0) {
      return body;
    }
  }
  return undefined;
}

function isEligibleParent(
  parent: HierarchyStateBody,
  child: HierarchyStateBody,
  parentParentId: BodyId | null,
  childParentId: BodyId | null,
  centralStarId: BodyId,
): boolean {
  if (parent.id === child.id || parent.id === centralStarId) return false;
  // Only top-level bodies can host satellites (single-level hierarchy).
  if (parentParentId !== null) return false;
  if (parent.mass >= MIN_PARENT_MASS_RATIO * child.mass) return true;
  // Preserve known / current bindings below the capture mass-ratio cut.
  if (childParentId === parent.id) return true;
  if (catalogOrbitalParentId(child.id) === parent.id) return true;
  return false;
}

function stillBoundToParent(
  parent: HierarchyStateBody,
  child: HierarchyStateBody,
  sun: HierarchyStateBody,
): boolean {
  const { r, eps } = twoBodySpecificEnergy(parent, child);
  if (!(r > 0)) return false;
  const a = Math.hypot(
    parent.state.positionM.x - sun.state.positionM.x,
    parent.state.positionM.y - sun.state.positionM.y,
    parent.state.positionM.z - sun.state.positionM.z,
  );
  const rH = hillRadiusM(parent.mass, a, sun.mass);
  if (!(rH > 0)) return false;
  // Clearly outside the Hill sphere → real unbind / ejection.
  if (r > HILL_UNBIND_FRACTION * rH) return false;
  // Deep inside: keep the binding even if osculating ε flickers ≥ 0 from
  // tidal / high-dt noise. Real escapes leave through the Hill boundary.
  if (r < HILL_BIND_FRACTION * rH) return true;
  // Annulus between bind and unbind fractions: require bound energy.
  return eps < 0;
}

function canBindToParent(
  parent: HierarchyStateBody,
  child: HierarchyStateBody,
  sun: HierarchyStateBody,
): { ok: boolean; eps: number } {
  const { r, eps } = twoBodySpecificEnergy(parent, child);
  if (!(r > 0) || !(eps < 0)) return { ok: false, eps };
  const a = Math.hypot(
    parent.state.positionM.x - sun.state.positionM.x,
    parent.state.positionM.y - sun.state.positionM.y,
    parent.state.positionM.z - sun.state.positionM.z,
  );
  const rH = hillRadiusM(parent.mass, a, sun.mass);
  if (!(rH > 0)) return { ok: false, eps };
  return { ok: r < HILL_BIND_FRACTION * rH, eps };
}

/**
 * Update each body's `parentId` from Hill-sphere + two-body energy with hysteresis.
 * Mutates `bodies` in place.
 */
export function updateOrbitalParents(bodies: HierarchyStateBody[]): void {
  if (bodies.length === 0) return;

  const byId = new Map<BodyId, HierarchyStateBody>();
  for (const body of bodies) byId.set(body.id, body);

  const centralStar = centralStarBody(bodies, byId);
  if (!centralStar) {
    for (const body of bodies) body.parentId = null;
    return;
  }
  const centralStarId = centralStar.id;

  // Snapshot parents before assignment so eligibility is consistent this pass.
  const parentSnapshot = new Map<BodyId, BodyId | null>();
  for (const body of bodies) parentSnapshot.set(body.id, body.parentId);

  for (const child of bodies) {
    if (child.id === centralStarId) {
      child.parentId = null;
      continue;
    }

    const currentId = parentSnapshot.get(child.id) ?? null;
    const currentParent = currentId ? byId.get(currentId) : undefined;

    if (
      currentParent &&
      isEligibleParent(
        currentParent,
        child,
        parentSnapshot.get(currentParent.id) ?? null,
        currentId,
        centralStarId,
      ) &&
      stillBoundToParent(currentParent, child, centralStar)
    ) {
      child.parentId = currentParent.id;
      continue;
    }

    let bestId: BodyId | null = null;
    let bestEps = Number.POSITIVE_INFINITY;

    for (const parent of bodies) {
      if (
        !isEligibleParent(
          parent,
          child,
          parentSnapshot.get(parent.id) ?? null,
          currentId,
          centralStarId,
        )
      ) {
        continue;
      }
      const { ok, eps } = canBindToParent(parent, child, centralStar);
      if (!ok) continue;
      if (eps < bestEps) {
        bestEps = eps;
        bestId = parent.id;
      }
    }

    child.parentId = bestId;
  }
}
