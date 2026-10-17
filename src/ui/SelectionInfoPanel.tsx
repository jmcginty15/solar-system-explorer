import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { type Matrix3, Vector3 } from "three";
import {
  BODIES,
  BODY_CATALOG,
  STELLAR_SYSTEMS,
  type BodyData,
  type BodyId,
  type BodyPositionM,
  type IauOrientationModel,
  type StellarSystemId,
} from "../data";
import {
  AU_M,
  HD10180_DISTANCE_LY,
  HD110067_DISTANCE_LY,
  HD219134_DISTANCE_LY,
  HD80606_DISTANCE_LY,
  HD80606_SYSTEM_DISTANCE_LY,
  HD80607_DISTANCE_LY,
  KEPLER16_DISTANCE_LY,
  KEPLER47_DISTANCE_LY,
  KEPLER90_DISTANCE_LY,
  TRAPPIST1_DISTANCE_LY,
  centuriesFromJ2000,
  daysFromJ2000,
  evaluateIauOrientation,
  iauBodyAxesIcrf,
  icrfToSceneMatrixForBody,
  type EvaluatedIauAngles,
} from "../ephemeris";
import {
  bodyOrbitAboutSsb,
  catalogOrbitalParentId,
  heliocentricBodyOrbitAboutSsb,
  hillRadiusM,
  isStellarBarycenterFocusId,
  isSystemFocusId,
  orbitReferenceBarycenter,
  primaryHasBoundSatellites,
  satelliteOrbitAboutPlanetarySystem,
  solarSystemBarycenterFrame,
  stellarBarycenterFocusId,
  systemDisplayName,
  systemFocusIdForPrimary,
  systemOrbitAboutSsb,
  systemPrimaryId,
  type BarycenterFrame,
  type ClassicalOrbitalElements,
  type FocusId,
  type NbodyBody,
  type OrbitalParentMap,
  type OrbitAboutSsb,
  type SystemFocusId,
} from "../simulation";
import { moonsForPrimary } from "./bodyFocusGroups";
import { PanelCollapseButton } from "./PanelCollapseButton";

type OrbitTipSet = {
  a: string;
  e: string;
  i: string;
  O: string;
  w: string;
  nu: string;
  q: string;
  Q: string;
  r: string;
  speed: string;
  period: string;
};

const SYSTEM_ORBIT_TIPS: OrbitTipSet = {
  a: "Semimajor axis — half the long axis of the system’s orbit about the solar system’s center of mass.",
  e: "Eccentricity — elongation of the orbit; 0 is a circle, near 1 is a long thin ellipse, above 1 the path does not close.",
  i: "Inclination — tilt of the orbital plane relative to the solar system’s reference plane.",
  O: "Longitude of the ascending node — direction where the orbit crosses the reference plane heading north.",
  w: "Argument of periapsis — angle from the ascending node to the closest approach point.",
  nu: "True anomaly — current angle from the closest approach point.",
  q: "Periapsis distance — closest approach of the system to the solar system’s center of mass.",
  Q: "Apoapsis distance — farthest point of the system from the solar system’s center of mass.",
  r: "Radial distance — current distance from the solar system’s center of mass.",
  speed:
    "Orbital speed — current speed relative to the solar system’s center of mass.",
  period: "Orbital period — time for one full revolution on a closed orbit.",
};

const BODY_ORBIT_TIPS: OrbitTipSet = {
  a: "Semimajor axis — half the long axis of this object’s orbit about the solar system’s center of mass.",
  e: "Eccentricity — elongation of the orbit; 0 is a circle, near 1 is a long thin ellipse, above 1 the path does not close.",
  i: "Inclination — tilt of the orbital plane relative to the solar system’s reference plane.",
  O: "Longitude of the ascending node — direction where the orbit crosses the reference plane heading north.",
  w: "Argument of periapsis — angle from the ascending node to the closest approach point.",
  nu: "True anomaly — current angle from the closest approach point.",
  q: "Periapsis distance — closest approach of this object to the solar system’s center of mass.",
  Q: "Apoapsis distance — farthest point of this object from the solar system’s center of mass.",
  r: "Radial distance — current distance from the solar system’s center of mass.",
  speed:
    "Orbital speed — current speed relative to the solar system’s center of mass.",
  period: "Orbital period — time for one full revolution on a closed orbit.",
};

function moonOrbitTips(systemName: string): OrbitTipSet {
  const bary = `${systemName} barycenter`;
  return {
    a: `Semimajor axis — half the long axis of this object’s orbit about the ${bary}.`,
    e: "Eccentricity — elongation of the orbit; 0 is a circle, near 1 is a long thin ellipse, above 1 the path does not close.",
    i: `Inclination — tilt of the orbital plane relative to the ${systemName} reference plane.`,
    O: "Longitude of the ascending node — direction where the orbit crosses the reference plane heading north.",
    w: "Argument of periapsis — angle from the ascending node to the closest approach point.",
    nu: "True anomaly — current angle from the closest approach point.",
    q: `Periapsis distance — closest approach of this object to the ${bary}.`,
    Q: `Apoapsis distance — farthest point of this object from the ${bary}.`,
    r: `Radial distance — current distance from the ${bary}.`,
    speed: `Orbital speed — current speed relative to the ${bary}.`,
    period: "Orbital period — time for one full revolution on a closed orbit.",
  };
}

const SYSTEM_HILL_TIP =
  "Hill radius — defines the approximate region where the primary’s gravity dominates; moons well inside it stay bound.";

const SOLAR_SYSTEM_HILL_TIP =
  "Hill radius — defines the approximate region where the Sun’s gravity dominates relative to the galactic tide; smaller bodies well inside it stay bound.";

const BODY_HILL_TIP =
  "Hill radius — defines the approximate region where this object’s gravity dominates; smaller bodies well inside it stay bound.";

const PLANET_TYPES = new Set(["terrestrial-planet", "gas-giant", "ice-giant"]);

const ORIENTATION_TIPS = {
  alpha0:
    "North pole right ascension — east–west sky coordinate of the north pole.",
  delta0:
    "North pole declination — north–south sky coordinate of the north pole.",
  W: "Prime meridian angle — current spin orientation about the axis.",
  tilt: "Axial tilt — angle between the spin axis and the orbit’s north; above 90° means retrograde spin.",
  rotationPeriod:
    "Rotation period — time for one full rotation relative to distant stars.",
} as const;

