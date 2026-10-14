import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Sprite,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BODIES,
  DEFAULT_STELLAR_SYSTEM_ID,
  STELLAR_SYSTEMS,
  bodiesForStellarSystem,
  bodyIdsForStellarSystem,
  hydrateBodiesFromApi,
  primaryStarBody,
  primaryStarId,
  simSpeedMaxSeconds,
  type BodyId,
  type BodyPositionM,
  type StellarSystemId,
} from "./data";
import {
  buildErrorReport,
  centuriesFromJ2000,
  dateToJulianDate,
  daysFromJ2000,
  evaluateIauOrientation,
  fetchAllSpkStates,
  formatDatetimeLocal,
  formatSimDatetime,
  heliocentricOrbitalPole,
  initTidalLockRuntimes,
  julianDateToDate,
  orientationQuaternionForBody,
  parseDatetimeLocal,
  stepTidalLockOrientation,
  bodyStateFromKeplerianElements,
  transformStateToInvariable,
  type BodyState,
  type ErrorReport,
  type TidalLockRuntime,
} from "./ephemeris";
import { createSunBloomComposers } from "./scene/bloom";
import { attachBodyLabels, type BodyLabels } from "./scene/bodyLabels";
import {
  attachBodyOrbits,
  orbitBodyIds,
  type BodyOrbits,
  type OrbitId,
} from "./scene/orbitEllipses";
import {
  attachSolScaleReferenceOrbit,
  solPlanetHeliocentricElementsAtEpoch,
  solScaleReferenceBodyId,
  type SolScaleReferenceOrbit,
} from "./scene/solScaleReferenceOrbit";
import {
  CAMERA_FAR_M,
  CAMERA_HORIZONTAL_FOV_DEG,
  CAMERA_LOG_ZOOM_SPEED,
  CAMERA_MAX_DISTANCE_M,
  INVARIABLE_UP,
  STARLIGHT_AMBIENT_COLOR,
  STARLIGHT_AMBIENT_INTENSITY,
} from "./scene/constants";
import {
  addAllBodies,
  setBodyOrientation,
  sunOuterGlowRadiusM,
} from "./scene/createBody";
import { addSkybox } from "./scene/skybox";
import {
  starBloomStrength,
  starColorHex,
  starLightIntensity,
  starLightReferenceDistanceM,
} from "./scene/starEffects";
import {
  applyStarLightAppearance,
  configureRendererShadows,
  createSunDirectionalLight,
  updateSunDirectionalLight,
} from "./scene/sunLight";
import { collectTextures, initTextures } from "./scene/textures";
import {
  collectCullables,
  collectDisplacementStates,
  cullingRadiusM,
  updateBodyVisibility,
  type BodyVisibilityEntry,
} from "./scene/visibility";
import {
  allTagFocusIds,
  catalogOrbitalParentId,
  createNbodySystem,
  defaultPlanetarySystemVisibleIds,
  bodyOrbitScaleAboutSystemM,
  furthestSystemOrbitScaleM,
  hierarchyFingerprint,
  isSystemFocusId,
  orbitalParentMapFromBodies,
  planetarySystemFocusIdsFromParents,
  isStellarBarycenterFocusId,
  parkStarAtBarycenter,
  solarSystemBarycenterFrame,
  stepNbody,
  systemBarycenterPosition,
  systemMemberBodies,
  systemPrimaryId,
  updateOrbitalParents,
  type FocusId,
  type NbodyBody,
  type OrbitalParentMap,
  type SystemFocusId,
} from "./simulation";
import { tagOrbitIdsForFocus } from "./ui/bodyFocusGroups";
import { BodyFocusPicker } from "./ui/BodyFocusPicker";
import { ErrorReportModal } from "./ui/ErrorReportModal";
import { PanelCollapseButton } from "./ui/PanelCollapseButton";
import { SelectionInfoPanel } from "./ui/SelectionInfoPanel";

const INITIAL_FOCUS: FocusId = STELLAR_SYSTEMS[DEFAULT_STELLAR_SYSTEM_ID]
  .defaultFocusId as FocusId;
/** Starting distance as a multiple of the focused body's max radius. */
const INITIAL_DISTANCE_RADIUS_FACTOR = 3;
/** System focus: camera distance = this × outermost member semimajor axis. */
const SYSTEM_FOCUS_DISTANCE_FACTOR = 3;
/** Solar-system focus uses this body's semimajor axis (× {@link SYSTEM_FOCUS_DISTANCE_FACTOR}). */
const SOLAR_SYSTEM_FOCUS_SCALE_BODY: BodyId = "eris";
/** System focus: elevation above the invariable-plane default (deg). */
const SYSTEM_FOCUS_ELEVATION_DEG = 30;
/** Clockwise azimuth offset (deg) for Sun / heliocentric bodies. */
const HELIOCENTRIC_CAMERA_AZIMUTH_OFFSET_DEG = 45;
/** Azimuth offset (deg) from parent→moon; sign chosen toward the origin. */
const MOON_CAMERA_AZIMUTH_OFFSET_DEG = 30;

/** Rotate a 2D vector clockwise by `deg` (viewed from +Z). */
function rotateClockwiseXy(
  x: number,
  y: number,
  deg: number,
): { x: number; y: number } {
  const rad = MathUtils.degToRad(deg);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c + y * s, y: -x * s + y * c };
}

/**
 * Unit offset in the x–y plane for the default focus camera:
 * heliocentric — 45° CW from object→origin;
 * moon — ±30° from parent→object, picking the side closer to the origin.
 */
function defaultFocusOffsetXy(
  position: BodyPositionM,
  parentPosition: BodyPositionM | null,
  distanceM: number,
): { x: number; y: number } {
  let dx: number;
  let dy: number;
  if (parentPosition) {
    dx = position.x - parentPosition.x;
    dy = position.y - parentPosition.y;
  } else {
    dx = -position.x;
    dy = -position.y;
  }
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }

  if (!parentPosition) {
    return rotateClockwiseXy(dx, dy, HELIOCENTRIC_CAMERA_AZIMUTH_OFFSET_DEG);
  }

  const cw = rotateClockwiseXy(dx, dy, MOON_CAMERA_AZIMUTH_OFFSET_DEG);
  const ccw = rotateClockwiseXy(dx, dy, -MOON_CAMERA_AZIMUTH_OFFSET_DEG);
  const distCw = Math.hypot(
    position.x + cw.x * distanceM,
    position.y + cw.y * distanceM,
  );
  const distCcw = Math.hypot(
    position.x + ccw.x * distanceM,
    position.y + ccw.y * distanceM,
  );
  return distCw <= distCcw ? cw : ccw;
}

/** Realtime: 1 simulated second per wall-clock second. */
const SIM_SPEED_MIN_S = 1;
const SIM_SPEED_LOG_MIN = Math.log(SIM_SPEED_MIN_S);

type SpeedUnit = "s" | "m" | "h" | "d" | "y";

const SPEED_UNITS: { id: SpeedUnit; label: string; seconds: number }[] = [
  { id: "s", label: "s/s", seconds: 1 },
  { id: "m", label: "m/s", seconds: 60 },
  { id: "h", label: "h/s", seconds: 3_600 },
  { id: "d", label: "d/s", seconds: 86_400 },
  { id: "y", label: "y/s", seconds: 365.25 * 86_400 },
];

