import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  MathUtils,
  Matrix4,
  ShaderMaterial,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type Scene,
} from "three";
import { BODIES, type BodyId } from "../data";
import {
  isSystemFocusId,
  keplerStateAboutBarycenter,
  orbitReferenceBarycenter,
  planetarySystemBarycenterFrame,
  planetarySystemFocusIdsAmong,
  planetarySystemFocusIdsFromParents,
  primaryHasBoundSatellites,
  solarSystemBarycenterFrame,
  stateToClassicalElements,
  systemFocusIdForPrimary,
  systemPrimaryId,
  type ClassicalOrbitalElements,
  type NbodyBody,
  type OrbitalParentMap,
  type SystemFocusId,
} from "../simulation";
import { resolveBodyTagColor } from "./bodyTagColor";
import {
  computeSystemLodStates,
  systemOrbitMemberLodWeight,
} from "./systemLod";
import { apparentSizePx, SUBPIXEL_CULL_PX } from "./visibility";

/** Hide member orbits once system-LOD opacity falls below this. */
const LOD_HIDE_OPACITY = 0.02;

/**
 * Ellipse segment budget. Absolute chord sagitta ≈ r·π²/(2N²), so distant
 * heliocentric orbits need far more samples than lunar ones. Samples are also
 * densified near the body (see `anomalySampleWarp`).
 */
const MIN_ELLIPSE_SEGMENTS = 512;
const MAX_ELLIPSE_SEGMENTS = 8192;
/** Samples along a hyperbolic branch (scaled with periapsis distance). */
const MIN_HYPERBOLA_SEGMENTS = 256;
const MAX_HYPERBOLA_SEGMENTS = 4096;
const MAX_ORBIT_POINTS =
  Math.max(MAX_ELLIPSE_SEGMENTS, MAX_HYPERBOLA_SEGMENTS) + 1;
/**
 * Target circular-orbit chord sagitta (m) used to pick N.
 * Local densification near the body tightens this further on-path.
 */
const TARGET_CHORD_SAGITTA_M = 50_000;
/**
 * Cluster samples near the body: f'(0) = 1 − β (must keep β < 1 so f is
 * strictly increasing on the loop).
 */
const ANOMALY_DENSITY_BETA = 0.85;
/** Keep hyperbolic true anomaly this far inside the asymptote. */
const HYPERBOLA_NU_MARGIN_RAD = 0.08;
const TWO_PI = Math.PI * 2;
/** Peak trail opacity just behind the body. */
const TRAIL_PEAK_OPACITY = 0.9;
/** Refresh segment budget when characteristic radius drifts by this fraction. */
const SHAPE_SCALE_SEGMENTS_REL_TOL = 0.05;

/**
 * Relative-to-eye orbit lines: world positions are split into float32 high/low
 * pairs so camera-relative reconstruction stays precise at Sedna-scale meters.
 */
const ORBIT_LINE_VERTEX = /* glsl */ `
attribute vec3 positionHigh;
attribute vec3 positionLow;
attribute float trail;
uniform vec3 uCameraHigh;
uniform vec3 uCameraLow;
uniform mat4 uViewRotation;
varying float vTrail;

#include <common>
#include <logdepthbuf_pars_vertex>

void main() {
  vTrail = trail;
  vec3 posRTE = (positionHigh - uCameraHigh) + (positionLow - uCameraLow);
  vec4 mvPosition = uViewRotation * vec4(posRTE, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const ORBIT_LINE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uLodOpacity;
varying float vTrail;

#include <common>
#include <logdepthbuf_pars_fragment>

void main() {
  float alpha = vTrail * uLodOpacity;
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <logdepthbuf_fragment>
}
`;

/** Body or planetary-system id that can own an orbit polyline. */
export type OrbitId = BodyId | SystemFocusId;

/** Segment budget only — the drawn conic is always the live osculating fit. */
type OrbitShapeCache = {
  elliptic: boolean;
  orbitScaleM: number;
  segments: number;
};

