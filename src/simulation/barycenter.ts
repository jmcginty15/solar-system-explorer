import type { BodyId, BodyPositionM, StellarSystemId } from "../data";
import { BODIES, STELLAR_SYSTEMS } from "../data";
import { catalogOrbitalParentId } from "./hierarchy";
import { G, type NbodyBody } from "./nbody";
import {
  stateToClassicalElements,
  type ClassicalOrbitalElements,
} from "./orbitalElements";

/**
 * Focus targets for system barycenters (not catalog body ids).
 * Stellar barycenters (`solar-system`, `trappist-1-system`, …) use every
 * simulated body; `${BodyId}-system` is a planet–moon system.
 */
export type StellarBarycenterFocusId =
  | "solar-system"
  | "trappist-1-system"
  | "hd-110067-system"
  | "hd-10180-system"
  | "hd-219134-system"
  | "kepler-90-system"
  | "hd-80606-system"
  | "kepler-16-system";

export type SystemFocusId = StellarBarycenterFocusId | `${BodyId}-system`;

export type FocusId = BodyId | SystemFocusId;

const SYSTEM_SUFFIX = "-system";

const STELLAR_BARYCENTER_FOCUS_IDS = new Set<string>([
  "solar-system",
  "trappist-1-system",
  "hd-110067-system",
  "hd-10180-system",
  "hd-219134-system",
  "kepler-90-system",
  "hd-80606-system",
  "kepler-16-system",
]);

/** Whole-star-system barycenter (all bodies), not a planet–moon COM. */
export function isStellarBarycenterFocusId(
  id: string,
): id is StellarBarycenterFocusId {
  return STELLAR_BARYCENTER_FOCUS_IDS.has(id);
}

export function isSystemFocusId(id: string): id is SystemFocusId {
  return isStellarBarycenterFocusId(id) || id.endsWith(SYSTEM_SUFFIX);
}

/** Focus id for the active star system's barycenter row in the picker. */
export function stellarBarycenterFocusId(
  systemId: StellarSystemId,
): StellarBarycenterFocusId {
  switch (systemId) {
    case "sol":
      return "solar-system";
    case "trappist-1":
      return "trappist-1-system";
    case "hd-110067":
      return "hd-110067-system";
    case "hd-10180":
      return "hd-10180-system";
    case "hd-219134":
      return "hd-219134-system";
    case "kepler-90":
      return "kepler-90-system";
    case "hd-80606":
      return "hd-80606-system";
    case "kepler-16":
      return "kepler-16-system";
  }
}

/** Primary body for a planetary system; `null` for a stellar barycenter. */
export function systemPrimaryId(systemId: SystemFocusId): BodyId | null {
  if (isStellarBarycenterFocusId(systemId)) return null;
  return systemId.slice(0, -SYSTEM_SUFFIX.length) as BodyId;
}

export function systemFocusIdForPrimary(primaryId: BodyId): SystemFocusId {
  return `${primaryId}-system`;
}

const SYSTEM_PRIMARY_TYPES = new Set([
  "terrestrial-planet",
  "gas-giant",
  "ice-giant",
  "dwarf-planet",
]);

/** Catalog primaries that get a planetary-system focus entry. */
export function systemPrimaryBodyIds(catalogIds: readonly BodyId[]): BodyId[] {
  return catalogIds.filter((id) => {
    const type = BODIES[id]?.type;
    return typeof type === "string" && SYSTEM_PRIMARY_TYPES.has(type);
  });
}

/**
 * Planetary system focus ids that have catalog moons (excludes solar-system).
 * Used for focus-picker system rows and system tags.
 */
export function catalogPlanetarySystemFocusIds(): SystemFocusId[] {
  const primaries = new Set<BodyId>();
  for (const id of Object.keys(BODIES) as BodyId[]) {
    const parent = catalogOrbitalParentId(id);
    if (parent) primaries.add(parent);
  }
  return [...primaries].map((id) => systemFocusIdForPrimary(id));
}

/** Live child → parent map (`null` = heliocentric). */
export type OrbitalParentMap = ReadonlyMap<BodyId, BodyId | null>;