const SPEED_UNIT_SECONDS: Record<SpeedUnit, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  y: 365.25 * 86_400,
};

/** Map a 0…1 slider position to simulated seconds per wall-clock second (log scale). */
function simSpeedFromSlider(t01: number, maxSeconds: number): number {
  const t = Math.min(1, Math.max(0, t01));
  const logMax = Math.log(Math.max(maxSeconds, SIM_SPEED_MIN_S));
  return Math.exp(SIM_SPEED_LOG_MIN + t * (logMax - SIM_SPEED_LOG_MIN));
}

/** Inverse of `simSpeedFromSlider`, clamped to the slider range. */
function sliderFromSimSpeed(
  simSecondsPerRealSecond: number,
  maxSeconds: number,
): number {
  const maxS = Math.max(maxSeconds, SIM_SPEED_MIN_S);
  const clamped = Math.min(
    maxS,
    Math.max(SIM_SPEED_MIN_S, simSecondsPerRealSecond),
  );
  const logMax = Math.log(maxS);
  return (Math.log(clamped) - SIM_SPEED_LOG_MIN) / (logMax - SIM_SPEED_LOG_MIN);
}

function simSpeedToUnit(
  simSecondsPerRealSecond: number,
  unit: SpeedUnit,
): number {
  return simSecondsPerRealSecond / SPEED_UNIT_SECONDS[unit];
}

function unitToSimSpeed(value: number, unit: SpeedUnit): number {
  return value * SPEED_UNIT_SECONDS[unit];
}

/** Compact decimal string without scientific notation (max speed ~250 y/s). */
function formatSpeedNumber(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/** Pick a unit so the numeric value is in a readable range (≥ 1 when possible). */
function autoSpeedUnit(simSecondsPerRealSecond: number): SpeedUnit {
  const yearsPerSec = simSecondsPerRealSecond / SPEED_UNIT_SECONDS.y;
  if (yearsPerSec >= 1) return "y";
  const daysPerSec = simSecondsPerRealSecond / SPEED_UNIT_SECONDS.d;
  if (daysPerSec >= 1) return "d";
  const hoursPerSec = simSecondsPerRealSecond / SPEED_UNIT_SECONDS.h;
  if (hoursPerSec >= 1) return "h";
  const minutesPerSec = simSecondsPerRealSecond / SPEED_UNIT_SECONDS.m;
  if (minutesPerSec >= 1) return "m";
  return "s";
}

function disposeMesh(mesh: Mesh) {
  // Ring label occluders share geometry/maps with the visible ring mesh.
  if (!mesh.userData.sharesGeometry) {
    mesh.geometry.dispose();
  }
  const { material } = mesh;
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    const maps = new Set<import("three").Texture>();
    if (!mesh.userData.sharesMap) {
      if (
        entry instanceof MeshBasicMaterial ||
        entry instanceof MeshStandardMaterial
      ) {
        if (entry.map) maps.add(entry.map);
      }
      if (entry instanceof MeshStandardMaterial && entry.emissiveMap) {
        maps.add(entry.emissiveMap);
      }
      if (entry instanceof MeshStandardMaterial && entry.metalnessMap) {
        maps.add(entry.metalnessMap);
      }
      if (entry instanceof MeshStandardMaterial && entry.bumpMap) {
        maps.add(entry.bumpMap);
      }
      if (entry instanceof MeshStandardMaterial && entry.displacementMap) {
        maps.add(entry.displacementMap);
      }
      if (entry instanceof MeshStandardMaterial && entry.alphaMap) {
        maps.add(entry.alphaMap);
      }
    }
    for (const map of maps) {
      map.dispose();
    }
    entry.dispose();
  }
}

function disposeBodyGroup(group: Group, scene: Scene) {
  const disposedTextures = new Set<import("three").Texture>();
  group.traverse((object) => {
    if (object instanceof Mesh) {
      disposeMesh(object);
    } else if (object instanceof Sprite) {
      const { material } = object;
      if (material.map && !disposedTextures.has(material.map)) {
        disposedTextures.add(material.map);
        material.map.dispose();
      }
      material.dispose();
    }
  });
  scene.remove(group);
}

/** Convert a target horizontal FOV to Three's vertical FOV for the given aspect. */
function verticalFovFromHorizontal(horizontalFovDeg: number, aspect: number) {
  const horizontalFovRad = MathUtils.degToRad(horizontalFovDeg);
  return MathUtils.radToDeg(
    2 * Math.atan(Math.tan(horizontalFovRad / 2) / aspect),
  );
}

function maxRadiusM(bodyId: BodyId) {
  const body = BODIES[bodyId];
  return Math.max(body.radiusXM, body.radiusYM, body.radiusZM);
}

/**
 * Radius used for default focus distance: outer glow/coma for Sun & comets,
 * otherwise the body's max figure radius.
 */
function focusFramingRadiusM(bodyId: BodyId) {
  const body = BODIES[bodyId];
  if (body.cometEffects) {
    return body.cometEffects.comaOuterRadiusM;
  }
  if (body.glowAndLight) {
    return sunOuterGlowRadiusM(body);
  }
  return maxRadiusM(bodyId);
}