type OrbitEntry = {
  id: OrbitId;
  root: Group;
  line: Line;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  positionHigh: Float32Array;
  positionLow: Float32Array;
  trails: Float32Array;
  enabled: boolean;
  shape: OrbitShapeCache | null;
  /** Orbit reference barycenter (world m) — used for subpixel culling. */
  centerX: number;
  centerY: number;
  centerZ: number;
};

export type OrbitUpdateRenderContext = {
  camera: Camera;
  viewportHeightPx: number;
};

export type BodyOrbits = {
  /**
   * Rebuild every enabled orbit from the live n-body state.
   * `dtSeconds` is accepted for call-site compatibility and ignored: the
   * osculating conic always passes through the current relative state.
   *
   * When `renderContext` is set, skips vertex buffer fills for orbits that
   * would be hidden by system orbit LOD or subpixel culling (same rules as
   * `prepareRender`), but still refreshes barycenter and shape scale.
   */
  update: (
    bodies: readonly NbodyBody[],
    dtSeconds?: number,
    renderContext?: OrbitUpdateRenderContext,
  ) => void;
  /**
   * Call each frame before render with the live camera (world meters).
   * Applies RTE uniforms, subpixel culling, and system↔member orbit LOD.
   */
  prepareRender: (
    camera: Camera,
    viewportHeightPx: number,
    bodies?: readonly NbodyBody[],
  ) => void;
  syncVisibility: (visibleIds: ReadonlySet<OrbitId>) => void;
  setVisible: (id: OrbitId, visible: boolean) => void;
  dispose: () => void;
};

/**
 * Ids that can show an orbit trail: every available body, plus each planetary
 * system that currently has bound satellites (live hierarchy when provided).
 */
export function orbitBodyIds(
  bodyIds: readonly BodyId[],
  parentByBody?: OrbitalParentMap | null,
): OrbitId[] {
  const systems = parentByBody
    ? planetarySystemFocusIdsFromParents(parentByBody)
    : planetarySystemFocusIdsAmong(bodyIds);
  return [...bodyIds, ...systems];
}

function applyLineVisibility(entry: OrbitEntry): void {
  const show = entry.enabled;
  entry.root.visible = show;
  entry.line.visible = show;
}

function createOrbitMaterial(hex: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(hex) },
      uLodOpacity: { value: 1 },
      uCameraHigh: { value: new Vector3() },
      uCameraLow: { value: new Vector3() },
      uViewRotation: { value: new Matrix4() },
    },
    vertexShader: ORBIT_LINE_VERTEX,
    fragmentShader: ORBIT_LINE_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
}

/** Comets: orbit trail follows coma tint; otherwise tag/nucleus color. */
function resolveOrbitLineColor(bodyId: BodyId, bodyGroup: Group): number {
  const comaColor = BODIES[bodyId]?.cometEffects?.comaColor;
  if (typeof comaColor === "number" && Number.isFinite(comaColor)) {
    return MathUtils.clamp(Math.round(comaColor), 0, 0xffffff);
  }
  return resolveBodyTagColor(bodyId, bodyGroup).hex;
}

/** Wake opacity by fraction behind the body: 1 at the body → 0 at full orbit. */
function wakeTrailOpacity(fractionBehind: number): number {
  if (!(fractionBehind > 1e-12)) return 1;
  if (fractionBehind >= 1) return 0;
  return TRAIL_PEAK_OPACITY * (1 - fractionBehind);
}

/** Characteristic radius for chord-error budgeting (apoapsis for ellipses). */
function orbitCharacteristicRadiusM(
  elements: ClassicalOrbitalElements,
): number {
  const e = elements.eccentricity;
  const p = elements.semiLatusRectumM;
  if (!(p > 0)) return 0;
  if (e < 1) {
    const a =
      elements.semiMajorAxisM > 0
        ? elements.semiMajorAxisM
        : p / Math.max(1e-16, 1 - e * e);
    return a * (1 + Math.min(e, 0.999999));
  }
  // Hyperbolic branch drawn near periapsis.
  return p / (1 + e);
}