export function orbitalParentMapFromBodies(
  bodies: readonly NbodyBody[],
): Map<BodyId, BodyId | null> {
  const map = new Map<BodyId, BodyId | null>();
  for (const body of bodies) map.set(body.id, body.parentId);
  return map;
}

/** Stable fingerprint of bound child→parent pairs (for change detection). */
export function hierarchyFingerprint(parentByBody: OrbitalParentMap): string {
  const parts: string[] = [];
  for (const [id, parentId] of parentByBody) {
    if (parentId != null) parts.push(`${id}>${parentId}`);
  }
  parts.sort();
  return parts.join("|");
}

/**
 * Planetary systems implied by the live orbital hierarchy: any body that
 * currently has at least one bound child.
 */
export function planetarySystemFocusIdsFromParents(
  parentByBody: OrbitalParentMap,
): SystemFocusId[] {
  const primaries = new Set<BodyId>();
  for (const parentId of parentByBody.values()) {
    if (parentId != null) primaries.add(parentId);
  }
  return [...primaries].map((id) => systemFocusIdForPrimary(id));
}

/**
 * Planetary systems that still qualify given the bodies that are actually
 * present (e.g. have ephemeris states). A primary is a "system" only when at
 * least one of its catalog moons is among `availableBodyIds`; otherwise it is
 * treated as a singular heliocentric body.
 *
 * Prefer {@link planetarySystemFocusIdsFromParents} once the live hierarchy is
 * known (captures / ejections).
 */
export function planetarySystemFocusIdsAmong(
  availableBodyIds: ReadonlySet<BodyId> | readonly BodyId[],
): SystemFocusId[] {
  const available =
    availableBodyIds instanceof Set
      ? availableBodyIds
      : new Set(availableBodyIds);
  const primaries = new Set<BodyId>();
  for (const id of Object.keys(BODIES) as BodyId[]) {
    const parent = catalogOrbitalParentId(id);
    if (!parent || !available.has(id)) continue;
    if (available.has(parent)) primaries.add(parent);
  }
  return [...primaries].map((id) => systemFocusIdForPrimary(id));
}

/**
 * System focus ids that have a scene name tag (planetary systems with moons;
 * not the solar system as a whole).
 */
export function catalogSystemTagFocusIds(): SystemFocusId[] {
  return catalogPlanetarySystemFocusIds();
}

/**
 * Body + system tag ids. When `parentByBody` is provided, systems follow the
 * live hierarchy (captures / ejections); otherwise catalog moons among
 * `bodyIds` are used.
 */
export function allTagFocusIds(
  bodyIds: readonly BodyId[],
  parentByBody?: OrbitalParentMap | null,
): FocusId[] {
  const systems = parentByBody
    ? planetarySystemFocusIdsFromParents(parentByBody)
    : planetarySystemFocusIdsAmong(bodyIds);
  return [...bodyIds, ...systems];
}

/**
 * Default tag / orbit visibility: the Sun (solar-system primary) plus
 * planetary systems centered on terrestrial planets, gas giants, ice giants,
 * and dwarf planets. Systems with bound satellites use the system id;
 * moonless primaries use the body id.
 */
export function defaultPlanetarySystemVisibleIds(
  bodyIds: readonly BodyId[],
  parentByBody?: OrbitalParentMap | null,
): FocusId[] {
  const available = new Set(bodyIds);
  const activeSystems = new Set(
    parentByBody
      ? planetarySystemFocusIdsFromParents(parentByBody)
      : planetarySystemFocusIdsAmong(bodyIds),
  );
  const ids: FocusId[] = [];
  for (const id of bodyIds) {
    if (!(available.has(id) && BODIES[id]?.type === "star")) continue;
    // Star that hosts bound planets/moons: show the subsystem orbit by default.
    const systemId = systemFocusIdForPrimary(id);
    ids.push(activeSystems.has(systemId) ? systemId : id);
  }
  for (const id of systemPrimaryBodyIds(bodyIds)) {
    const parent = parentByBody
      ? (parentByBody.get(id) ?? null)
      : catalogOrbitalParentId(id);
    if (parent != null && available.has(parent)) continue;
    const systemId = systemFocusIdForPrimary(id);
    ids.push(activeSystems.has(systemId) ? systemId : id);
  }
  return ids;
}

