import { BODY_CATALOG, BODIES } from "./bodies";
import type { BodyData, BodyId, StellarSystemId } from "./types";

export type StellarSystemDefinition = {
  id: StellarSystemId;
  /** Short UI label. */
  name: string;
  primaryBodyId: BodyId;
  /**
   * Camera / focus target when the system is first selected.
   * `"solar-system"` or a `BodyId` / `${BodyId}-system` focus id.
   */
  defaultFocusId: string;
  /**
   * When true, body states come from SPK ephemeris.
   * When false, the primary is synthesized at rest at the origin.
   */
  usesSpk: boolean;
  /**
   * When true, every body advances with pairwise force summation (Velocity
   * Verlet). Skips the hierarchical Kepler satellite propagator — appropriate
   * for compact systems with no moons (e.g. TRAPPIST-1).
   */
  forceSummationOnly?: boolean;
};

export const STELLAR_SYSTEMS: Record<StellarSystemId, StellarSystemDefinition> =
  {
    sol: {
      id: "sol",
      name: "Solar System",
      primaryBodyId: "sun",
      defaultFocusId: "solar-system",
      usesSpk: true,
    },
    "trappist-1": {
      id: "trappist-1",
      name: "TRAPPIST-1",
      primaryBodyId: "trappist1",
      defaultFocusId: "trappist-1-system",
      usesSpk: false,
      forceSummationOnly: true,
    },
    "hd-110067": {
      id: "hd-110067",
      name: "HD 110067",
      primaryBodyId: "hd110067",
      defaultFocusId: "hd-110067-system",
      usesSpk: false,
      forceSummationOnly: true,
    },
    "hd-10180": {
      id: "hd-10180",
      name: "HD 10180",
      primaryBodyId: "hd10180",
      defaultFocusId: "hd-10180-system",
      usesSpk: false,
      forceSummationOnly: true,
    },
    "hd-219134": {
      id: "hd-219134",
      name: "HD 219134",
      primaryBodyId: "hd219134",
      defaultFocusId: "hd-219134-system",
      usesSpk: false,
      forceSummationOnly: true,
    },
    "kepler-90": {
      id: "kepler-90",
      name: "Kepler-90",
      primaryBodyId: "kepler90",
      defaultFocusId: "kepler-90-system",
      usesSpk: false,
      forceSummationOnly: true,
    },
    "hd-80606": {
      id: "hd-80606",
      name: "HD 80606/HD 80607",
      primaryBodyId: "hd80606",
      defaultFocusId: "hd-80606-system",
      usesSpk: false,
      // Hierarchical: both stars are unbound primaries about the binary COM;
      // HD 80606 b is a Kepler moon of HD 80606 (not full pairwise N-body).
    },
    "kepler-16": {
      id: "kepler-16",
      name: "Kepler-16",
      primaryBodyId: "kepler16A",
      defaultFocusId: "kepler-16-system",
      usesSpk: false,
      // Compact eclipsing binary: pairwise N-body about the mutual COM.
      forceSummationOnly: true,
    },
    "kepler-47": {
      id: "kepler-47",
      name: "Kepler-47",
      primaryBodyId: "kepler47A",
      defaultFocusId: "kepler-47-system",
      usesSpk: false,
      // Compact eclipsing binary: pairwise N-body about the mutual COM.
      forceSummationOnly: true,
    },
  };

/**
 * Fast end of the speed slider (sim seconds per wall-clock second).
 * For Keplerian systems: outermost catalog period ≈ one orbit per second.
 * Sol: one Neptune sidereal orbit per second.
 */
export function simSpeedMaxSeconds(systemId: StellarSystemId): number {
  if (systemId === "sol") {
    return 164.79132 * 365.25 * 86_400;
  }
  if (systemId === "hd-80606") {
    // Lazy import avoided: period from astrometric two-body energy (~31 kyr).
    return 983_780_042_928;
  }
  let maxPeriodS = 0;
  for (const body of bodiesForStellarSystem(systemId)) {
    const periodS = body.keplerianElements?.periodS;
    if (periodS != null && periodS > maxPeriodS) maxPeriodS = periodS;
  }
  return maxPeriodS > 0 ? maxPeriodS : 86_400;
}

export const STELLAR_SYSTEM_ORDER: readonly StellarSystemId[] = [
  "sol",
  "trappist-1",
  "hd-110067",
  "hd-10180",
  "hd-219134",
  "kepler-90",
  "hd-80606",
  "kepler-16",
  "kepler-47",
] as const;

export const DEFAULT_STELLAR_SYSTEM_ID: StellarSystemId = "sol";

/** Catalog stellar-system id (missing → Sol). */
export function bodyStellarSystemId(body: BodyData): StellarSystemId {
  return body.stellarSystemId ?? "sol";
}

/** Bodies that belong to the active star system, in catalog order. */
export function bodiesForStellarSystem(systemId: StellarSystemId): BodyData[] {
  return BODY_CATALOG.filter((body) => bodyStellarSystemId(body) === systemId);
}

const PLANET_TYPES = new Set(["terrestrial-planet", "gas-giant", "ice-giant"]);

/** Catalog object counts for UI copy (updates as bodies are added). */
export type StellarSystemInventory = {
  planetCount: number;
  dwarfPlanetCount: number;
  moonCount: number;
  asteroidCount: number;
  cometCount: number;
};

/** Count planets / dwarfs / moons / asteroids / comets in a star system. */
export function stellarSystemInventory(
  systemId: StellarSystemId,
): StellarSystemInventory {
  let planetCount = 0;
  let dwarfPlanetCount = 0;
  let moonCount = 0;
  let asteroidCount = 0;
  let cometCount = 0;
  for (const body of bodiesForStellarSystem(systemId)) {
    const type = body.type;
    if (!type) continue;
    if (PLANET_TYPES.has(type)) planetCount += 1;
    else if (type === "dwarf-planet") dwarfPlanetCount += 1;
    else if (type.endsWith("-satellite")) moonCount += 1;
    else if (type === "asteroid") asteroidCount += 1;
    else if (type === "comet") cometCount += 1;
  }
  return {
    planetCount,
    dwarfPlanetCount,
    moonCount,
    asteroidCount,
    cometCount,
  };
}

export function bodyIdsForStellarSystem(systemId: StellarSystemId): BodyId[] {
  return bodiesForStellarSystem(systemId).map((body) => body.id as BodyId);
}

export function primaryStarId(systemId: StellarSystemId): BodyId {
  return STELLAR_SYSTEMS[systemId].primaryBodyId;
}

export function primaryStarBody(systemId: StellarSystemId): BodyData {
  return BODIES[primaryStarId(systemId)];
}

/** True when `bodyId` is the central star of its catalog system. */
export function isPrimaryStar(bodyId: BodyId): boolean {
  const body = BODIES[bodyId];
  if (!body) return false;
  const systemId = bodyStellarSystemId(body);
  return STELLAR_SYSTEMS[systemId].primaryBodyId === bodyId;
}