/** Segment count so circular sagitta at `radiusM` stays near the target. */
function segmentCountForRadius(
  radiusM: number,
  minSeg: number,
  maxSeg: number,
): number {
  if (!(radiusM > 0)) return minSeg;
  const n = Math.PI * Math.sqrt(radiusM / (2 * TARGET_CHORD_SAGITTA_M));
  const clamped = Math.min(maxSeg, Math.max(minSeg, Math.ceil(n)));
  // Keep multiples of 64 — friendlier for GPU cache lines / draw ranges.
  return Math.min(maxSeg, Math.max(minSeg, Math.ceil(clamped / 64) * 64));
}

/**
 * Warp s∈[0,1] so samples cluster near s = 0 (the body).
 * f(s) = s − (β/2π)·sin(2πs) is strictly increasing for β < 1.
 */
function anomalySampleWarp(s: number): number {
  return s - (ANOMALY_DENSITY_BETA / TWO_PI) * Math.sin(TWO_PI * s);
}

/** Split a JS float64 into float32 hi/lo so their sum reconstructs x in f64. */
function splitDouble(x: number): [number, number] {
  const high = Math.fround(x);
  return [high, x - high];
}

function writeWorldSplit(
  high: Float32Array,
  low: Float32Array,
  index: number,
  wx: number,
  wy: number,
  wz: number,
): void {
  const o = index * 3;
  const [hx, lx] = splitDouble(wx);
  const [hy, ly] = splitDouble(wy);
  const [hz, lz] = splitDouble(wz);
  high[o] = hx;
  high[o + 1] = hy;
  high[o + 2] = hz;
  low[o] = lx;
  low[o + 1] = ly;
  low[o + 2] = lz;
}

/** PQW→IJK rotation from classical angles (position columns only). */
function orbitBasis(
  inclinationRad: number,
  raanRad: number,
  argPeriapsisRad: number,
): {
  r11: number;
  r12: number;
  r21: number;
  r22: number;
  r31: number;
  r32: number;
} {
  const cosO = Math.cos(raanRad);
  const sinO = Math.sin(raanRad);
  const cosI = Math.cos(inclinationRad);
  const sinI = Math.sin(inclinationRad);
  const cosW = Math.cos(argPeriapsisRad);
  const sinW = Math.sin(argPeriapsisRad);
  return {
    r11: cosO * cosW - sinO * sinW * cosI,
    r12: -cosO * sinW - sinO * cosW * cosI,
    r21: sinO * cosW + cosO * sinW * cosI,
    r22: -sinO * sinW + cosO * cosW * cosI,
    r31: sinW * sinI,
    r32: cosW * sinI,
  };
}

/**
 * Open wake polyline in world meters (encoded as float32 high/low pairs).
 * Rotation is built once; the inner loop only varies true anomaly (no per-point
 * `classicalElementsToState` allocations).
 */
function fillEllipse(
  high: Float32Array,
  low: Float32Array,
  trails: Float32Array,
  elements: ClassicalOrbitalElements,
  segments: number,
  frame: { x: number; y: number; z: number },
): boolean {
  const p = elements.semiLatusRectumM;
  const e = elements.eccentricity;
  if (!(p > 0)) return false;
  const { r11, r12, r21, r22, r31, r32 } = orbitBasis(
    elements.inclinationRad,
    elements.raanRad,
    elements.argPeriapsisRad,
  );
  const nuBody = elements.trueAnomalyRad;
  const last = Math.max(segments - 1, 1);
  const fx = frame.x;
  const fy = frame.y;
  const fz = frame.z;
  for (let i = 0; i < segments; i++) {
    const s = i / last;
    const behind = anomalySampleWarp(s);
    const nu = nuBody - behind * TWO_PI;
    const cosNu = Math.cos(nu);
    const sinNu = Math.sin(nu);
    const denom = 1 + e * cosNu;
    if (!(Math.abs(denom) > 1e-15)) return false;
    const rp = (p * cosNu) / denom;
    const rq = (p * sinNu) / denom;
    writeWorldSplit(
      high,
      low,
      i,
      fx + r11 * rp + r12 * rq,
      fy + r21 * rp + r22 * rq,
      fz + r31 * rp + r32 * rq,
    );
    trails[i] = wakeTrailOpacity(behind);
  }
  trails[0] = 1;
  return true;
}