/** Primary + currently bound children for a planetary system. */
export function liveSystemBodyIds(
  systemId: SystemFocusId,
  parentByBody: OrbitalParentMap,
): BodyId[] {
  const primaryId = systemPrimaryId(systemId);
  if (!primaryId) return [];
  const ids: BodyId[] = [primaryId];
  for (const [id, parentId] of parentByBody) {
    if (parentId === primaryId) ids.push(id);
  }
  return ids;
}

export function systemDisplayName(systemId: SystemFocusId): string {
  if (isStellarBarycenterFocusId(systemId)) {
    for (const id of Object.keys(STELLAR_SYSTEMS) as StellarSystemId[]) {
      if (stellarBarycenterFocusId(id) === systemId) {
        return STELLAR_SYSTEMS[id].name;
      }
    }
  }
  const primaryId = systemPrimaryId(systemId);
  if (!primaryId) return "System";
  const name = BODIES[primaryId]?.name ?? primaryId;
  return `${name} System`;
}

/**
 * Bodies that define a system barycenter:
 * - stellar: every simulated body
 * - planetary: the primary plus objects currently bound to it (`parentId`)
 */
export function systemMemberBodies(
  systemId: SystemFocusId,
  bodies: readonly NbodyBody[],
): NbodyBody[] {
  if (isStellarBarycenterFocusId(systemId)) return bodies.slice();
  const primaryId = systemPrimaryId(systemId);
  if (!primaryId) return [];
  return bodies.filter(
    (body) => body.id === primaryId || body.parentId === primaryId,
  );
}

export function centerOfMass(
  members: readonly NbodyBody[],
): BodyPositionM | null {
  let totalMass = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const body of members) {
    if (!(body.mass > 0)) continue;
    totalMass += body.mass;
    x += body.mass * body.state.positionM.x;
    y += body.mass * body.state.positionM.y;
    z += body.mass * body.state.positionM.z;
  }
  if (!(totalMass > 0)) return null;
  return { x: x / totalMass, y: y / totalMass, z: z / totalMass };
}

function centerOfMassVelocity(
  members: readonly NbodyBody[],
): BodyPositionM | null {
  let totalMass = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const body of members) {
    if (!(body.mass > 0)) continue;
    totalMass += body.mass;
    x += body.mass * body.state.velocityMS.x;
    y += body.mass * body.state.velocityMS.y;
    z += body.mass * body.state.velocityMS.z;
  }
  if (!(totalMass > 0)) return null;
  return { x: x / totalMass, y: y / totalMass, z: z / totalMass };
}

function totalMassKg(members: readonly NbodyBody[]): number {
  let total = 0;
  for (const body of members) {
    if (body.mass > 0) total += body.mass;
  }
  return total;
}

/** Mass-weighted COM frame for Keplerian orbits about a system barycenter. */
export type BarycenterFrame = {
  positionM: BodyPositionM;
  velocityMS: BodyPositionM;
  totalMassKg: number;
};

function barycenterFrameFromMembers(
  members: readonly NbodyBody[],
): BarycenterFrame | null {
  const positionM = centerOfMass(members);
  const velocityMS = centerOfMassVelocity(members);
  const mass = totalMassKg(members);
  if (!positionM || !velocityMS || !(mass > 0)) return null;
  return { positionM, velocityMS, totalMassKg: mass };
}

/** Solar-system barycenter (all simulated bodies). */
export function solarSystemBarycenterFrame(
  bodies: readonly NbodyBody[],
): BarycenterFrame | null {
  return barycenterFrameFromMembers(bodies);
}

/** Planet + currently bound satellites. */
export function planetarySystemBarycenterFrame(
  primaryId: BodyId,
  bodies: readonly NbodyBody[],
): BarycenterFrame | null {
  return barycenterFrameFromMembers(
    systemMemberBodies(systemFocusIdForPrimary(primaryId), bodies),
  );
}