function separationM(
  a: BodyPositionM | null | undefined,
  b: BodyPositionM | null | undefined,
): number {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Ortho shadow half-extent around the current focus (meters).
 * Must include parent/moons — e.g. Earth must stay in the map when focused on
 * the Moon, or lunar eclipses cannot cast.
 */
function shadowExtentForFocusM(
  focusId: FocusId,
  nbodyBodies: readonly NbodyBody[],
  positions: Partial<Record<BodyId, BodyPositionM>>,
  cameraDistanceM: number,
): number {
  if (isSystemFocusId(focusId)) {
    const members = systemMemberBodies(focusId, nbodyBodies);
    const scale = furthestSystemOrbitScaleM(members, focusId);
    return Math.max(scale ?? cameraDistanceM, 1e8) * 1.25;
  }

  const bodyId = focusId as BodyId;
  const focusPos = positions[bodyId];
  let extent = Math.max(focusFramingRadiusM(bodyId) * 8, cameraDistanceM * 0.6);

  const liveParent =
    nbodyBodies.find((body) => body.id === bodyId)?.parentId ?? null;
  const parentId = liveParent ?? catalogOrbitalParentId(bodyId);
  if (parentId) {
    extent = Math.max(
      extent,
      separationM(focusPos, positions[parentId]) + maxRadiusM(parentId) * 4,
    );
  }

  for (const body of nbodyBodies) {
    if (body.parentId !== bodyId) continue;
    extent = Math.max(
      extent,
      separationM(focusPos, positions[body.id]) + maxRadiusM(body.id) * 3,
    );
  }

  const body = BODIES[bodyId];
  if (body?.rings?.rings.length) {
    const outer = Math.max(
      ...body.rings.rings.map((ring) => ring.outerRadiusM),
    );
    extent = Math.max(extent, outer * 1.5);
  }
  return Math.max(extent, 1e7);
}

type FocusCamera = (focusId: FocusId) => void;
type ApplyEpoch = (julianDate: number) => void;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusCameraRef = useRef<FocusCamera | null>(null);
  const applyEpochRef = useRef<ApplyEpoch | null>(null);
  const livePositionsRef = useRef<Partial<Record<BodyId, BodyPositionM>>>({});
  const focusIdRef = useRef<FocusId>(INITIAL_FOCUS);
  const playingRef = useRef(false);
  const labelVisibleIdsRef = useRef<Set<FocusId>>(new Set());
  const orbitVisibleIdsRef = useRef<Set<OrbitId>>(new Set());
  const simSpeedRef = useRef(SIM_SPEED_MIN_S);
  const bodyLabelsRef = useRef<BodyLabels | null>(null);
  const bodyOrbitsRef = useRef<BodyOrbits | null>(null);
  const simClockRef = useRef<HTMLSpanElement>(null);
  const simJulianDateRef = useRef(dateToJulianDate(new Date()));
  const nbodyBodiesRef = useRef<NbodyBody[]>([]);
  const editingEpochRef = useRef(false);
  const setSimAwayFromNowRef = useRef<(away: boolean) => void>(() => {});
  const setSimInFutureRef = useRef<(inFuture: boolean) => void>(() => {});
  const [focusId, setFocusId] = useState<FocusId>(INITIAL_FOCUS);
  const [playing, setPlaying] = useState(false);
  const [simReady, setSimReady] = useState(false);
  /** False until catalog + ephemeris + textures are ready for interaction. */
  const [assetsReady, setAssetsReady] = useState(false);
  const assetsReadyRef = useRef(false);
  const [labelVisibleIds, setLabelVisibleIds] = useState<Set<FocusId>>(
    () =>
      new Set(
        defaultPlanetarySystemVisibleIds(
          bodyIdsForStellarSystem(DEFAULT_STELLAR_SYSTEM_ID),
        ),
      ),
  );
  const [orbitVisibleIds, setOrbitVisibleIds] = useState<Set<OrbitId>>(
    () =>
      new Set(
        defaultPlanetarySystemVisibleIds(
          bodyIdsForStellarSystem(DEFAULT_STELLAR_SYSTEM_ID),
        ),
      ),
  );
  const [simAwayFromNow, setSimAwayFromNow] = useState(false);
  /** True when sim JD is strictly after wall-clock now. */
  const [simInFuture, setSimInFuture] = useState(false);
  const [errorReportOpen, setErrorReportOpen] = useState(false);
  const [errorReportLoading, setErrorReportLoading] = useState(false);
  const [errorReportError, setErrorReportError] = useState<string | null>(null);
  const [errorReport, setErrorReport] = useState<ErrorReport | null>(null);
  const [simSpeedSlider, setSimSpeedSlider] = useState(0);
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>("s");
  const [speedInput, setSpeedInput] = useState("1.00");
  const [speedEditing, setSpeedEditing] = useState(false);
  const [epochLocal, setEpochLocal] = useState(() =>
    formatDatetimeLocal(new Date()),
  );
  const [editingEpoch, setEditingEpoch] = useState(false);
  const [focusRailCollapsed, setFocusRailCollapsed] = useState(false);
  const [infoRailCollapsed, setInfoRailCollapsed] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  const [stellarSystemId, setStellarSystemId] = useState<StellarSystemId>(
    DEFAULT_STELLAR_SYSTEM_ID,
  );
  const [catalogReady, setCatalogReady] = useState(false);
  /** Bodies with a successful ephemeris state for the current epoch. */
  const [availableBodyIds, setAvailableBodyIds] = useState<Set<BodyId> | null>(
    null,
  );
  /** Live child → parent map from the n-body hierarchy. */
  const [parentByBodyId, setParentByBodyId] = useState<OrbitalParentMap | null>(
    null,
  );
  /** Position snapshot for info-panel kinematics (e.g. Hill radius). */
  const [infoBodyPositions, setInfoBodyPositions] = useState<
    Partial<Record<BodyId, BodyPositionM>>
  >({});
  /** Sim epoch snapshot for info-panel IAU orientation, etc. */
  const [infoSimJulianDate, setInfoSimJulianDate] = useState(
    () => simJulianDateRef.current,
  );
  editingEpochRef.current = editingEpoch;
  setSimAwayFromNowRef.current = setSimAwayFromNow;
  setSimInFutureRef.current = setSimInFuture;
  const simSpeedMaxS = simSpeedMaxSeconds(stellarSystemId);
  const simSecondsPerRealSecond = simSpeedFromSlider(
    simSpeedSlider,
    simSpeedMaxS,
  );
  const isRealtime = simSpeedSlider <= 0 || simSecondsPerRealSecond <= 1.05;
  focusIdRef.current = focusId;
  playingRef.current = playing;
  labelVisibleIdsRef.current = labelVisibleIds;
  orbitVisibleIdsRef.current = orbitVisibleIds;
  simSpeedRef.current = simSecondsPerRealSecond;
  assetsReadyRef.current = assetsReady;

  useEffect(() => {
    setSimSpeedSlider((t) => {
      const current = simSpeedFromSlider(t, simSpeedMaxS);
      return sliderFromSimSpeed(current, simSpeedMaxS);
    });
  }, [simSpeedMaxS]);

  useEffect(() => {
    if (speedEditing) return;
    setSpeedInput(
      formatSpeedNumber(simSpeedToUnit(simSecondsPerRealSecond, speedUnit)),
    );
  }, [simSecondsPerRealSecond, speedUnit, speedEditing]);

  const showErrorReportButton = simReady && !playing && simInFuture;

  const openErrorReport = () => {
    const jd = simJulianDateRef.current;
    const bodies = nbodyBodiesRef.current;
    setErrorReportOpen(true);
    setErrorReportLoading(true);
    setErrorReportError(null);
    setErrorReport(null);

    if (bodies.length === 0) {
      setErrorReportLoading(false);
      setErrorReportError("Simulation has no bodies loaded.");
      return;
    }

    const snapshot: NbodyBody[] = bodies.map((body) => ({
      id: body.id,
      mass: body.mass,
      parentId: body.parentId,
      state: {
        positionM: { ...body.state.positionM },
        velocityMS: { ...body.state.velocityMS },
      },
    }));
    const bodyIds = snapshot.map((body) => body.id);

    void (async () => {
      try {
        const apiStatesIcrf = await fetchAllSpkStates(bodyIds, jd);
        setErrorReport(
          buildErrorReport({
            simJd: jd,
            simBodies: snapshot,
            apiStatesIcrf,
          }),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to build error report.";
        setErrorReportError(message);
      } finally {
        setErrorReportLoading(false);
      }
    })();
  };

  const commitSpeedInput = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setSpeedInput(
        formatSpeedNumber(simSpeedToUnit(simSecondsPerRealSecond, speedUnit)),
      );
      setSpeedEditing(false);
      return;
    }
    const nextSim = Math.min(
      simSpeedMaxS,
      Math.max(SIM_SPEED_MIN_S, unitToSimSpeed(parsed, speedUnit)),
    );
    setSimSpeedSlider(sliderFromSimSpeed(nextSim, simSpeedMaxS));
    setSpeedInput(formatSpeedNumber(simSpeedToUnit(nextSim, speedUnit)));
    setSpeedEditing(false);
  };

  useEffect(() => {
    let cancelled = false;
    void hydrateBodiesFromApi()
      .catch((error) => {
        console.warn(
          "Body catalog API unavailable; using bundled catalog JSON",
          error,
        );
      })
      .finally(() => {
        if (!cancelled) setCatalogReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!catalogReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const systemDef = STELLAR_SYSTEMS[stellarSystemId];
    const systemBodyIds = bodyIdsForStellarSystem(stellarSystemId);
    const systemStarId = primaryStarId(stellarSystemId);
    const systemPrimary = primaryStarBody(stellarSystemId);

    let cancelled = false;
    let frameId = 0;
    let skybox: Mesh | null = null;
    let minDistanceM = 2 * Math.max(maxRadiusM(systemStarId), 1);
    let minLogDistance = Math.log(minDistanceM);
    const maxLogDistance = Math.log(CAMERA_MAX_DISTANCE_M);

    let nbodyBodies: NbodyBody[] = [];
    let bodyGroups = new Map<BodyId, Group>();
    let visibilityEntries: BodyVisibilityEntry[] = [];
    let bodyLabels: BodyLabels | null = null;
    let bodyOrbits: BodyOrbits | null = null;
    let solScaleReferenceOrbit: SolScaleReferenceOrbit | null = null;
    let tidalLockById = new Map<BodyId, TidalLockRuntime>();
    const tidalLockOrientation = new Quaternion();
    let loadGeneration = 0;
    let hierarchyFp = "";
    let visibilitySeeded = false;
    const initialDate = parseDatetimeLocal(epochLocal) ?? new Date();
    let simJulianDate = dateToJulianDate(initialDate);
    simJulianDateRef.current = simJulianDate;
    let lastDisplayedSimClock = "";
    let lastSimAwayFromNow: boolean | null = null;
    let lastSimInFuture: boolean | null = null;
    let lastFrameMs = performance.now();
    let lastInfoPositionsPublishMs = 0;

    const publishInfoPositions = (force = false) => {
      const now = performance.now();
      if (!force && now - lastInfoPositionsPublishMs < 500) return;
      lastInfoPositionsPublishMs = now;
      setInfoBodyPositions({ ...livePositionsRef.current });
      setInfoSimJulianDate(simJulianDateRef.current);
    };

    const seedDefaultVisibility = (
      bodyIds: readonly BodyId[],
      map: OrbitalParentMap | null,
    ) => {
      if (visibilitySeeded) return;
      visibilitySeeded = true;
      const defaults = defaultPlanetarySystemVisibleIds(bodyIds, map);
      const labelDefaults = new Set<FocusId>(defaults);
      const orbitDefaults = new Set<OrbitId>(defaults);
      labelVisibleIdsRef.current = labelDefaults;
      orbitVisibleIdsRef.current = orbitDefaults;
      setLabelVisibleIds(labelDefaults);
      setOrbitVisibleIds(orbitDefaults);
    };

    const publishHierarchy = (bodies: NbodyBody[]) => {
      const map = orbitalParentMapFromBodies(bodies);
      const bodyIds = bodies.map((body) => body.id);
      // Seed before the fingerprint short-circuit so a moonless first frame
      // still gets planetary-system tag/orbit defaults.
      seedDefaultVisibility(bodyIds, map);

      const fp = hierarchyFingerprint(map);
      if (fp === hierarchyFp) return;
      hierarchyFp = fp;
      setParentByBodyId(map);

      const activeSystems = planetarySystemFocusIdsFromParents(map);
      const activeSystemSet = new Set(activeSystems);

      const currentFocus = focusIdRef.current;
      // Stellar barycenter focus is always valid while this system is loaded.
      if (isStellarBarycenterFocusId(currentFocus)) return;
      if (isSystemFocusId(currentFocus) && !activeSystemSet.has(currentFocus)) {
        const primaryId = systemPrimaryId(currentFocus);
        setFocusId(
          primaryId && map.has(primaryId)
            ? primaryId
            : (systemDef.defaultFocusId as FocusId),
        );
      }
    };

    const syncAwayFromNow = () => {
      const nowJd = dateToJulianDate(new Date());
      const away = Math.abs(simJulianDate - nowJd) * 86_400 > 2;
      if (away !== lastSimAwayFromNow) {
        lastSimAwayFromNow = away;
        setSimAwayFromNowRef.current(away);
      }
      const inFuture = simJulianDate > nowJd;
      if (inFuture !== lastSimInFuture) {
        lastSimInFuture = inFuture;
        setSimInFutureRef.current(inFuture);
      }
    };

    const updateSimClock = () => {
      simJulianDateRef.current = simJulianDate;
      syncAwayFromNow();
      if (editingEpochRef.current) return;
      const next = formatSimDatetime(simJulianDate);
      if (next === lastDisplayedSimClock) return;
      lastDisplayedSimClock = next;
      const el = simClockRef.current;
      if (el) el.textContent = next;
    };
    updateSimClock();

    const scene = new Scene();
    scene.add(
      new AmbientLight(STARLIGHT_AMBIENT_COLOR, STARLIGHT_AMBIENT_INTENSITY),
    );
    const starLightDistanceM = starLightReferenceDistanceM(
      bodiesForStellarSystem(stellarSystemId),
    );
    const sunLight = createSunDirectionalLight(
      starColorHex(systemPrimary),
      starLightIntensity(systemPrimary, starLightDistanceM),
    );
    scene.add(sunLight);
    scene.add(sunLight.target);
    const offset = new Vector3();
    const target = new Vector3();

    const aspect = window.innerWidth / window.innerHeight;
    const camera = new PerspectiveCamera(
      verticalFovFromHorizontal(CAMERA_HORIZONTAL_FOV_DEG, aspect),
      aspect,
      1_000,
      CAMERA_FAR_M,
    );
    camera.up.set(INVARIABLE_UP.x, INVARIABLE_UP.y, INVARIABLE_UP.z);

    /**
     * Keep the near plane inside the orbit sphere so meter-scale bodies
     * (Itokawa, Bennu, …) are not clipped when zoomed to minDistance.
     * Logarithmic depth buffer already covers the huge far plane.
     */
    const updateCameraClipPlanes = (distanceM: number) => {
      const nextNear = Math.max(0.05, Math.min(1_000, distanceM * 0.05));
      if (Math.abs(camera.near - nextNear) < Math.max(0.01, nextNear * 0.01)) {
        return;
      }
      camera.near = nextNear;
      camera.updateProjectionMatrix();
    };

    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    configureRendererShadows(renderer);

    const bloom = createSunBloomComposers(renderer, scene, camera);
    bloom.setStrength(starBloomStrength(systemPrimary));
    applyStarLightAppearance(
      sunLight,
      starColorHex(systemPrimary),
      starLightIntensity(systemPrimary, starLightDistanceM),
    );

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enableZoom = false;
    controls.enabled = false;
    controls.maxDistance = CAMERA_MAX_DISTANCE_M;

    const positionFor = (bodyId: BodyId): BodyPositionM | null =>
      livePositionsRef.current[bodyId] ?? null;

    const focusCameraOnBody = (bodyId: BodyId) => {
      const position = positionFor(bodyId);
      if (!position) return;
      const bodyRadiusM = Math.max(maxRadiusM(bodyId), 1);
      const framingRadiusM = Math.max(focusFramingRadiusM(bodyId), 1);
      const distanceM = INITIAL_DISTANCE_RADIUS_FACTOR * framingRadiusM;
      minDistanceM = 2 * bodyRadiusM;
      minLogDistance = Math.log(minDistanceM);

      target.set(position.x, position.y, position.z);
      controls.target.copy(target);
      controls.minDistance = minDistanceM;

      const liveParentId =
        nbodyBodies.find((body) => body.id === bodyId)?.parentId ?? null;
      const parentId = liveParentId ?? catalogOrbitalParentId(bodyId);
      const parentPosition = parentId ? positionFor(parentId) : null;
      if (parentId && !parentPosition) return;
      const offsetXy = defaultFocusOffsetXy(
        position,
        parentPosition,
        distanceM,
      );
      camera.position.set(
        position.x + offsetXy.x * distanceM,
        position.y + offsetXy.y * distanceM,
        position.z,
      );
      camera.lookAt(target);
      updateCameraClipPlanes(distanceM);
      controls.update();
    };

    const focusCameraOnSystem = (systemId: SystemFocusId) => {
      const members = systemMemberBodies(systemId, nbodyBodies);
      const position = systemBarycenterPosition(systemId, nbodyBodies);
      if (!position || members.length === 0) return;

      const primaryId = systemPrimaryId(systemId);
      const orbitScaleM =
        systemId === "solar-system"
          ? (bodyOrbitScaleAboutSystemM(
              SOLAR_SYSTEM_FOCUS_SCALE_BODY,
              members,
            ) ?? furthestSystemOrbitScaleM(members, systemId))
          : furthestSystemOrbitScaleM(members, systemId);
      const fallbackRadiusM = Math.max(
        focusFramingRadiusM(primaryId ?? systemStarId),
        1,
      );
      const distanceM =
        orbitScaleM != null && orbitScaleM > 0
          ? SYSTEM_FOCUS_DISTANCE_FACTOR * orbitScaleM
          : INITIAL_DISTANCE_RADIUS_FACTOR * fallbackRadiusM;
      const minBodyId = primaryId ?? systemStarId;
      minDistanceM = 2 * Math.max(maxRadiusM(minBodyId), 1);
      minLogDistance = Math.log(minDistanceM);

      target.set(position.x, position.y, position.z);
      controls.target.copy(target);
      controls.minDistance = minDistanceM;

      // Same azimuth as heliocentric planets, then pitch up from the plane.
      const offsetXy = defaultFocusOffsetXy(position, null, distanceM);
      const elev = MathUtils.degToRad(SYSTEM_FOCUS_ELEVATION_DEG);
      const cosElev = Math.cos(elev);
      const sinElev = Math.sin(elev);
      camera.position.set(
        position.x + offsetXy.x * distanceM * cosElev,
        position.y + offsetXy.y * distanceM * cosElev,
        position.z + distanceM * sinElev,
      );
      camera.lookAt(target);
      updateCameraClipPlanes(distanceM);
      controls.update();
    };

    const focusCamera: FocusCamera = (nextFocusId) => {
      if (isSystemFocusId(nextFocusId)) {
        focusCameraOnSystem(nextFocusId);
      } else {
        focusCameraOnBody(nextFocusId);
      }
    };
    focusCameraRef.current = focusCamera;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!assetsReadyRef.current) return;
      offset.copy(camera.position).sub(controls.target);
      const distance = Math.max(offset.length(), minDistanceM);
      const direction = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;
      if (direction === 0) return;

      const nextDistance = Math.exp(
        MathUtils.clamp(
          Math.log(distance) + direction * CAMERA_LOG_ZOOM_SPEED,
          minLogDistance,
          maxLogDistance,
        ),
      );
      offset.setLength(nextDistance);
      camera.position.copy(controls.target).add(offset);
      updateCameraClipPlanes(nextDistance);
      controls.update();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const syncSceneFromNbody = (simDtSeconds = 0) => {
      const d = daysFromJ2000(simJulianDate);
      const T = centuriesFromJ2000(simJulianDate);
      const livePositions: Partial<Record<BodyId, BodyPositionM>> = {
        ...livePositionsRef.current,
      };
      const starParticle =
        nbodyBodies.find((body) => body.id === systemStarId) ??
        nbodyBodies.find((body) => BODIES[body.id]?.glowAndLight);

      for (const particle of nbodyBodies) {
        const group = bodyGroups.get(particle.id);
        if (!group) continue;
        const { positionM } = particle.state;
        group.position.set(positionM.x, positionM.y, positionM.z);
        group.userData.state = particle.state;
        livePositions[particle.id] = positionM;

        const body = BODIES[particle.id];
        const lock = tidalLockById.get(particle.id);
        let orientation: Quaternion;
        let atmospherePrimeMeridianDeg: number;
        if (lock) {
          const stepped = stepTidalLockOrientation(
            lock,
            particle,
            nbodyBodies,
            BODIES,
            d,
            T,
            simDtSeconds,
            tidalLockOrientation,
          );
          orientation = stepped.orientation;
          atmospherePrimeMeridianDeg = stepped.wDeg;
        } else {
          orientation = orientationQuaternionForBody(body, d, T);
          atmospherePrimeMeridianDeg = evaluateIauOrientation(
            body.iauOrientation,
            d,
            T,
          ).wDeg;
        }
        const orbitalPoleWorld =
          starParticle &&
          body.rings?.rings.some((ring) => ring.alignToOrbitalPlane)
            ? heliocentricOrbitalPole(particle.state, starParticle.state)
            : undefined;
        setBodyOrientation(group, orientation, {
          atmospherePrimeMeridianDeg,
          orbitalPoleWorld,
          sunPositionM: starParticle?.state.positionM,
          velocityMS: particle.state.velocityMS,
        });
      }

      livePositionsRef.current = livePositions;
      publishHierarchy(nbodyBodies);
      publishInfoPositions();

      const currentFocusId = focusIdRef.current;
      const focusPos = isSystemFocusId(currentFocusId)
        ? systemBarycenterPosition(currentFocusId, nbodyBodies)
        : livePositions[currentFocusId];
      if (focusPos) {
        offset.copy(camera.position).sub(controls.target);
        controls.target.set(focusPos.x, focusPos.y, focusPos.z);
        camera.position.copy(controls.target).add(offset);
      }
    };

    const renderFrame = (nowMs: number) => {
      frameId = requestAnimationFrame(renderFrame);
      const wallDt = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
      lastFrameMs = nowMs;

      if (playingRef.current && nbodyBodies.length > 0) {
        const simDt = wallDt * simSpeedRef.current;
        stepNbody(nbodyBodies, simDt, {
          forceSummationOnly: systemDef.forceSummationOnly === true,
        });
        simJulianDate += simDt / 86_400;
        syncSceneFromNbody(simDt);
        updateSimClock();
      } else {
        syncAwayFromNow();
      }

      controls.update();
      if (nbodyBodies.length > 0) {
        const viewportHeightPx = renderer.domElement.clientHeight;
        bodyOrbits?.update(nbodyBodies, 0, {
          camera,
          viewportHeightPx,
        });
        if (solScaleReferenceOrbit) {
          const bary = solarSystemBarycenterFrame(nbodyBodies);
          if (bary) {
            solScaleReferenceOrbit.setCenter(
              bary.positionM.x,
              bary.positionM.y,
              bary.positionM.z,
            );
          }
          solScaleReferenceOrbit.update(camera, viewportHeightPx);
        }
      }
      updateCameraClipPlanes(
        Math.max(camera.position.distanceTo(controls.target), minDistanceM),
      );
      if (visibilityEntries.length > 0) {
        updateBodyVisibility(
          visibilityEntries,
          camera,
          renderer.domElement.clientHeight,
        );
      }
      if (skybox) skybox.position.copy(camera.position);

      const sunPos =
        livePositionsRef.current[systemStarId] ?? livePositionsRef.current.sun;
      const focusId = focusIdRef.current;
      const cameraDistanceM = Math.max(
        camera.position.distanceTo(controls.target),
        minDistanceM,
      );
      {
        const focusBodyId = isSystemFocusId(focusId)
          ? systemPrimaryId(focusId)
          : (focusId as BodyId);
        const focusRadiusM = focusBodyId ? focusFramingRadiusM(focusBodyId) : 0;
        updateSunDirectionalLight(
          sunLight,
          sunPos,
          controls.target,
          shadowExtentForFocusM(
            focusId,
            nbodyBodies,
            livePositionsRef.current,
            cameraDistanceM,
          ),
          camera,
          focusRadiusM,
        );
      }

      // RTE orbit uniforms, subpixel cull, and system orbit LOD.
      bodyOrbits?.prepareRender(
        camera,
        renderer.domElement.clientHeight,
        nbodyBodies,
      );
      // Depth-tested WebGL tags: update billboards before the scene pass so
      // intervening bodies occlude rings/text via the normal depth buffer.
      bodyLabels?.update(camera, renderer.domElement.clientHeight, nbodyBodies);
      bloom.render();
    };
    frameId = requestAnimationFrame(renderFrame);

    const onResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      camera.aspect = width / height;
      camera.fov = verticalFovFromHorizontal(
        CAMERA_HORIZONTAL_FOV_DEG,
        camera.aspect,
      );
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      bloom.setSize(width, height);
    };
    window.addEventListener("resize", onResize);

    const bodyIds = systemBodyIds;

    const skyboxPromise = addSkybox(scene, stellarSystemId)
      .then((mesh) => {
        if (cancelled) {
          disposeMesh(mesh);
          return null;
        }
        skybox = mesh;
        return mesh;
      })
      .catch((error) => {
        console.warn("Skybox failed to load", error);
        return null;
      });

    const loadEpoch = async (jd: number) => {
      const generation = ++loadGeneration;
      setPlaying(false);
      setSimReady(false);
      setAssetsReady(false);
      controls.enabled = false;

      try {
        const d = daysFromJ2000(jd);
        const T = centuriesFromJ2000(jd);
        const states: Partial<Record<BodyId, BodyState>> = {};
        const orientations: Partial<Record<BodyId, Quaternion>> = {};
        const atmospherePrimeMeridianDeg: Partial<Record<BodyId, number>> = {};
        const livePositions: Partial<Record<BodyId, BodyPositionM>> = {};

        if (systemDef.usesSpk) {
          const icrfStates = await fetchAllSpkStates(bodyIds, jd);
          if (cancelled || generation !== loadGeneration) return;

          for (const bodyId of bodyIds) {
            const icrf = icrfStates[bodyId];
            if (!icrf) {
              console.warn(`No SPK ephemeris for "${bodyId}"; omitting body`);
              continue;
            }
            const state = transformStateToInvariable(icrf);
            states[bodyId] = state;
            livePositions[bodyId] = state.positionM;
            const body = BODIES[bodyId];
            orientations[bodyId] = orientationQuaternionForBody(body, d, T);
            atmospherePrimeMeridianDeg[bodyId] = evaluateIauOrientation(
              body.iauOrientation,
              d,
              T,
            ).wDeg;
          }
        } else {
          // Non-SPK systems (e.g. TRAPPIST-1): primary at the origin;
          // planets from catalog Keplerian elements at this epoch.
          const star = BODIES[systemStarId];
          for (const bodyId of bodyIds) {
            const body = BODIES[bodyId];
            if (!body) continue;

            let state: BodyState | null = null;
            if (bodyId === systemStarId || body.glowAndLight) {
              state = {
                positionM: { x: 0, y: 0, z: 0 },
                velocityMS: { x: 0, y: 0, z: 0 },
              };
            } else if (body.keplerianElements && star) {
              state = bodyStateFromKeplerianElements(
                body.keplerianElements,
                star.mass,
                body.mass,
                jd,
                stellarSystemId,
              );
              if (!state) {
                console.warn(
                  `Keplerian state failed for "${bodyId}"; omitting body`,
                );
                continue;
              }
            } else {
              continue;
            }

            states[bodyId] = state;
            livePositions[bodyId] = state.positionM;
            orientations[bodyId] = orientationQuaternionForBody(body, d, T);
            atmospherePrimeMeridianDeg[bodyId] = evaluateIauOrientation(
              body.iauOrientation,
              d,
              T,
            ).wDeg;
          }

          // Star at system barycenter, v = 0; planets in the barycentric frame.
          parkStarAtBarycenter(states, systemStarId);
          for (const bodyId of Object.keys(states) as BodyId[]) {
            const state = states[bodyId];
            if (state) livePositions[bodyId] = state.positionM;
          }
        }

        const primaryState = states[systemStarId] ?? states.sun;
        if (!primaryState) {
          console.error(
            `Primary star "${systemStarId}" required; cannot build scene`,
          );
          return;
        }

        const loadedIds = new Set(Object.keys(states) as BodyId[]);
        setAvailableBodyIds(loadedIds);
        // Tag / orbit defaults and live hierarchy remapping happen in
        // publishHierarchy after createNbodySystem.

        const currentFocus = focusIdRef.current;
        const defaultFocus = systemDef.defaultFocusId as FocusId;
        if (
          currentFocus !== defaultFocus &&
          !isStellarBarycenterFocusId(currentFocus) &&
          !isSystemFocusId(currentFocus) &&
          !loadedIds.has(currentFocus)
        ) {
          setFocusId(defaultFocus);
        } else if (
          isStellarBarycenterFocusId(currentFocus) &&
          currentFocus !== defaultFocus
        ) {
          // Stellar barycenter ids are system-specific (Solar vs TRAPPIST-1).
          setFocusId(defaultFocus);
        }

        simJulianDate = jd;
        livePositionsRef.current = livePositions;
        publishInfoPositions(true);
        updateSimClock();

        const firstLoad = bodyGroups.size === 0;
        if (firstLoad) {
          const groups = await addAllBodies(scene, {
            states,
            orientations,
            atmospherePrimeMeridianDeg,
            sunPositionM: primaryState.positionM,
          });

          if (cancelled || generation !== loadGeneration) {
            for (const body of groups) {
              disposeBodyGroup(body, scene);
            }
            return;
          }

          bodyGroups = new Map(
            groups.map((group) => [group.name as BodyId, group]),
          );
          visibilityEntries = groups.map((group) => {
            const id = group.name as BodyId;
            const body = BODIES[id];
            return {
              id,
              group,
              maxRadiusM: cullingRadiusM(body),
              alwaysVisible: Boolean(body.glowAndLight) || id === systemStarId,
              cullables:
                (group.userData.cullables as ReturnType<
                  typeof collectCullables
                >) ?? collectCullables(group),
              displacement:
                (group.userData.displacementStates as ReturnType<
                  typeof collectDisplacementStates
                >) ?? collectDisplacementStates(group),
            };
          });
          bodyLabels = attachBodyLabels(scene, bodyGroups);
          bodyLabels.syncVisibility(labelVisibleIdsRef.current);
          bodyLabelsRef.current = bodyLabels;

          bodyOrbits = attachBodyOrbits(scene, bodyGroups);
          bodyOrbits.syncVisibility(orbitVisibleIdsRef.current);
          bodyOrbitsRef.current = bodyOrbits;

          if (!systemDef.usesSpk) {
            solScaleReferenceOrbit = attachSolScaleReferenceOrbit(
              scene,
              solScaleReferenceBodyId(stellarSystemId),
            );
          }

          await skyboxPromise;
          if (cancelled || generation !== loadGeneration) return;

          initTextures(renderer, collectTextures(scene));
        }

        nbodyBodies = createNbodySystem(states, bodyIds);
        nbodyBodiesRef.current = nbodyBodies;
        updateOrbitalParents(nbodyBodies);
        tidalLockById = initTidalLockRuntimes(nbodyBodies, BODIES, d, T);
        hierarchyFp = "";
        publishHierarchy(nbodyBodies);
        syncSceneFromNbody();
        if (cancelled || generation !== loadGeneration) return;

        if (solScaleReferenceOrbit) {
          const referenceBodyId = solScaleReferenceBodyId(stellarSystemId);
          try {
            const referenceElements =
              await solPlanetHeliocentricElementsAtEpoch(referenceBodyId, jd);
            if (cancelled || generation !== loadGeneration) return;
            if (referenceElements) {
              solScaleReferenceOrbit.setElements(referenceElements);
              const bary = solarSystemBarycenterFrame(nbodyBodies);
              if (bary) {
                solScaleReferenceOrbit.setCenter(
                  bary.positionM.x,
                  bary.positionM.y,
                  bary.positionM.z,
                );
              }
            } else {
              solScaleReferenceOrbit.setVisible(false);
            }
          } catch (error) {
            console.warn(
              `${referenceBodyId} scale-reference orbit unavailable (SPK fetch failed)`,
              error,
            );
            solScaleReferenceOrbit.setVisible(false);
          }
        }

        // System foci need nbodyBodies for COM / orbit scale; apply after create.
        if (firstLoad) {
          focusCamera(focusIdRef.current);
        }
        controls.enabled = true;
        setSimReady(true);
        setAssetsReady(true);
      } catch (error) {
        if (!cancelled && generation === loadGeneration) {
          console.error("Failed to load ephemeris for epoch", jd, error);
        }
      }
    };

    applyEpochRef.current = (jd) => {
      void loadEpoch(jd);
    };

    void loadEpoch(simJulianDate);

    return () => {
      cancelled = true;
      setSimReady(false);
      setAssetsReady(false);
      nbodyBodiesRef.current = [];
      focusCameraRef.current = null;
      applyEpochRef.current = null;
      cancelAnimationFrame(frameId);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      bloom.dispose();
      bodyLabels?.dispose();
      bodyLabels = null;
      bodyLabelsRef.current = null;
      bodyOrbits?.dispose();
      bodyOrbits = null;
      bodyOrbitsRef.current = null;
      solScaleReferenceOrbit?.dispose();
      solScaleReferenceOrbit = null;
      const disposedTextures = new Set<import("three").Texture>();
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          disposeMesh(object);
        } else if (object instanceof Sprite) {
          const { material } = object;
          if (material.map && !disposedTextures.has(material.map)) {
            disposedTextures.add(material.map);
            material.map.dispose();
          }
          material.dispose();
        }
      });
      renderer.dispose();
    };
    // Remount the WebGL scene when the active star system changes.
    // Initial epochLocal is captured once for the default page-load epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogReady, stellarSystemId]);

  useEffect(() => {
    focusCameraRef.current?.(focusId);
  }, [focusId]);

  useEffect(() => {
    setInfoBodyPositions({ ...livePositionsRef.current });
    setInfoSimJulianDate(simJulianDateRef.current);
  }, [focusId]);

  useEffect(() => {
    bodyLabelsRef.current?.syncVisibility(labelVisibleIds);
  }, [labelVisibleIds]);

  useEffect(() => {
    bodyOrbitsRef.current?.syncVisibility(orbitVisibleIds);
  }, [orbitVisibleIds]);

  useEffect(() => {
    if (editingEpoch) return;
    const el = simClockRef.current;
    if (el) el.textContent = formatSimDatetime(simJulianDateRef.current);
  }, [editingEpoch]);

  const showLoadingOverlay = !catalogReady || !assetsReady;
  const loadingSystemName = STELLAR_SYSTEMS[stellarSystemId].name;
  const loadingLabel = `Loading ${loadingSystemName}`;

  return (
    <div className="app-shell" aria-busy={showLoadingOverlay}>
      <canvas ref={canvasRef} className="app-canvas" />
      <div className={"app-ui" + (showLoadingOverlay ? " is-loading" : "")}>
        <BodyFocusPicker
          value={focusId}
          stellarSystemId={stellarSystemId}
          onStellarSystemChange={(nextSystemId) => {
            if (nextSystemId === stellarSystemId) return;
            setPlaying(false);
            setAssetsReady(false);
            setSimReady(false);
            setAvailableBodyIds(null);
            setParentByBodyId(null);
            const nextFocus = STELLAR_SYSTEMS[nextSystemId]
              .defaultFocusId as FocusId;
            setFocusId(nextFocus);
            focusIdRef.current = nextFocus;
            setStellarSystemId(nextSystemId);
          }}
          onChange={(id) => {
            setFocusId(id);
            const availableIds =
              availableBodyIds != null
                ? [...availableBodyIds]
                : bodyIdsForStellarSystem(stellarSystemId);
            // Replace tag/orbit visibility for the new focus (do not merge).
            const next = new Set(
              tagOrbitIdsForFocus(id, {
                availableBodyIds: availableIds,
                parentByBodyId,
                positions: livePositionsRef.current,
              }),
            );
            setLabelVisibleIds(next);
            setOrbitVisibleIds(new Set(next));
          }}
          availableBodyIds={availableBodyIds}
          parentByBodyId={parentByBodyId}
          labelVisibleIds={labelVisibleIds}
          onSetLabels={(ids, visible) => {
            setLabelVisibleIds((prev) => {
              const next = new Set(prev);
              for (const id of ids) {
                if (visible) next.add(id);
                else next.delete(id);
              }
              return next;
            });
          }}
          onToggleAllLabels={(visible) => {
            setLabelVisibleIds(
              visible
                ? new Set(
                    allTagFocusIds(
                      availableBodyIds != null
                        ? [...availableBodyIds]
                        : bodyIdsForStellarSystem(stellarSystemId),
                      parentByBodyId,
                    ),
                  )
                : new Set(),
            );
          }}
          orbitVisibleIds={orbitVisibleIds}
          onSetOrbits={(ids, visible) => {
            setOrbitVisibleIds((prev) => {
              const next = new Set(prev);
              for (const id of ids) {
                if (visible) next.add(id);
                else next.delete(id);
              }
              return next;
            });
          }}
          onToggleAllOrbits={(visible) => {
            setOrbitVisibleIds(
              visible
                ? new Set(
                    orbitBodyIds(
                      availableBodyIds != null
                        ? [...availableBodyIds]
                        : bodyIdsForStellarSystem(stellarSystemId),
                      parentByBodyId,
                    ),
                  )
                : new Set(),
            );
          }}
          collapsed={focusRailCollapsed}
          onToggleCollapsed={() => setFocusRailCollapsed((prev) => !prev)}
        />
        <SelectionInfoPanel
          focusId={focusId}
          availableBodyIds={availableBodyIds}
          parentByBodyId={parentByBodyId}
          bodyPositions={infoBodyPositions}
          nbodyBodies={nbodyBodiesRef.current}
          simJulianDate={infoSimJulianDate}
          collapsed={infoRailCollapsed}
          onToggleCollapsed={() => setInfoRailCollapsed((prev) => !prev)}
        />
        <div className={"hud-shell" + (hudCollapsed ? " is-collapsed" : "")}>
          <div
            className={"hud" + (hudCollapsed ? " is-collapsed" : "")}
            role="toolbar"
            aria-label="Simulation controls"
          >
            <PanelCollapseButton
              side="bottom"
              collapsed={hudCollapsed}
              onToggle={() => setHudCollapsed((prev) => !prev)}
              label="simulation controls"
            />
            <div
              className="hud-body"
              aria-hidden={hudCollapsed}
              inert={hudCollapsed || undefined}
            >
              <div className="hud-top">
                <div className="hud-top-side hud-top-left">
                  <button
                    type="button"
                    className={
                      "hud-btn hud-epoch-present" +
                      (simAwayFromNow ? "" : " is-reserved")
                    }
                    disabled={!simReady || !simAwayFromNow}
                    tabIndex={simAwayFromNow ? 0 : -1}
                    aria-hidden={!simAwayFromNow}
                    title="Jump to the current wall-clock time"
                    onMouseDown={(event) => {
                      // Avoid stealing focus/blur from the epoch input mid-edit.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      if (!simAwayFromNow) return;
                      const now = new Date();
                      setEditingEpoch(false);
                      setEpochLocal(formatDatetimeLocal(now));
                      applyEpochRef.current?.(dateToJulianDate(now));
                    }}
                  >
                    Present
                  </button>
                </div>
                <div className="hud-top-center">
                  <div className="hud-epoch">
                    <span className="hud-epoch-label">
                      {editingEpoch ? "Epoch" : "Now"}
                    </span>
                    {editingEpoch ? (
                      <input
                        className="hud-epoch-input"
                        type="datetime-local"
                        step={1}
                        value={epochLocal}
                        autoFocus
                        aria-label="Simulation epoch"
                        onChange={(event) => {
                          const value = event.target.value;
                          setEpochLocal(value);
                          const date = parseDatetimeLocal(value);
                          if (!date) return;
                          applyEpochRef.current?.(dateToJulianDate(date));
                        }}
                        onBlur={() => setEditingEpoch(false)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingEpoch(false);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="hud-epoch-display"
                        title="Click to set epoch from state vectors"
                        aria-label="Current simulation time. Click to set epoch."
                        onClick={() => {
                          setEpochLocal(
                            formatDatetimeLocal(
                              julianDateToDate(simJulianDateRef.current),
                            ),
                          );
                          setEditingEpoch(true);
                        }}
                      >
                        <span ref={simClockRef} className="hud-epoch-value">
                          {epochLocal.replace("T", " ")}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="hud-top-side hud-top-right">
                  <button
                    type="button"
                    className={
                      "hud-btn hud-btn-icon" +
                      (playing ? "" : " hud-btn-primary")
                    }
                    disabled={!simReady}
                    aria-label={playing ? "Pause" : "Play"}
                    title={playing ? "Pause" : "Play"}
                    onClick={() => setPlaying((prev) => !prev)}
                  >
                    {playing ? (
                      <svg
                        className="hud-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M7 5h3.5v14H7V5zm6.5 0H17v14h-3.5V5z" />
                      </svg>
                    ) : (
                      <svg
                        className="hud-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M8 5.5v13l11-6.5-11-6.5z" />
                      </svg>
                    )}
                  </button>
                  {showErrorReportButton && (
                    <button
                      type="button"
                      className="hud-btn"
                      title="Compare simulation state to SPK ephemeris at this epoch"
                      onClick={openErrorReport}
                    >
                      Error Report
                    </button>
                  )}
                </div>
              </div>
              <div
                className="hud-speed"
                title={
                  stellarSystemId === "sol"
                    ? "Log scale: realtime → ~250 years per second"
                    : "Log scale: realtime → outermost orbit once per second"
                }
              >
                <span className="hud-speed-label">Speed</span>
                <input
                  className="hud-speed-track"
                  type="range"
                  min={0}
                  max={1000}
                  step={1}
                  value={Math.round(simSpeedSlider * 1000)}
                  disabled={!simReady}
                  aria-label="Simulation speed"
                  onChange={(event) => {
                    const t01 = Number(event.target.value) / 1000;
                    const nextSim = simSpeedFromSlider(t01, simSpeedMaxS);
                    setSpeedEditing(false);
                    setSpeedUnit(autoSpeedUnit(nextSim));
                    setSimSpeedSlider(t01);
                  }}
                />
                <input
                  className="hud-speed-input"
                  type="text"
                  inputMode="decimal"
                  value={speedInput}
                  disabled={!simReady}
                  aria-label="Simulation speed value"
                  onFocus={() => setSpeedEditing(true)}
                  onChange={(event) => {
                    setSpeedEditing(true);
                    setSpeedInput(event.target.value);
                  }}
                  onBlur={() => commitSpeedInput(speedInput)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      (event.target as HTMLInputElement).blur();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setSpeedEditing(false);
                      setSpeedInput(
                        formatSpeedNumber(
                          simSpeedToUnit(simSecondsPerRealSecond, speedUnit),
                        ),
                      );
                    }
                  }}
                />
                <select
                  className="hud-speed-unit"
                  value={speedUnit}
                  disabled={!simReady}
                  aria-label="Simulation speed units"
                  onChange={(event) => {
                    setSpeedUnit(event.target.value as SpeedUnit);
                    setSpeedEditing(false);
                  }}
                >
                  {SPEED_UNITS.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                </select>
                {isRealtime ? (
                  <span className="hud-speed-realtime" aria-live="polite">
                    Realtime
                  </span>
                ) : (
                  <button
                    type="button"
                    className="hud-btn hud-speed-realtime-btn"
                    disabled={!simReady}
                    title="Reset simulation speed to realtime"
                    onClick={() => {
                      setSpeedEditing(false);
                      setSpeedUnit("s");
                      setSimSpeedSlider(0);
                    }}
                  >
                    Realtime
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {showLoadingOverlay && (
        <div
          className="loading-overlay"
          role="status"
          aria-live="polite"
          aria-label={loadingLabel}
        >
          <div className="loading-overlay-card">
            <div className="loading-overlay-spinner" aria-hidden="true">
              <div className="loading-saturn">
                <div className="loading-saturn-rings">
                  <span className="loading-saturn-ring loading-saturn-ring-outer" />
                  <span className="loading-saturn-ring loading-saturn-ring-inner" />
                </div>
                <div className="loading-saturn-body" />
              </div>
            </div>
            <p className="loading-overlay-title">{loadingLabel}</p>
            <p className="loading-overlay-copy">
              Preparing ephemeris and textures…
            </p>
          </div>
        </div>
      )}
      <ErrorReportModal
        open={errorReportOpen}
        loading={errorReportLoading}
        error={errorReportError}
        report={errorReport}
        onClose={() => setErrorReportOpen(false)}
      />
    </div>
  );
}