function fillHyperbola(
  high: Float32Array,
  low: Float32Array,
  trails: Float32Array,
  elements: ClassicalOrbitalElements,
  segments: number,
  frame: { x: number; y: number; z: number },
): boolean {
  const e = elements.eccentricity;
  const p = elements.semiLatusRectumM;
  if (!(e > 1) || !(p > 0)) return false;
  const nuMax =
    Math.acos(Math.min(1, Math.max(-1, -1 / e))) - HYPERBOLA_NU_MARGIN_RAD;
  if (!(nuMax > 0)) return false;

  let nuRaw = elements.trueAnomalyRad;
  if (nuRaw > Math.PI) nuRaw -= TWO_PI;
  const nuBody = Math.min(nuMax, Math.max(-nuMax, nuRaw));
  const span = nuBody - -nuMax;
  if (!(span > 0)) return false;

  const { r11, r12, r21, r22, r31, r32 } = orbitBasis(
    elements.inclinationRad,
    elements.raanRad,
    elements.argPeriapsisRad,
  );
  const last = Math.max(segments - 1, 1);
  const fx = frame.x;
  const fy = frame.y;
  const fz = frame.z;
  for (let i = 0; i < segments; i++) {
    const s = i / last;
    const behind = anomalySampleWarp(s);
    const nu = nuBody - behind * span;
    const cosNu = Math.cos(nu);
    const sinNu = Math.sin(nu);
    const denom = 1 + e * cosNu;
    if (!(Math.abs(denom) > 1e-15)) return false;
    const rp = (p * cosNu) / denom;
    const rq = (p * sinNu) / denom;
    writeWorldSplit(
      high,
      low,
      i,
      fx + r11 * rp + r12 * rq,
      fy + r21 * rp + r22 * rq,
      fz + r31 * rp + r32 * rq,
    );
    trails[i] = wakeTrailOpacity(behind);
  }
  trails[0] = 1;
  return true;
}

function createOrbitEntry(id: OrbitId, hex: number, parent: Group): OrbitEntry {
  const geometry = new BufferGeometry();
  const positionHigh = new Float32Array(MAX_ORBIT_POINTS * 3);
  const positionLow = new Float32Array(MAX_ORBIT_POINTS * 3);
  const trails = new Float32Array(MAX_ORBIT_POINTS);
  // `position` shares the high buffer so Three.js bounds stay populated.
  geometry.setAttribute("position", new BufferAttribute(positionHigh, 3));
  geometry.setAttribute("positionHigh", new BufferAttribute(positionHigh, 3));
  geometry.setAttribute("positionLow", new BufferAttribute(positionLow, 3));
  geometry.setAttribute("trail", new BufferAttribute(trails, 1));
  geometry.setDrawRange(0, MIN_ELLIPSE_SEGMENTS);

  const material = createOrbitMaterial(hex);
  const line = new Line(geometry, material);
  line.name = `${id}-orbit-line`;
  line.frustumCulled = false;

  const orbitRoot = new Group();
  orbitRoot.name = `${id}-orbit`;
  orbitRoot.add(line);
  parent.add(orbitRoot);

  return {
    id,
    root: orbitRoot,
    line,
    geometry,
    material,
    positionHigh,
    positionLow,
    trails,
    enabled: true,
    shape: null,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
  };
}

function segmentBudget(
  elements: ClassicalOrbitalElements,
  prev: OrbitShapeCache | null,
): OrbitShapeCache {
  const elliptic = elements.eccentricity < 1;
  const radiusM = orbitCharacteristicRadiusM(elements);
  const orbitScaleM = Math.max(radiusM, 1);
  const scaleOk =
    prev != null &&
    prev.elliptic === elliptic &&
    prev.orbitScaleM > 0 &&
    Math.abs(orbitScaleM - prev.orbitScaleM) <=
      SHAPE_SCALE_SEGMENTS_REL_TOL * prev.orbitScaleM;
  const segments =
    scaleOk && prev != null
      ? prev.segments
      : elliptic
        ? segmentCountForRadius(
            orbitScaleM,
            MIN_ELLIPSE_SEGMENTS,
            MAX_ELLIPSE_SEGMENTS,
          )
        : segmentCountForRadius(
            orbitScaleM,
            MIN_HYPERBOLA_SEGMENTS,
            MAX_HYPERBOLA_SEGMENTS,
          );
  return { elliptic, orbitScaleM, segments };
}