/** True when `primaryId` currently hosts at least one bound satellite. */
export function primaryHasBoundSatellites(
  primaryId: BodyId,
  bodies: readonly NbodyBody[],
): boolean {
  for (const body of bodies) {
    if (body.parentId === primaryId) return true;
  }
  return false;
}

/**
 * Reference barycenter for a body's osculating orbit:
 * - bound satellite → parent planetary-system COM
 * - primary with bound moons → its own planetary-system COM
 *   (e.g. HD 80606’s reflex about the HD 80606+b COM — same as Pluto–Charon;
 *   the wide binary motion is the `hd80606-system` ellipse about the stellar COM)
 * - otherwise (lone heliocentric body / Sun) → solar-system COM
 */
export function orbitReferenceBarycenter(
  body: NbodyBody,
  bodies: readonly NbodyBody[],
): BarycenterFrame | null {
  if (body.parentId) {
    return planetarySystemBarycenterFrame(body.parentId, bodies);
  }
  if (primaryHasBoundSatellites(body.id, bodies)) {
    return planetarySystemBarycenterFrame(body.id, bodies);
  }
  return solarSystemBarycenterFrame(bodies);
}

/**
 * Two-body–equivalent gravitational parameter for a mass `mOrbitingKg` whose
 * path about the system COM is treated as Keplerian with the remaining mass
 * as a point at the COM of that remainder:
 *   μ = G · M_rest³ / M_total²
 *
 * Using μ = G·M_total with (r − r_COM) is wrong (especially for comparable
 * masses like Pluto–Charon) and makes osculating ellipses spuriously precess.
 */
export function barycentricOrbitMu(
  totalMassKg: number,
  orbitingMassKg: number,
): number {
  const rest = totalMassKg - orbitingMassKg;
  if (!(totalMassKg > 0) || !(rest > 0) || !(orbitingMassKg >= 0)) return 0;
  return (G * rest * rest * rest) / (totalMassKg * totalMassKg);
}

export type BarycentricOrbitState = {
  /** Position relative to the barycenter (m). */
  relativePositionM: BodyPositionM;
  /** Velocity relative to the barycenter (m/s). */
  relativeVelocityMS: BodyPositionM;
  /** Kepler μ for this body's ellipse about the barycenter (m³/s²). */
  mu: number;
  barycenterPositionM: BodyPositionM;
};

/**
 * Relative state + correct μ for drawing a point mass's osculating orbit about
 * a barycenter frame (planet/moon about system COM, or subsystem about SSB).
 */
export function keplerStateAboutBarycenter(
  positionM: BodyPositionM,
  velocityMS: BodyPositionM,
  orbitingMassKg: number,
  frame: BarycenterFrame,
): BarycentricOrbitState | null {
  const mu = barycentricOrbitMu(frame.totalMassKg, orbitingMassKg);
  if (!(mu > 0)) return null;
  return {
    relativePositionM: {
      x: positionM.x - frame.positionM.x,
      y: positionM.y - frame.positionM.y,
      z: positionM.z - frame.positionM.z,
    },
    relativeVelocityMS: {
      x: velocityMS.x - frame.velocityMS.x,
      y: velocityMS.y - frame.velocityMS.y,
      z: velocityMS.z - frame.velocityMS.z,
    },
    mu,
    barycenterPositionM: frame.positionM,
  };
}

/** Osculating orbit of a mass about the SSB (system COM or lone body). */
export type OrbitAboutSsb = {
  elements: ClassicalOrbitalElements;
  /** Kepler μ used for the osculating elements (m³/s²). */
  mu: number;
  /** Distance from the SSB (m). */
  radiusM: number;
  /** Speed relative to the SSB (m/s). */
  orbitalSpeedMS: number;
};

/** @deprecated Prefer {@link OrbitAboutSsb}. */
export type SystemOrbitAboutSsb = OrbitAboutSsb;