type SelectionInfoPanelProps = {
  focusId: FocusId;
  availableBodyIds?: ReadonlySet<BodyId> | null;
  parentByBodyId?: OrbitalParentMap | null;
  /** Live body positions for Hill-radius heliocentric distance. */
  bodyPositions?: Partial<Record<BodyId, BodyPositionM>> | null;
  /** Live n-body particles; used for orbit elements about the SSB. */
  nbodyBodies?: readonly NbodyBody[] | null;
  /** Simulation Julian date for evaluating IAU orientation. */
  simJulianDate?: number | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

const RAD_TO_DEG = 180 / Math.PI;

function formatBodyType(body: BodyData): string {
  const type = body.type;
  if (!type) return "Unknown";
  if (type === "star") {
    if (body.spectralType) {
      return `${body.spectralType} star`;
    }
    return "Star";
  }
  return type
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sciParts(value: number): { coeff: string; exp: number } | null {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  const exp = Math.floor(Math.log10(value));
  const coeff = value / 10 ** exp;
  return { coeff: coeff.toFixed(2), exp };
}

function focusDisplayName(focusId: FocusId): string {
  if (isSystemFocusId(focusId)) return systemDisplayName(focusId);
  return BODIES[focusId]?.name ?? focusId;
}

/** Approximate solar Hill radius vs the galactic tide (~Oort-cloud scale). */
const SUN_HILL_RADIUS_AU = 230_000;
/**
 * Approximate Hill radius vs the galactic tide for nearby exoplanet systems
 * (TRAPPIST-1, HD 110067, …).
 */
const EXOPLANET_SYSTEM_HILL_RADIUS_AU = 75_000;
/** Approximate Hill radius vs the galactic tide for HD 110067. */
const HD110067_SYSTEM_HILL_RADIUS_AU = 141_000;
/** Approximate Hill radius vs the galactic tide for HD 10180. */
const HD10180_SYSTEM_HILL_RADIUS_AU = 155_000;
/** Approximate Hill radius vs the galactic tide for HD 219134. */
const HD219134_SYSTEM_HILL_RADIUS_AU = 140_000;
/** Approximate Hill radius vs the galactic tide for Kepler-90. */
const KEPLER90_SYSTEM_HILL_RADIUS_AU = 164_000;

function bodyHillRadiusM(
  bodyId: BodyId,
  bodyPositions: Partial<Record<BodyId, BodyPositionM>> | null | undefined,
): number | null {
  if (bodyId === "sun") return SUN_HILL_RADIUS_AU * AU_M;
  const body = BODIES[bodyId];
  const sun = BODIES.sun;
  const bodyPos = bodyPositions?.[bodyId];
  const sunPos = bodyPositions?.sun;
  if (!body || !sun || !bodyPos || !sunPos) return null;
  const a = Math.hypot(
    bodyPos.x - sunPos.x,
    bodyPos.y - sunPos.y,
    bodyPos.z - sunPos.z,
  );
  const rH = hillRadiusM(body.mass, a, sun.mass);
  return rH > 0 ? rH : null;
}

function formatAngleDeg(rad: number): string {
  return `${(rad * RAD_TO_DEG).toFixed(2)}°`;
}

function formatEccentricity(e: number): string {
  if (!(e >= 0) || !Number.isFinite(e)) return "—";
  if (e >= 10) return e.toExponential(2);
  if (e >= 1) return e.toFixed(3);
  if (e >= 0.01) return e.toFixed(4);
  return e.toFixed(6);
}

function formatSemiMajorAxis(meters: number): string {
  if (!Number.isFinite(meters)) {
    return meters === Number.POSITIVE_INFINITY ? "∞" : "—";
  }
  const sign = meters < 0 ? "−" : "";
  const abs = Math.abs(meters);
  const au = abs / AU_M;
  if (au >= 0.05) return `${sign}${au.toFixed(3)} AU`;
  const parts = sciParts(abs / 1000);
  if (!parts) return "—";
  return `${sign}${parts.coeff}×10${toSuperscript(parts.exp)} km`;
}

const SUPERScript_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

function toSuperscript(n: number): string {
  return n.toString().replace(/\d/g, (d) => SUPERScript_DIGITS[Number(d)] ?? d);
}

function formatOrbitalSpeed(metersPerSec: number): string {
  if (!(metersPerSec >= 0) || !Number.isFinite(metersPerSec)) return "—";
  const kmPerSec = metersPerSec / 1000;
  if (kmPerSec >= 100) return `${kmPerSec.toFixed(1)} km/s`;
  if (kmPerSec >= 10) return `${kmPerSec.toFixed(2)} km/s`;
  if (kmPerSec >= 1) return `${kmPerSec.toFixed(3)} km/s`;
  if (metersPerSec >= 1) return `${metersPerSec.toFixed(1)} m/s`;
  return `${metersPerSec.toFixed(3)} m/s`;
}

/** Sidereal period from osculating a and μ; null if unbound / invalid. */
function orbitalPeriodSeconds(
  elements: ClassicalOrbitalElements,
  mu: number,
): number | null {
  const a = elements.semiMajorAxisM;
  if (!(mu > 0) || !(a > 0) || !(elements.eccentricity < 1)) return null;
  if (!Number.isFinite(a)) return null;
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

function formatOrbitalPeriod(seconds: number | null): string {
  if (seconds == null || !(seconds > 0) || !Number.isFinite(seconds)) {
    return "—";
  }
  const hours = seconds / 3600;
  if (hours < 48) return `${hours.toFixed(2)} h`;
  const days = seconds / 86_400;
  if (days < 1000) return `${days.toFixed(2)} d`;
  const years = days / 365.25;
  if (years < 100) return `${years.toFixed(2)} y`;
  if (years < 10_000) return `${years.toFixed(1)} y`;
  return `${years.toLocaleString("en-US", { maximumFractionDigits: 0 })} y`;
}

/** Periapsis / apoapsis radii from osculating elements (m). */
function apoapsisDistancesM(elements: ClassicalOrbitalElements): {
  periapsisM: number;
  apoapsisM: number;
} {
  const e = elements.eccentricity;
  const p = elements.semiLatusRectumM;
  if (!(p > 0) || !(e >= 0) || !Number.isFinite(e)) {
    return {
      periapsisM: Number.NaN,
      apoapsisM: Number.NaN,
    };
  }
  const periapsisM = p / (1 + e);
  if (e < 1) {
    return { periapsisM, apoapsisM: p / (1 - e) };
  }
  return { periapsisM, apoapsisM: Number.POSITIVE_INFINITY };
}

function availableIdSet(
  availableBodyIds: ReadonlySet<BodyId> | null | undefined,
): ReadonlySet<BodyId> {
  return (
    availableBodyIds ?? new Set(BODY_CATALOG.map((body) => body.id as BodyId))
  );
}

/** True when the body is heliocentric with no bound satellites (ellipse about SSB). */
function isLoneHeliocentricBody(
  bodyId: BodyId,
  parentByBodyId: OrbitalParentMap | null | undefined,
  nbodyBodies: readonly NbodyBody[] | null | undefined,
  available: ReadonlySet<BodyId>,
): boolean {
  if (bodyId === "sun") return true;
  if (parentByBodyId?.get(bodyId) != null) return false;
  if (nbodyBodies?.length) {
    const body = nbodyBodies.find((entry) => entry.id === bodyId);
    if (!body || body.parentId != null) return false;
    return !primaryHasBoundSatellites(bodyId, nbodyBodies);
  }
  return moonsForPrimary(bodyId, available, parentByBodyId).length === 0;
}

type PlanetarySystemInfo = {
  kind: "planetary";
  primaryName: string;
  primaryType: string;
  moonCount: number;
  totalMassKg: number;
  hillRadiusM: number | null;
  orbit: OrbitAboutSsb | null;
};

type SolarSystemInfo = {
  kind: "solar";
  primaryName: string;
  primaryType: string;
  /** Heliocentric distance of the system (ly); omit for Sol. */
  distanceFromSunLy?: number;
  planetCount: number;
  /** Omit for systems with no dwarf-planet inventory (e.g. TRAPPIST-1). */
  dwarfPlanetCount?: number;
  totalMassKg: number;
  hillRadiusM: number | null;
};

type SystemInfo = PlanetarySystemInfo | SolarSystemInfo;

type BodyRadiiM = {
  radiusXM: number;
  radiusYM: number;
  radiusZM: number;
};

type BodyOrientationInfo = {
  angles: EvaluatedIauAngles;
  /** Obliquity of positive spin pole vs SSB orbital plane (deg), or null. */
  axialTiltDeg: number | null;
  /** Sidereal rotation period from IAU W rate (seconds), or null if unavailable. */
  rotationPeriodS: number | null;
};

type OrbitPanelContext =
  | { kind: "ssb" }
  | { kind: "planetary-system"; systemName: string };

type IndividualBodyInfo = {
  name: string;
  type: string;
  /** Heliocentric distance for extrasolar hosts (ly). */
  distanceFromSunLy?: number;
  massKg: number;
  /** Omit the Hill-radius row when `undefined`. */
  hillRadiusM: number | null | undefined;
  radii: BodyRadiiM;
  orbit: OrbitAboutSsb | null;
  orbitContext: OrbitPanelContext;
  orientation: BodyOrientationInfo | null;
};

function distanceFromSunLyForBody(bodyId: BodyId): number | undefined {
  if (bodyId === "trappist1") return TRAPPIST1_DISTANCE_LY;
  if (bodyId === "hd110067") return HD110067_DISTANCE_LY;
  if (bodyId === "hd10180") return HD10180_DISTANCE_LY;
  if (bodyId === "hd219134") return HD219134_DISTANCE_LY;
  if (bodyId === "kepler90") return KEPLER90_DISTANCE_LY;
  if (bodyId === "hd80606") return HD80606_DISTANCE_LY;
  if (bodyId === "hd80607") return HD80607_DISTANCE_LY;
  if (
    bodyId === "kepler16A" ||
    bodyId === "kepler16B" ||
    bodyId === "kepler16b"
  ) {
    return KEPLER16_DISTANCE_LY;
  }
  if (
    bodyId === "kepler47A" ||
    bodyId === "kepler47B" ||
    bodyId === "kepler47b" ||
    bodyId === "kepler47c" ||
    bodyId === "kepler47d"
  ) {
    return KEPLER47_DISTANCE_LY;
  }
  return undefined;
}

function DistanceFromSunField({ lightYears }: { lightYears: number }) {
  return (
    <p className="info-rail-primary-distance">
      <span className="info-rail-primary-distance-value">
        <span className="info-rail-sci-coeff">
          {lightYears.toLocaleString("en-US", {
            maximumFractionDigits: 2,
            minimumFractionDigits: 0,
          })}
        </span>
        <span className="info-rail-sci-unit">ly</span>
      </span>
      <span className="info-rail-primary-distance-caption">
        Distance from Sun
      </span>
    </p>
  );
}

function resolveOrbitalParentId(
  bodyId: BodyId,
  parentByBodyId: OrbitalParentMap | null | undefined,
): BodyId | null {
  if (parentByBodyId) return parentByBodyId.get(bodyId) ?? null;
  return catalogOrbitalParentId(bodyId);
}

/** Heliocentric primary that hosts a planetary system (Jupiter, Pluto, …). */
function isPlanetarySystemPrimary(
  bodyId: BodyId,
  parentByBodyId: OrbitalParentMap | null | undefined,
  nbodyBodies: readonly NbodyBody[] | null | undefined,
  available: ReadonlySet<BodyId>,
): boolean {
  if (bodyId === "sun") return false;
  if (resolveOrbitalParentId(bodyId, parentByBodyId) != null) return false;
  if (nbodyBodies?.length) {
    const body = nbodyBodies.find((entry) => entry.id === bodyId);
    if (!body || body.parentId != null) return false;
    return primaryHasBoundSatellites(bodyId, nbodyBodies);
  }
  return moonsForPrimary(bodyId, available, parentByBodyId).length > 0;
}

/** Parent id when `bodyId` is a moon in a catalog / live planetary system. */
function planetarySystemPrimaryForMoon(
  bodyId: BodyId,
  parentByBodyId: OrbitalParentMap | null | undefined,
  available: ReadonlySet<BodyId>,
): BodyId | null {
  const parentId = resolveOrbitalParentId(bodyId, parentByBodyId);
  if (!parentId) return null;
  if (moonsForPrimary(parentId, available, parentByBodyId).length === 0) {
    return null;
  }
  return parentId;
}

function availableBodiesTotalMassKg(available: ReadonlySet<BodyId>): number {
  let total = 0;
  for (const id of available) {
    const mass = BODIES[id]?.mass;
    if (mass != null && mass > 0) total += mass;
  }
  return total;
}

function stellarSystemIdForFocus(
  systemId: SystemFocusId,
): StellarSystemId | null {
  for (const id of Object.keys(STELLAR_SYSTEMS) as StellarSystemId[]) {
    if (stellarBarycenterFocusId(id) === systemId) return id;
  }
  return null;
}

function stellarSystemInfo(
  systemId: SystemFocusId,
  availableBodyIds: ReadonlySet<BodyId> | null | undefined,
  bodyPositions: Partial<Record<BodyId, BodyPositionM>> | null | undefined,
): SolarSystemInfo | null {
  const stellarId = stellarSystemIdForFocus(systemId);
  if (!stellarId) return null;
  const primaryId = STELLAR_SYSTEMS[stellarId].primaryBodyId;
  const primary = BODIES[primaryId];
  if (!primary) return null;
  const available = availableIdSet(availableBodyIds);
  let planetCount = 0;
  let dwarfPlanetCount = 0;
  for (const id of available) {
    const type = BODIES[id]?.type;
    if (!type) continue;
    if (PLANET_TYPES.has(type)) planetCount += 1;
    else if (type === "dwarf-planet") dwarfPlanetCount += 1;
  }

  return {
    kind: "solar",
    primaryName: primary.name,
    primaryType: formatBodyType(primary),
    ...(stellarId === "trappist-1"
      ? { distanceFromSunLy: TRAPPIST1_DISTANCE_LY }
      : stellarId === "hd-110067"
        ? { distanceFromSunLy: HD110067_DISTANCE_LY }
        : stellarId === "hd-10180"
          ? { distanceFromSunLy: HD10180_DISTANCE_LY }
          : stellarId === "hd-219134"
            ? { distanceFromSunLy: HD219134_DISTANCE_LY }
            : stellarId === "kepler-90"
              ? { distanceFromSunLy: KEPLER90_DISTANCE_LY }
              : stellarId === "hd-80606"
                ? { distanceFromSunLy: HD80606_SYSTEM_DISTANCE_LY }
                : stellarId === "kepler-16"
                  ? { distanceFromSunLy: KEPLER16_DISTANCE_LY }
                  : stellarId === "kepler-47"
                    ? { distanceFromSunLy: KEPLER47_DISTANCE_LY }
                    : {}),
    planetCount,
    ...(stellarId === "sol" ? { dwarfPlanetCount } : {}),
    totalMassKg: availableBodiesTotalMassKg(available),
    hillRadiusM:
      stellarId === "sol"
        ? bodyHillRadiusM("sun", bodyPositions)
        : STELLAR_SYSTEMS[stellarId].usesSpk
          ? null
          : (stellarId === "hd-110067"
              ? HD110067_SYSTEM_HILL_RADIUS_AU
              : stellarId === "hd-10180"
                ? HD10180_SYSTEM_HILL_RADIUS_AU
                : stellarId === "hd-219134"
                  ? HD219134_SYSTEM_HILL_RADIUS_AU
                  : stellarId === "kepler-90"
                    ? KEPLER90_SYSTEM_HILL_RADIUS_AU
                    : EXOPLANET_SYSTEM_HILL_RADIUS_AU) * AU_M,
  };
}

function planetarySystemInfo(
  systemId: SystemFocusId,
  availableBodyIds: ReadonlySet<BodyId> | null | undefined,
  parentByBodyId: OrbitalParentMap | null | undefined,
  bodyPositions: Partial<Record<BodyId, BodyPositionM>> | null | undefined,
  nbodyBodies: readonly NbodyBody[] | null | undefined,
): PlanetarySystemInfo | null {
  if (isStellarBarycenterFocusId(systemId)) return null;
  const primaryId = systemPrimaryId(systemId);
  if (!primaryId) return null;
  const primary = BODIES[primaryId];
  if (!primary) return null;

  const available = availableIdSet(availableBodyIds);
  const moons = moonsForPrimary(primaryId, available, parentByBodyId);
  let totalMassKg = primary.mass > 0 ? primary.mass : 0;
  for (const moon of moons) {
    if (moon.mass > 0) totalMassKg += moon.mass;
  }

  return {
    kind: "planetary",
    primaryName: primary.name,
    primaryType: formatBodyType(primary),
    moonCount: moons.length,
    totalMassKg,
    hillRadiusM: bodyHillRadiusM(primaryId, bodyPositions),
    orbit: nbodyBodies?.length
      ? systemOrbitAboutSsb(systemId, nbodyBodies)
      : null,
  };
}

function wrapDegrees360(deg: number): number {
  if (!Number.isFinite(deg)) return Number.NaN;
  return ((deg % 360) + 360) % 360;
}

function formatIauDegrees(deg: number): string {
  if (!Number.isFinite(deg)) return "—";
  return `${deg.toFixed(2)}°`;
}

/** Unit orbital angular-momentum direction in the scene / invariable frame. */
function bodyOrbitPoleInFrame(
  bodyId: BodyId,
  nbodyBodies: readonly NbodyBody[] | null | undefined,
  frame: BarycenterFrame | null,
): Vector3 | null {
  if (!nbodyBodies?.length || !frame) return null;
  const body = nbodyBodies.find((entry) => entry.id === bodyId);
  if (!body) return null;
  const r = new Vector3(
    body.state.positionM.x - frame.positionM.x,
    body.state.positionM.y - frame.positionM.y,
    body.state.positionM.z - frame.positionM.z,
  );
  const v = new Vector3(
    body.state.velocityMS.x - frame.velocityMS.x,
    body.state.velocityMS.y - frame.velocityMS.y,
    body.state.velocityMS.z - frame.velocityMS.z,
  );
  const pole = new Vector3().crossVectors(r, v);
  if (pole.lengthSq() < 1e-24) return null;
  return pole.normalize();
}

function orbitReferenceFrameForBody(
  bodyId: BodyId,
  nbodyBodies: readonly NbodyBody[] | null | undefined,
  orbitContext: OrbitPanelContext,
): BarycenterFrame | null {
  if (!nbodyBodies?.length) return null;
  if (orbitContext.kind === "ssb") {
    return solarSystemBarycenterFrame(nbodyBodies);
  }
  const body = nbodyBodies.find((entry) => entry.id === bodyId);
  if (!body) return null;
  const ref = orbitReferenceBarycenter(body, nbodyBodies);
  return ref;
}

/** Mean dW/dd from the IAU prime-meridian series (deg/day; sign indicates sense). */
function iauPrimeMeridianRateDegPerDay(
  model: IauOrientationModel,
  d: number,
): number {
  const series = model.primeMeridian;
  return (series.perDay ?? 0) + 2 * (series.perDaySquared ?? 0) * d;
}

/**
 * Angle between the positive (right-hand-rule) spin pole and the orbital pole
 * (degrees, 0–180). Starts from the IAU north pole vs orbit; when W decreases
 * with time the positive pole is opposite, so the tilt is 180° − ε_IAU.
 */
function axialTiltFromIauDeg(
  angles: EvaluatedIauAngles,
  orbitPoleScene: Vector3 | null,
  wDotDegPerDay: number,
  icrfToScene: Matrix3,
): number | null {
  if (!orbitPoleScene) return null;
  const spinIcrf = iauBodyAxesIcrf(
    angles.alpha0Deg,
    angles.delta0Deg,
    angles.wDeg,
  ).z;
  const spinScene = spinIcrf.clone().applyMatrix3(icrfToScene).normalize();
  const cos = Math.min(1, Math.max(-1, spinScene.dot(orbitPoleScene)));
  const tiltIauDeg = Math.acos(cos) * RAD_TO_DEG;
  if (!(wDotDegPerDay < 0)) return tiltIauDeg;
  return 180 - tiltIauDeg;
}

/**
 * Sidereal rotation period from the mean IAU W rate (seconds).
 * Uses |dW/dd|; ignores periodic terms.
 */
function siderealRotationPeriodSeconds(wDotDegPerDay: number): number | null {
  const absRate = Math.abs(wDotDegPerDay);
  if (!(absRate > 0) || !Number.isFinite(absRate)) return null;
  return (360 / absRate) * 86_400;
}

function bodyOrientationInfo(
  body: BodyData,
  bodyId: BodyId,
  simJulianDate: number | null | undefined,
  nbodyBodies: readonly NbodyBody[] | null | undefined,
  orbitContext: OrbitPanelContext,
): BodyOrientationInfo | null {
  if (simJulianDate == null || !Number.isFinite(simJulianDate)) return null;
  if (!body.iauOrientation) return null;
  const d = daysFromJ2000(simJulianDate);
  const T = centuriesFromJ2000(simJulianDate);
  const angles = evaluateIauOrientation(body.iauOrientation, d, T);
  const wDotDegPerDay = iauPrimeMeridianRateDegPerDay(body.iauOrientation, d);
  const orbitFrame = orbitReferenceFrameForBody(
    bodyId,
    nbodyBodies,
    orbitContext,
  );
  return {
    angles,
    axialTiltDeg: axialTiltFromIauDeg(
      angles,
      bodyOrbitPoleInFrame(bodyId, nbodyBodies, orbitFrame),
      wDotDegPerDay,
      icrfToSceneMatrixForBody(body),
    ),
    rotationPeriodS: siderealRotationPeriodSeconds(wDotDegPerDay),
  };
}

function individualBodyInfoFromCatalog(
  bodyId: BodyId,
  available: ReadonlySet<BodyId>,
): Pick<IndividualBodyInfo, "name" | "type" | "massKg" | "radii"> | null {
  if (!available.has(bodyId)) return null;
  const body = BODIES[bodyId];
  if (!body) return null;
  return {
    name: body.name,
    type: formatBodyType(body),
    massKg: body.mass > 0 ? body.mass : 0,
    radii: {
      radiusXM: body.radiusXM,
      radiusYM: body.radiusYM,
      radiusZM: body.radiusZM,
    },
  };
}

function heliocentricBodyInfo(
  bodyId: BodyId,
  availableBodyIds: ReadonlySet<BodyId> | null | undefined,
  parentByBodyId: OrbitalParentMap | null | undefined,
  bodyPositions: Partial<Record<BodyId, BodyPositionM>> | null | undefined,
  nbodyBodies: readonly NbodyBody[] | null | undefined,
  simJulianDate: number | null | undefined,
): IndividualBodyInfo | null {
  const available = availableIdSet(availableBodyIds);
  if (!isLoneHeliocentricBody(bodyId, parentByBodyId, nbodyBodies, available)) {
    return null;
  }
  const base = individualBodyInfoFromCatalog(bodyId, available);
  if (!base) return null;
  const body = BODIES[bodyId]!;

  const orbitContext: OrbitPanelContext = { kind: "ssb" };
  return {
    ...base,
    distanceFromSunLy: distanceFromSunLyForBody(bodyId),
    hillRadiusM: bodyHillRadiusM(bodyId, bodyPositions),
    orbit: nbodyBodies?.length ? bodyOrbitAboutSsb(bodyId, nbodyBodies) : null,
    orbitContext,
    orientation: bodyOrientationInfo(
      body,
      bodyId,
      simJulianDate,
      nbodyBodies,
      orbitContext,
    ),
  };
}

function planetarySystemMemberBodyInfo(
  bodyId: BodyId,
  availableBodyIds: ReadonlySet<BodyId> | null | undefined,
  parentByBodyId: OrbitalParentMap | null | undefined,
  bodyPositions: Partial<Record<BodyId, BodyPositionM>> | null | undefined,
  nbodyBodies: readonly NbodyBody[] | null | undefined,
  simJulianDate: number | null | undefined,
): IndividualBodyInfo | null {
  const available = availableIdSet(availableBodyIds);
  const primaryId = planetarySystemPrimaryForMoon(
    bodyId,
    parentByBodyId,
    available,
  );
  const isPrimary = isPlanetarySystemPrimary(
    bodyId,
    parentByBodyId,
    nbodyBodies,
    available,
  );
  if (!primaryId && !isPrimary) return null;

  const base = individualBodyInfoFromCatalog(bodyId, available);
  if (!base) return null;
  const body = BODIES[bodyId]!;

  if (isPrimary) {
    const orbitContext: OrbitPanelContext = { kind: "ssb" };
    return {
      ...base,
      hillRadiusM: bodyHillRadiusM(bodyId, bodyPositions),
      orbit: nbodyBodies?.length
        ? heliocentricBodyOrbitAboutSsb(bodyId, nbodyBodies)
        : null,
      orbitContext,
      orientation: bodyOrientationInfo(
        body,
        bodyId,
        simJulianDate,
        nbodyBodies,
        orbitContext,
      ),
    };
  }

  const systemName = systemDisplayName(systemFocusIdForPrimary(primaryId!));
  const orbitContext: OrbitPanelContext = {
    kind: "planetary-system",
    systemName,
  };
  return {
    ...base,
    hillRadiusM: undefined,
    orbit: nbodyBodies?.length
      ? satelliteOrbitAboutPlanetarySystem(bodyId, nbodyBodies)
      : null,
    orbitContext,
    orientation: bodyOrientationInfo(
      body,
      bodyId,
      simJulianDate,
      nbodyBodies,
      orbitContext,
    ),
  };
}

/** True when the body is an axisymmetric spheroid (equal equatorial radii). */
function hasEqualEquatorialRadii(radii: BodyRadiiM): boolean {
  const a = Math.max(radii.radiusXM, radii.radiusYM);
  if (!(a > 0)) return true;
  return Math.abs(radii.radiusXM - radii.radiusYM) <= 1e-9 * a;
}

/** Volumetric mean radius of a triaxial ellipsoid. */
function meanEllipsoidRadiusM(radii: BodyRadiiM): number {
  const { radiusXM: a, radiusYM: b, radiusZM: c } = radii;
  if (!(a > 0) || !(b > 0) || !(c > 0)) return Number.NaN;
  return Math.cbrt(a * b * c);
}

function formatBodyLengthM(meters: number): string {
  if (!(meters > 0) || !Number.isFinite(meters)) return "—";
  const km = meters / 1000;
  if (km >= 1000)
    return `${km.toLocaleString("en-US", { maximumFractionDigits: 0 })} km`;
  if (km >= 100) return `${km.toFixed(1)} km`;
  if (km >= 10) return `${km.toFixed(2)} km`;
  if (km >= 1) return `${km.toFixed(3)} km`;
  if (meters >= 1) return `${meters.toFixed(0)} m`;
  return `${meters.toFixed(2)} m`;
}

function formatFlattening(f: number): string {
  if (!Number.isFinite(f) || f < 0) return "—";
  if (f === 0) return "0";
  if (f >= 0.1) return f.toFixed(4);
  if (f >= 0.001) return f.toFixed(6);
  return f.toExponential(2);
}

function SciFigure({ value, unit }: { value: number; unit: string }) {
  const parts = sciParts(value);
  if (!parts) {
    return <span className="info-rail-metric-figure">—</span>;
  }
  return (
    <span className="info-rail-metric-figure info-rail-sci-figure">
      <span className="info-rail-sci-coeff">{parts.coeff}</span>
      <span className="info-rail-sci-exp">
        ×10<sup>{parts.exp}</sup>
      </span>
      <span className="info-rail-sci-unit">{unit}</span>
    </span>
  );
}

function formatAu(au: number): string {
  if (au >= 1000) {
    return au.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  if (au >= 1) return au.toFixed(3);
  return au.toFixed(3);
}

function DistanceFigure({ meters }: { meters: number | null }) {
  if (meters == null || !(meters > 0)) {
    return <span className="info-rail-metric-figure">—</span>;
  }
  const au = meters / AU_M;
  if (au >= 0.05) {
    return (
      <span className="info-rail-metric-figure info-rail-sci-figure">
        <span className="info-rail-sci-coeff">{formatAu(au)}</span>
        <span className="info-rail-sci-unit">AU</span>
      </span>
    );
  }
  return <SciFigure value={meters / 1000} unit="km" />;
}

const TIP_MAX_WIDTH_PX = 288;
const TIP_GAP_PX = 8;
const TIP_VIEWPORT_PAD_PX = 8;

function FloatingTipLabel({
  className,
  tip,
  children,
}: {
  className?: string;
  tip: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const placeTip = () => {
    const trigger = triggerRef.current;
    const bubble = tipRef.current;
    if (!trigger || !bubble) return;
    const tr = trigger.getBoundingClientRect();
    const br = bubble.getBoundingClientRect();
    const tipW = br.width || Math.min(TIP_MAX_WIDTH_PX, window.innerWidth - 16);
    const tipH = br.height || 0;

    let left = tr.left;
    left = Math.min(left, window.innerWidth - tipW - TIP_VIEWPORT_PAD_PX);
    left = Math.max(TIP_VIEWPORT_PAD_PX, left);

    let top = tr.bottom + TIP_GAP_PX;
    if (top + tipH > window.innerHeight - TIP_VIEWPORT_PAD_PX) {
      top = tr.top - tipH - TIP_GAP_PX;
    }
    top = Math.max(TIP_VIEWPORT_PAD_PX, top);

    setCoords({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    placeTip();
    const onReposition = () => placeTip();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, tip]);

  return (
    <>
      <span
        ref={triggerRef}
        className={"info-rail-tip-trigger" + (className ? ` ${className}` : "")}
        aria-label={tip}
        tabIndex={0}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <span
              ref={tipRef}
              className="hud-floating-tip"
              style={{ top: coords.top, left: coords.left }}
              role="tooltip"
            >
              {tip}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

function OrbitElement({
  symbol,
  value,
  tip,
}: {
  symbol: string;
  value: string;
  tip: string;
}) {
  return (
    <div className="info-rail-orbit-el">
      <FloatingTipLabel className="info-rail-orbit-symbol" tip={tip}>
        {symbol}
      </FloatingTipLabel>
      <span className="info-rail-orbit-value">{value}</span>
    </div>
  );
}

function orbitSectionSubtitle(context: OrbitPanelContext): string {
  if (context.kind === "ssb") return "About solar system barycenter";
  return `About ${context.systemName} barycenter`;
}

function orbitSectionTips(context: OrbitPanelContext): OrbitTipSet {
  if (context.kind === "ssb") return BODY_ORBIT_TIPS;
  return moonOrbitTips(context.systemName);
}

function OrbitSection({
  orbit,
  context,
  tips,
}: {
  orbit: OrbitAboutSsb | null;
  context: OrbitPanelContext;
  tips?: OrbitTipSet;
}) {
  const tipSet = tips ?? orbitSectionTips(context);
  const extrema = orbit ? apoapsisDistancesM(orbit.elements) : null;

  return (
    <section
      className="info-rail-orbit"
      aria-label={orbitSectionSubtitle(context)}
    >
      <header className="info-rail-orbit-header">
        <h3 className="info-rail-orbit-title">Orbit</h3>
        <p className="info-rail-orbit-subtitle">
          {orbitSectionSubtitle(context)}
        </p>
      </header>
      {orbit && extrema ? (
        <>
          <div className="info-rail-orbit-grid">
            <OrbitElement
              symbol="a"
              value={formatSemiMajorAxis(orbit.elements.semiMajorAxisM)}
              tip={tipSet.a}
            />
            <OrbitElement
              symbol="e"
              value={formatEccentricity(orbit.elements.eccentricity)}
              tip={tipSet.e}
            />
            <OrbitElement
              symbol="i"
              value={formatAngleDeg(orbit.elements.inclinationRad)}
              tip={tipSet.i}
            />
            <OrbitElement
              symbol="Ω"
              value={formatAngleDeg(orbit.elements.raanRad)}
              tip={tipSet.O}
            />
            <OrbitElement
              symbol="ω"
              value={formatAngleDeg(orbit.elements.argPeriapsisRad)}
              tip={tipSet.w}
            />
            <OrbitElement
              symbol="ν"
              value={formatAngleDeg(orbit.elements.trueAnomalyRad)}
              tip={tipSet.nu}
            />
          </div>
          <div className="info-rail-orbit-state">
            <OrbitElement
              symbol="q"
              value={formatSemiMajorAxis(extrema.periapsisM)}
              tip={tipSet.q}
            />
            <OrbitElement
              symbol="Q"
              value={formatSemiMajorAxis(extrema.apoapsisM)}
              tip={tipSet.Q}
            />
          </div>
          <div className="info-rail-orbit-state">
            <OrbitElement
              symbol="r"
              value={formatSemiMajorAxis(orbit.radiusM)}
              tip={tipSet.r}
            />
            <OrbitElement
              symbol="v"
              value={formatOrbitalSpeed(orbit.orbitalSpeedMS)}
              tip={tipSet.speed}
            />
          </div>
          <div className="info-rail-orbit-state">
            <OrbitElement
              symbol="P"
              value={formatOrbitalPeriod(
                orbitalPeriodSeconds(orbit.elements, orbit.mu),
              )}
              tip={tipSet.period}
            />
          </div>
        </>
      ) : (
        <p className="info-rail-orbit-empty">Orbit elements unavailable</p>
      )}
    </section>
  );
}

function OrientationSection({
  orientation,
}: {
  orientation: BodyOrientationInfo | null;
}) {
  return (
    <section className="info-rail-orbit" aria-label="IAU orientation">
      <header className="info-rail-orbit-header">
        <h3 className="info-rail-orbit-title">Orientation</h3>
        <p className="info-rail-orbit-subtitle">IAU WGCCRE at current epoch</p>
      </header>
      {orientation ? (
        <>
          <div className="info-rail-orbit-grid">
            <OrbitElement
              symbol="α₀"
              value={formatIauDegrees(orientation.angles.alpha0Deg)}
              tip={ORIENTATION_TIPS.alpha0}
            />
            <OrbitElement
              symbol="δ₀"
              value={formatIauDegrees(orientation.angles.delta0Deg)}
              tip={ORIENTATION_TIPS.delta0}
            />
            <OrbitElement
              symbol="W"
              value={formatIauDegrees(wrapDegrees360(orientation.angles.wDeg))}
              tip={ORIENTATION_TIPS.W}
            />
          </div>
          <div className="info-rail-orbit-state">
            <OrbitElement
              symbol="ε"
              value={
                orientation.axialTiltDeg != null
                  ? formatIauDegrees(orientation.axialTiltDeg)
                  : "—"
              }
              tip={ORIENTATION_TIPS.tilt}
            />
            <OrbitElement
              symbol="Pᵣ"
              value={formatOrbitalPeriod(orientation.rotationPeriodS)}
              tip={ORIENTATION_TIPS.rotationPeriod}
            />
          </div>
        </>
      ) : (
        <p className="info-rail-orbit-empty">Orientation unavailable</p>
      )}
    </section>
  );
}

function SystemDetails({ info }: { info: SystemInfo }) {
  const planetLabel =
    info.kind === "solar" && info.planetCount === 1
      ? "known planet"
      : "known planets";
  const dwarfCount = info.kind === "solar" ? info.dwarfPlanetCount : undefined;
  const dwarfLabel =
    dwarfCount === 1 ? "known dwarf planet" : "known dwarf planets";
  const moonLabel =
    info.kind === "planetary" && info.moonCount === 1
      ? "known moon"
      : "known moons";

  return (
    <div className="info-rail-system">
      <div className="info-rail-primary">
        <p className="info-rail-primary-caption">Primary body</p>
        <p className="info-rail-primary-name">{info.primaryName}</p>
        <p className="info-rail-primary-type">{info.primaryType}</p>
        {info.kind === "solar" && info.distanceFromSunLy != null ? (
          <DistanceFromSunField lightYears={info.distanceFromSunLy} />
        ) : null}
      </div>

      <div className="info-rail-metrics">
        {info.kind === "solar" ? (
          <>
            <p className="info-rail-metric">
              <span className="info-rail-metric-figure">
                {info.planetCount}
              </span>
              <span className="info-rail-metric-caption">{planetLabel}</span>
            </p>
            {dwarfCount != null ? (
              <p className="info-rail-metric">
                <span className="info-rail-metric-figure">{dwarfCount}</span>
                <span className="info-rail-metric-caption">{dwarfLabel}</span>
              </p>
            ) : null}
          </>
        ) : (
          <p className="info-rail-metric">
            <span className="info-rail-metric-figure">{info.moonCount}</span>
            <span className="info-rail-metric-caption">{moonLabel}</span>
          </p>
        )}
        <p className="info-rail-metric">
          <SciFigure value={info.totalMassKg} unit="kg" />
          <span className="info-rail-metric-caption">total mass</span>
        </p>
        <p className="info-rail-metric">
          <DistanceFigure meters={info.hillRadiusM} />
          <FloatingTipLabel
            className="info-rail-metric-caption"
            tip={
              info.kind === "solar" ? SOLAR_SYSTEM_HILL_TIP : SYSTEM_HILL_TIP
            }
          >
            Hill radius
          </FloatingTipLabel>
        </p>
      </div>

      {info.kind === "planetary" ? (
        <OrbitSection
          orbit={info.orbit}
          context={{ kind: "ssb" }}
          tips={SYSTEM_ORBIT_TIPS}
        />
      ) : null}
    </div>
  );
}

function BodyDimensionsSection({ radii }: { radii: BodyRadiiM }) {
  if (hasEqualEquatorialRadii(radii)) {
    const equatorialRadiusM = radii.radiusXM;
    const polarRadiusM = radii.radiusZM;
    const flattening =
      equatorialRadiusM > 0
        ? (equatorialRadiusM - polarRadiusM) / equatorialRadiusM
        : Number.NaN;
    return (
      <section className="info-rail-dimensions" aria-label="Dimensions">
        <div className="info-rail-metrics">
          <p className="info-rail-metric">
            <span className="info-rail-metric-figure info-rail-length-figure">
              {formatBodyLengthM(2 * equatorialRadiusM)}
            </span>
            <span className="info-rail-metric-caption">
              equatorial diameter
            </span>
          </p>
          <p className="info-rail-metric">
            <span className="info-rail-metric-figure info-rail-length-figure">
              {formatFlattening(flattening)}
            </span>
            <FloatingTipLabel
              className="info-rail-metric-caption"
              tip="Flattening — how much flatter the poles are than the equator. 0 is a perfect sphere."
            >
              flattening
            </FloatingTipLabel>
          </p>
        </div>
      </section>
    );
  }

  const meanDiameterM = 2 * meanEllipsoidRadiusM(radii);
  return (
    <section className="info-rail-dimensions" aria-label="Dimensions">
      <details className="info-rail-axis-details">
        <summary className="info-rail-axis-summary">
          <span className="info-rail-axis-summary-main">
            <span className="info-rail-metric-figure info-rail-length-figure">
              {formatBodyLengthM(meanDiameterM)}
            </span>
            <span className="info-rail-metric-caption">mean diameter</span>
          </span>
        </summary>
        <ul className="info-rail-axis-list">
          <li>
            <span className="info-rail-axis-label">X</span>
            <span className="info-rail-axis-value">
              {formatBodyLengthM(2 * radii.radiusXM)}
            </span>
          </li>
          <li>
            <span className="info-rail-axis-label">Y</span>
            <span className="info-rail-axis-value">
              {formatBodyLengthM(2 * radii.radiusYM)}
            </span>
          </li>
          <li>
            <span className="info-rail-axis-label">Z</span>
            <span className="info-rail-axis-value">
              {formatBodyLengthM(2 * radii.radiusZM)}
            </span>
          </li>
        </ul>
      </details>
    </section>
  );
}

function IndividualBodyDetails({ info }: { info: IndividualBodyInfo }) {
  return (
    <div className="info-rail-system is-body-focus">
      <div className="info-rail-primary">
        <p className="info-rail-primary-name">{info.name}</p>
        <p className="info-rail-primary-type">{info.type}</p>
        {info.distanceFromSunLy != null ? (
          <DistanceFromSunField lightYears={info.distanceFromSunLy} />
        ) : null}
      </div>

      <div className="info-rail-metrics">
        <p className="info-rail-metric">
          <SciFigure value={info.massKg} unit="kg" />
          <span className="info-rail-metric-caption">mass</span>
        </p>
        {info.hillRadiusM !== undefined && info.hillRadiusM != null ? (
          <p className="info-rail-metric">
            <DistanceFigure meters={info.hillRadiusM} />
            <FloatingTipLabel
              className="info-rail-metric-caption"
              tip={BODY_HILL_TIP}
            >
              Hill radius
            </FloatingTipLabel>
          </p>
        ) : null}
      </div>

      <BodyDimensionsSection radii={info.radii} />

      <OrbitSection orbit={info.orbit} context={info.orbitContext} />
      <OrientationSection orientation={info.orientation} />
    </div>
  );
}

export function SelectionInfoPanel({
  focusId,
  availableBodyIds = null,
  parentByBodyId = null,
  bodyPositions = null,
  nbodyBodies = null,
  simJulianDate = null,
  collapsed,
  onToggleCollapsed,
}: SelectionInfoPanelProps) {
  const title = focusDisplayName(focusId);
  const systemInfo: SystemInfo | null = isSystemFocusId(focusId)
    ? isStellarBarycenterFocusId(focusId)
      ? stellarSystemInfo(focusId, availableBodyIds, bodyPositions)
      : planetarySystemInfo(
          focusId,
          availableBodyIds,
          parentByBodyId,
          bodyPositions,
          nbodyBodies,
        )
    : null;
  const bodyInfo =
    !systemInfo && !isSystemFocusId(focusId)
      ? (heliocentricBodyInfo(
          focusId,
          availableBodyIds,
          parentByBodyId,
          bodyPositions,
          nbodyBodies,
          simJulianDate,
        ) ??
        planetarySystemMemberBodyInfo(
          focusId,
          availableBodyIds,
          parentByBodyId,
          bodyPositions,
          nbodyBodies,
          simJulianDate,
        ))
      : null;

  return (
    <div className={"info-rail-shell" + (collapsed ? " is-collapsed" : "")}>
      <aside
        className={"info-rail" + (collapsed ? " is-collapsed" : "")}
        aria-label="Selection details"
      >
        <PanelCollapseButton
          side="right"
          collapsed={collapsed}
          onToggle={onToggleCollapsed}
          label="info panel"
        />
        <div
          className="info-rail-body"
          aria-hidden={collapsed}
          inert={collapsed || undefined}
        >
          {bodyInfo ? null : (
            <header className="info-rail-header">
              <h2 className="info-rail-title">{title}</h2>
            </header>
          )}
          {systemInfo ? <SystemDetails info={systemInfo} /> : null}
          {bodyInfo ? <IndividualBodyDetails info={bodyInfo} /> : null}
        </div>
      </aside>
    </div>
  );
}