function orbitLodOpacity(
  orbitId: OrbitId,
  bodySystemId: Map<BodyId, SystemFocusId> | null,
  systemLodById: ReturnType<typeof computeSystemLodStates>["bySystemId"] | null,
): number {
  if (isSystemFocusId(orbitId) || !bodySystemId || !systemLodById) return 1;
  const systemId = bodySystemId.get(orbitId);
  if (!systemId) return 1;
  const systemLod = systemLodById.get(systemId);
  return systemLod ? systemOrbitMemberLodWeight(systemLod.diameterPx) : 0;
}

/** Same visibility test as `prepareRender` (LOD + subpixel). */
function orbitWouldRender(
  orbitId: OrbitId,
  orbitScaleM: number,
  centerX: number,
  centerY: number,
  centerZ: number,
  camera: PerspectiveCamera,
  viewportHeightPx: number,
  bodySystemId: Map<BodyId, SystemFocusId> | null,
  systemLodById: ReturnType<typeof computeSystemLodStates>["bySystemId"] | null,
): boolean {
  const lodOpacity = orbitLodOpacity(orbitId, bodySystemId, systemLodById);
  if (!(lodOpacity > LOD_HIDE_OPACITY)) return false;
  if (!(viewportHeightPx > 0)) return true;

  const distanceM = Math.max(
    Math.hypot(
      centerX - camera.position.x,
      centerY - camera.position.y,
      centerZ - camera.position.z,
    ),
    1,
  );
  const diameterPx = apparentSizePx(
    orbitScaleM,
    distanceM,
    camera,
    viewportHeightPx,
  );
  return diameterPx >= SUBPIXEL_CULL_PX;
}

/**
 * Draw the live osculating conic through `relPos`.
 */
function applyOrbitGeometry(
  entry: OrbitEntry,
  relPos: { x: number; y: number; z: number },
  relVel: { x: number; y: number; z: number },
  mu: number,
  framePosition: { x: number; y: number; z: number },
  cull?: {
    perspective: PerspectiveCamera;
    viewportHeightPx: number;
    bodySystemId: Map<BodyId, SystemFocusId> | null;
    systemLodById:
      | ReturnType<typeof computeSystemLodStates>["bySystemId"]
      | null;
  },
): boolean {
  const elements = stateToClassicalElements(relPos, relVel, mu);
  if (!elements || !(elements.semiLatusRectumM > 0)) {
    entry.root.visible = false;
    entry.shape = null;
    return false;
  }

  const shape = segmentBudget(elements, entry.shape);
  entry.shape = shape;
  entry.centerX = framePosition.x;
  entry.centerY = framePosition.y;
  entry.centerZ = framePosition.z;

  if (
    cull &&
    !orbitWouldRender(
      entry.id,
      shape.orbitScaleM,
      entry.centerX,
      entry.centerY,
      entry.centerZ,
      cull.perspective,
      cull.viewportHeightPx,
      cull.bodySystemId,
      cull.systemLodById,
    )
  ) {
    return true;
  }

  const ok = shape.elliptic
    ? fillEllipse(
        entry.positionHigh,
        entry.positionLow,
        entry.trails,
        elements,
        shape.segments,
        framePosition,
      )
    : fillHyperbola(
        entry.positionHigh,
        entry.positionLow,
        entry.trails,
        elements,
        shape.segments,
        framePosition,
      );
  if (!ok) {
    entry.root.visible = false;
    return false;
  }

  entry.root.position.set(0, 0, 0);
  entry.root.scale.set(1, 1, 1);

  const highAttr = entry.geometry.getAttribute(
    "positionHigh",
  ) as BufferAttribute;
  const lowAttr = entry.geometry.getAttribute("positionLow") as BufferAttribute;
  const trailAttr = entry.geometry.getAttribute("trail") as BufferAttribute;
  highAttr.needsUpdate = true;
  lowAttr.needsUpdate = true;
  trailAttr.needsUpdate = true;
  entry.geometry.setDrawRange(0, shape.segments);
  entry.root.visible = true;
  return true;
}