function orbitAboutSsbFromState(
  positionM: BodyPositionM,
  velocityMS: BodyPositionM,
  orbitingMassKg: number,
  ssb: BarycenterFrame,
): OrbitAboutSsb | null {
  const state = keplerStateAboutBarycenter(
    positionM,
    velocityMS,
    orbitingMassKg,
    ssb,
  );
  if (!state) return null;
  const elements = stateToClassicalElements(
    state.relativePositionM,
    state.relativeVelocityMS,
    state.mu,
  );
  if (!elements) return null;
  const rp = state.relativePositionM;
  const rv = state.relativeVelocityMS;
  return {
    elements,
    mu: state.mu,
    radiusM: Math.hypot(rp.x, rp.y, rp.z),
    orbitalSpeedMS: Math.hypot(rv.x, rv.y, rv.z),
  };
}

/**
 * Osculating Keplerian elements + current radius/speed of a planetary-system
 * barycenter about the solar-system barycenter. Same relative state and μ used
 * for the system orbit ellipse in the scene.
 */
export function systemOrbitAboutSsb(
  systemId: SystemFocusId,
  bodies: readonly NbodyBody[],
): OrbitAboutSsb | null {
  if (isStellarBarycenterFocusId(systemId) || bodies.length === 0) return null;
  const primaryId = systemPrimaryId(systemId);
  if (!primaryId) return null;
  const ssb = solarSystemBarycenterFrame(bodies);
  const sys = planetarySystemBarycenterFrame(primaryId, bodies);
  if (!ssb || !sys) return null;
  return orbitAboutSsbFromState(
    sys.positionM,
    sys.velocityMS,
    sys.totalMassKg,
    ssb,
  );
}

/**
 * Osculating orbit of a lone heliocentric body about the SSB — same relative
 * state and μ used for that body’s orbit ellipse when it has no parent and no
 * bound satellites.
 */
export function bodyOrbitAboutSsb(
  bodyId: BodyId,
  bodies: readonly NbodyBody[],
): OrbitAboutSsb | null {
  if (bodies.length === 0) return null;
  const body = bodies.find((entry) => entry.id === bodyId);
  if (!body || body.parentId != null) return null;
  if (primaryHasBoundSatellites(bodyId, bodies)) return null;
  return heliocentricBodyOrbitAboutSsb(bodyId, bodies);
}

/**
 * Osculating orbit of a heliocentric body about the SSB, including primaries
 * that host bound satellites (their path about the Sun, not the system COM).
 */
export function heliocentricBodyOrbitAboutSsb(
  bodyId: BodyId,
  bodies: readonly NbodyBody[],
): OrbitAboutSsb | null {
  if (bodies.length === 0) return null;
  const body = bodies.find((entry) => entry.id === bodyId);
  if (!body || body.parentId != null) return null;
  const ssb = solarSystemBarycenterFrame(bodies);
  if (!ssb) return null;
  return orbitAboutSsbFromState(
    body.state.positionM,
    body.state.velocityMS,
    body.mass,
    ssb,
  );
}

/** Osculating orbit of a bound satellite about its planetary-system barycenter. */
export function satelliteOrbitAboutPlanetarySystem(
  bodyId: BodyId,
  bodies: readonly NbodyBody[],
): OrbitAboutSsb | null {
  if (bodies.length === 0) return null;
  const body = bodies.find((entry) => entry.id === bodyId);
  if (!body?.parentId) return null;
  const frame = planetarySystemBarycenterFrame(body.parentId, bodies);
  if (!frame) return null;
  return orbitAboutSsbFromState(
    body.state.positionM,
    body.state.velocityMS,
    body.mass,
    frame,
  );
}

/** @deprecated Prefer {@link systemOrbitAboutSsb}. */
export function systemOrbitElementsAboutSsb(
  systemId: SystemFocusId,
  bodies: readonly NbodyBody[],
): ClassicalOrbitalElements | null {
  return systemOrbitAboutSsb(systemId, bodies)?.elements ?? null;
}

/** Two-body semimajor axis about a center (meters), or null if unbound / invalid. */
export function orbitalSemiMajorAxisM(
  position: BodyPositionM,
  velocity: BodyPositionM,
  centerPosition: BodyPositionM,
  centerVelocity: BodyPositionM,
  mu: number,
): number | null {
  if (!(mu > 0)) return null;
  const dx = position.x - centerPosition.x;
  const dy = position.y - centerPosition.y;
  const dz = position.z - centerPosition.z;
  const r = Math.hypot(dx, dy, dz);
  if (!(r > 0)) return null;
  const dvx = velocity.x - centerVelocity.x;
  const dvy = velocity.y - centerVelocity.y;
  const dvz = velocity.z - centerVelocity.z;
  const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
  const eps = 0.5 * v2 - mu / r;
  if (!(eps < 0)) return null;
  const a = -mu / (2 * eps);
  return a > 0 ? a : null;
}

/**
 * Bodies whose osculating orbit about `systemId`'s COM is meaningful for
 * framing / tags. Nested moons about the SSB produce near-parabolic garbage
 * semimajor axes (hundreds of AU), so solar-system scale uses only
 * heliocentric members (`parentId == null`). Planetary systems use moons
 * bound to the primary (the primary's a about its own COM is negligible).
 */
function systemOrbitScaleMembers(
  systemId: SystemFocusId,
  members: readonly NbodyBody[],
): NbodyBody[] {
  if (isStellarBarycenterFocusId(systemId)) {
    return members.filter((body) => body.parentId == null);
  }
  const primaryId = systemPrimaryId(systemId);
  if (!primaryId) return members.slice();
  return members.filter(
    (body) => body.id === primaryId || body.parentId === primaryId,
  );
}

/**
 * Bound semimajor axis of one body about the COM of `members`, or its current
 * COM distance if unbound / unavailable.
 */
export function bodyOrbitScaleAboutSystemM(
  bodyId: BodyId,
  members: readonly NbodyBody[],
): number | null {
  const body = members.find((entry) => entry.id === bodyId);
  if (!body) return null;
  const com = centerOfMass(members);
  const comVel = centerOfMassVelocity(members);
  const mass = totalMassKg(members);
  if (!com || !comVel || !(mass > 0)) return null;

  const { positionM, velocityMS } = body.state;
  const dx = positionM.x - com.x;
  const dy = positionM.y - com.y;
  const dz = positionM.z - com.z;
  const r = Math.hypot(dx, dy, dz);

  const mu = barycentricOrbitMu(mass, body.mass);
  if (mu > 0) {
    const a = orbitalSemiMajorAxisM(positionM, velocityMS, com, comVel, mu);
    if (a != null && a > 0) return a;
  }
  return r > 0 ? r : null;
}

/**
 * Largest bound semimajor axis about the system COM among bodies that
 * directly orbit that system. Falls back to the largest current COM distance
 * of those orbiters when nothing is bound.
 */
export function furthestSystemOrbitScaleM(
  members: readonly NbodyBody[],
  systemId: SystemFocusId,
): number | null {
  if (members.length === 0) return null;
  const com = centerOfMass(members);
  const comVel = centerOfMassVelocity(members);
  const mass = totalMassKg(members);
  if (!com || !comVel || !(mass > 0)) return null;

  const orbiters = systemOrbitScaleMembers(systemId, members);
  if (orbiters.length === 0) return null;

  let maxA = 0;
  let maxR = 0;

  for (const body of orbiters) {
    const { positionM, velocityMS } = body.state;
    const dx = positionM.x - com.x;
    const dy = positionM.y - com.y;
    const dz = positionM.z - com.z;
    const r = Math.hypot(dx, dy, dz);
    if (r > maxR) maxR = r;

    const mu = barycentricOrbitMu(mass, body.mass);
    if (!(mu > 0)) continue;
    const a = orbitalSemiMajorAxisM(positionM, velocityMS, com, comVel, mu);
    if (a != null && a > maxA) maxA = a;
  }

  if (maxA > 0) return maxA;
  return maxR > 0 ? maxR : null;
}

/** Live barycenter position for a system focus target. */
export function systemBarycenterPosition(
  systemId: SystemFocusId,
  bodies: readonly NbodyBody[],
): BodyPositionM | null {
  return centerOfMass(systemMemberBodies(systemId, bodies));
}