/**
 * Keplerian orbit polylines:
 * - moons → about parent planetary-system barycenter
 * - planets with bound moons → about their own system barycenter
 * - lone heliocentric bodies / Sun → about solar-system barycenter
 * - planetary systems (with moons) → system barycenter about SSB
 *
 * Each path uses μ = G·M_rest³/M_tot² so a body's ellipse about the COM
 * matches the two-body geometry (fixes Pluto–Charon-scale mass ratios).
 * Segment count scales with apoapsis (chord sagitta ∝ r/N²), samples cluster
 * near the body, and GPU verts use relative-to-eye float32 splitting.
 */
export function attachBodyOrbits(
  scene: Scene,
  bodyGroups: Map<BodyId, Group>,
): BodyOrbits {
  const root = new Group();
  root.name = "body-orbits";
  scene.add(root);

  const entries: OrbitEntry[] = [];
  const byId = new Map<OrbitId, OrbitEntry>();
  const viewRotation = new Matrix4();
  const cameraHigh = new Vector3();
  const cameraLow = new Vector3();

  for (const [bodyId, bodyGroup] of bodyGroups) {
    if (!BODIES[bodyId]) continue;
    const entry = createOrbitEntry(
      bodyId,
      resolveOrbitLineColor(bodyId, bodyGroup),
      root,
    );
    applyLineVisibility(entry);
    entries.push(entry);
    byId.set(bodyId, entry);
  }

  // Potential system orbits for every loaded primary (shown only while bound
  // satellites exist — see update()). Covers catalog moons and captures.
  for (const bodyId of bodyGroups.keys()) {
    if (bodyId === "sun") continue;
    const bodyGroup = bodyGroups.get(bodyId);
    if (!bodyGroup) continue;
    const systemId = systemFocusIdForPrimary(bodyId);
    const entry = createOrbitEntry(
      systemId,
      resolveOrbitLineColor(bodyId, bodyGroup),
      root,
    );
    applyLineVisibility(entry);
    entries.push(entry);
    byId.set(systemId, entry);
  }

  return {
    update(bodies, _dtSeconds = 0, renderContext) {
      void _dtSeconds;
      if (bodies.length === 0) return;
      const byBody = new Map<BodyId, NbodyBody>();
      for (const body of bodies) byBody.set(body.id, body);

      const ssb = solarSystemBarycenterFrame(bodies);

      let perspective: PerspectiveCamera | null = null;
      let bodySystemId: Map<BodyId, SystemFocusId> | null = null;
      let systemLodById:
        | ReturnType<typeof computeSystemLodStates>["bySystemId"]
        | null = null;
      const viewportHeightPx = renderContext?.viewportHeightPx ?? 0;
      if (renderContext) {
        const camera = renderContext.camera;
        perspective = (camera as PerspectiveCamera).isPerspectiveCamera
          ? (camera as PerspectiveCamera)
          : null;
        if (perspective && viewportHeightPx > 0) {
          const lod = computeSystemLodStates(
            perspective,
            viewportHeightPx,
            bodies,
          );
          bodySystemId = lod.bodySystemId;
          systemLodById = lod.bySystemId;
        }
      }

      const geometryCull =
        perspective && renderContext
          ? {
              perspective,
              viewportHeightPx,
              bodySystemId,
              systemLodById,
            }
          : undefined;

      for (const entry of entries) {
        if (!entry.enabled) continue;

        if (isSystemFocusId(entry.id)) {
          const primaryId = systemPrimaryId(entry.id);
          if (!primaryId || !ssb) {
            entry.root.visible = false;
            continue;
          }
          if (!primaryHasBoundSatellites(primaryId, bodies)) {
            entry.root.visible = false;
            continue;
          }
          const sys = planetarySystemBarycenterFrame(primaryId, bodies);
          if (!sys) {
            entry.root.visible = false;
            continue;
          }
          // Derived system barycenter about SSB, orbiting mass = total system
          // mass (one composite object). With the barycenter-parked hierarchy,
          // this state is free of binary epicycle.
          const state = keplerStateAboutBarycenter(
            sys.positionM,
            sys.velocityMS,
            sys.totalMassKg,
            ssb,
          );
          if (!state) {
            entry.root.visible = false;
            continue;
          }
          applyOrbitGeometry(
            entry,
            state.relativePositionM,
            state.relativeVelocityMS,
            state.mu,
            state.barycenterPositionM,
            geometryCull,
          );
          continue;
        }

        const body = byBody.get(entry.id);
        if (!body) {
          entry.root.visible = false;
          continue;
        }

        const frame = orbitReferenceBarycenter(body, bodies);
        if (!frame) {
          entry.root.visible = false;
          continue;
        }

        // Body about its reference COM (e.g. Pluto/Charon about PCB).
        // μ = G·M_rest³/M_tot² — not G·M_tot — so comparable-mass binaries
        // get stable ellipses instead of a spuriously precessing fit.
        const state = keplerStateAboutBarycenter(
          body.state.positionM,
          body.state.velocityMS,
          body.mass,
          frame,
        );
        if (!state) {
          entry.root.visible = false;
          continue;
        }
        applyOrbitGeometry(
          entry,
          state.relativePositionM,
          state.relativeVelocityMS,
          state.mu,
          state.barycenterPositionM,
          geometryCull,
        );
      }
    },

    prepareRender(camera, viewportHeightPx, bodies = []) {
      camera.updateMatrixWorld();
      const [hx, lx] = splitDouble(camera.position.x);
      const [hy, ly] = splitDouble(camera.position.y);
      const [hz, lz] = splitDouble(camera.position.z);
      cameraHigh.set(hx, hy, hz);
      cameraLow.set(lx, ly, lz);

      // View matrix with translation removed — RTE already put the eye at 0.
      viewRotation.copy(camera.matrixWorldInverse);
      const e = viewRotation.elements;
      e[12] = 0;
      e[13] = 0;
      e[14] = 0;

      const perspective = (camera as PerspectiveCamera).isPerspectiveCamera
        ? (camera as PerspectiveCamera)
        : null;

      let bodySystemId: Map<BodyId, SystemFocusId> | null = null;
      let systemLodById:
        | ReturnType<typeof computeSystemLodStates>["bySystemId"]
        | null = null;
      if (perspective && viewportHeightPx > 0 && bodies.length > 0) {
        const lod = computeSystemLodStates(
          perspective,
          viewportHeightPx,
          bodies,
        );
        bodySystemId = lod.bodySystemId;
        systemLodById = lod.bySystemId;
      }

      for (const entry of entries) {
        if (!entry.enabled || !entry.shape) {
          entry.root.visible = false;
          entry.line.visible = false;
          continue;
        }

        const lodOpacity = orbitLodOpacity(
          entry.id,
          bodySystemId,
          systemLodById,
        );
        const show =
          perspective != null
            ? orbitWouldRender(
                entry.id,
                entry.shape.orbitScaleM,
                entry.centerX,
                entry.centerY,
                entry.centerZ,
                perspective,
                viewportHeightPx,
                bodySystemId,
                systemLodById,
              )
            : lodOpacity > LOD_HIDE_OPACITY;

        entry.root.visible = show;
        entry.line.visible = show;
        if (!show) continue;

        const { uniforms } = entry.material;
        uniforms.uLodOpacity.value = lodOpacity;
        uniforms.uCameraHigh.value.copy(cameraHigh);
        uniforms.uCameraLow.value.copy(cameraLow);
        uniforms.uViewRotation.value.copy(viewRotation);
      }
    },

    syncVisibility(visibleIds) {
      for (const entry of entries) {
        entry.enabled = visibleIds.has(entry.id);
        applyLineVisibility(entry);
      }
    },

    setVisible(id, visible) {
      const entry = byId.get(id);
      if (!entry) return;
      entry.enabled = visible;
      applyLineVisibility(entry);
    },

    dispose() {
      root.removeFromParent();
      for (const entry of entries) {
        entry.geometry.dispose();
        entry.material.dispose();
      }
      entries.length = 0;
      byId.clear();
    },
  };
}
