/**
 * Dotted heliocentric ellipse of a Solar System planet, drawn about another
 * system's barycenter as a scale reference (e.g. Mercury for compact systems,
 * Jupiter when the exoplanet system is wider).
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Line,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type Scene,
} from "three";
import {
  BODIES,
  bodiesForStellarSystem,
  type BodyId,
  type StellarSystemId,
} from "../data";
import {
  AU_M,
  fetchAllSpkStates,
  transformStateToInvariable,
} from "../ephemeris";
import {
  satelliteOrbitAboutPlanetarySystem,
  type NbodyBody,
} from "../simulation";
import { G } from "../simulation/nbody";
import {
  stateToClassicalElements,
  type ClassicalOrbitalElements,
} from "../simulation/orbitalElements";
import {
  computeSystemLodStates,
  systemOrbitMemberLodWeight,
  systemTagLodWeights,
} from "./systemLod";

const ELLIPSE_SEGMENTS = 1024;
/** World-space dash/gap at Mercury's scale (~100 marks around the orbit). */
const MERCURY_DASH_SIZE_M = 1.2e9;
const MERCURY_GAP_SIZE_M = 8e8;
const MERCURY_SMA_AU = 0.38709893;
/** Muted rocky gray when the reference body has no solid catalog color. */
const REFERENCE_COLOR_HEX = 0xb8b0a4;
const LABEL_FONT_PX = 13;
const LABEL_PAD_PX = 5;
const LABEL_FONT = `600 ${LABEL_FONT_PX}px ui-sans-serif, system-ui, sans-serif`;
const LINE_BASE_OPACITY = 0.55;
const LABEL_BASE_OPACITY = 0.85;
/** Match member-orbit / tag hide threshold in orbitEllipses / bodyLabels. */
const LOD_HIDE_OPACITY = 0.02;

/**
 * Approximate heliocentric semimajor axes (AU) for choosing a Sol scale
 * reference without an SPK round-trip.
 */
const SOL_PLANET_SMA_AU: { id: BodyId; smaAu: number }[] = [
  { id: "mercury", smaAu: MERCURY_SMA_AU },
  { id: "venus", smaAu: 0.72333199 },
  { id: "earth", smaAu: 1.00000011 },
  { id: "mars", smaAu: 1.52366231 },
  { id: "jupiter", smaAu: 5.20336301 },
  { id: "saturn", smaAu: 9.53707032 },
  { id: "uranus", smaAu: 19.19126393 },
  { id: "neptune", smaAu: 30.06896348 },
  { id: "pluto", smaAu: 39.482 },
];

const _parentWorldQuat = new Quaternion();
const _billboardLocal = new Quaternion();
const _labelWorld = new Vector3();

export type SolScaleReferenceOrbit = {
  /** Replace the frozen osculating ellipse (typically at epoch load). */
  setElements: (elements: ClassicalOrbitalElements) => void;
  /** Move the focus to the active system barycenter (world m). */
  setCenter: (x: number, y: number, z: number) => void;
  /**
   * Billboard + screen-scale the orbit label; when `lodMemberId` + bodies are
   * set, fade like that body's member orbit / tag (system LOD).
   */
  update: (
    camera: Camera,
    viewportHeightPx: number,
    bodies?: readonly NbodyBody[],
    lodMemberId?: BodyId | null,
  ) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
};

function hexToCss(hex: number): string {
  return `#${Math.max(0, Math.min(0xffffff, Math.round(hex)))
    .toString(16)
    .padStart(6, "0")}`;
}

function bodyDisplayName(bodyId: BodyId): string {
  const name = BODIES[bodyId]?.name ?? bodyId;
  // Strip catalog designations like "Jupiter" stays; "Sun [Sol]" unused here.
  const bracket = name.indexOf("[");
  return (bracket >= 0 ? name.slice(0, bracket) : name).trim();
}

/** Sol planet whose heliocentric SMA is nearest `|sma − targetAu|`. */
function nearestSolPlanetBySmaAu(targetAu: number): BodyId {
  let best: BodyId = "mercury";
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const entry of SOL_PLANET_SMA_AU) {
    const delta = Math.abs(entry.smaAu - targetAu);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = entry.id;
    }
  }
  return best;
}

/**
 * Sol planet whose orbit is the closest in size to the exoplanet system's
 * outermost catalog semimajor axis, without being smaller.
 *
 * HD 80606: match HD 80606 b’s apastron (Earth ≈ 0.89 AU), drawn about the host.
 */
export function solScaleReferenceBodyId(systemId: StellarSystemId): BodyId {
  if (systemId === "hd-80606") {
    const el = BODIES.hd80606b?.keplerianElements;
    const a = el?.semiMajorAxisM ?? 0;
    const e = el?.eccentricity ?? 0;
    if (a > 0 && e >= 0 && e < 1) {
      return nearestSolPlanetBySmaAu((a * (1 + e)) / AU_M);
    }
    return "earth";
  }

  let maxSemiMajorM = 0;
  for (const body of bodiesForStellarSystem(systemId)) {
    const a = body.keplerianElements?.semiMajorAxisM;
    if (a != null && a > maxSemiMajorM) maxSemiMajorM = a;
  }
  const targetAu = maxSemiMajorM > 0 ? maxSemiMajorM / AU_M : 0;

  let best: BodyId = "mercury";
  let bestAu = Number.POSITIVE_INFINITY;
  for (const entry of SOL_PLANET_SMA_AU) {
    if (entry.smaAu + 1e-9 < targetAu) continue;
    if (entry.smaAu < bestAu) {
      bestAu = entry.smaAu;
      best = entry.id;
    }
  }
  // If the system is wider than Pluto, still use Pluto as the outer bound.
  if (!Number.isFinite(bestAu)) {
    return SOL_PLANET_SMA_AU[SOL_PLANET_SMA_AU.length - 1]!.id;
  }
  return best;
}

/** World-space focus for the Sol scale ellipse (host star or system COM). */
export function solScaleReferenceCenterBodyId(
  systemId: StellarSystemId,
): BodyId | null {
  // Planet-scale reference about the hot-Jupiter host, not the binary COM.
  if (systemId === "hd-80606") return "hd80606";
  return null;
}

/**
 * Body whose planetary-system membership drives Sol-scale LOD (same fade as
 * that member’s orbit + tag). `null` → always fully opaque.
 */
export function solScaleReferenceLodMemberId(
  systemId: StellarSystemId,
): BodyId | null {
  if (systemId === "hd-80606") return "hd80606b";
  return null;
}

/**
 * Keep Sol a/e/ω (size + in-plane periapsis), replace i/Ω so the ellipse lies
 * in the subsystem invariable plane (scene-frame orientation of that plane).
 */
export function alignSolScaleElementsToSubsystemPlane(
  solElements: ClassicalOrbitalElements,
  subsystemOrientation: Pick<
    ClassicalOrbitalElements,
    "inclinationRad" | "raanRad"
  >,
): ClassicalOrbitalElements {
  return {
    ...solElements,
    inclinationRad: subsystemOrientation.inclinationRad,
    raanRad: subsystemOrientation.raanRad,
  };
}

/**
 * Osculating i/Ω of the HD 80606+b subsystem in the scene frame (planet about
 * the planetary-system barycenter — that plane is the two-body invariable).
 */
export function hd80606SubsystemOrientation(
  bodies: readonly NbodyBody[],
): Pick<ClassicalOrbitalElements, "inclinationRad" | "raanRad"> | null {
  const orbit = satelliteOrbitAboutPlanetarySystem("hd80606b", bodies);
  if (!orbit) return null;
  return {
    inclinationRad: orbit.elements.inclinationRad,
    raanRad: orbit.elements.raanRad,
  };
}

function orbitBasis(elements: ClassicalOrbitalElements): {
  r11: number;
  r12: number;
  r21: number;
  r22: number;
  r31: number;
  r32: number;
} {
  const cosO = Math.cos(elements.raanRad);
  const sinO = Math.sin(elements.raanRad);
  const cosI = Math.cos(elements.inclinationRad);
  const sinI = Math.sin(elements.inclinationRad);
  const cosW = Math.cos(elements.argPeriapsisRad);
  const sinW = Math.sin(elements.argPeriapsisRad);
  return {
    r11: cosO * cosW - sinO * sinW * cosI,
    r12: -cosO * sinW - sinO * cosW * cosI,
    r21: sinO * cosW + cosO * sinW * cosI,
    r22: -sinO * sinW + cosO * cosW * cosI,
    r31: sinW * sinI,
    r32: cosW * sinI,
  };
}

/** Focus-centered point on the ellipse at true anomaly `nuRad`. */
function ellipsePointAtNu(
  elements: ClassicalOrbitalElements,
  nuRad: number,
): Vector3 | null {
  const p = elements.semiLatusRectumM;
  const e = elements.eccentricity;
  if (!(p > 0) || !(e >= 0) || e >= 1) return null;
  const denom = 1 + e * Math.cos(nuRad);
  if (!(Math.abs(denom) > 1e-15)) return null;
  const rp = (p * Math.cos(nuRad)) / denom;
  const rq = (p * Math.sin(nuRad)) / denom;
  const { r11, r12, r21, r22, r31, r32 } = orbitBasis(elements);
  return new Vector3(
    r11 * rp + r12 * rq,
    r21 * rp + r22 * rq,
    r31 * rp + r32 * rq,
  );
}

/**
 * Closed focus-centered ellipse in local meters (focus at origin).
 * Returns false when the conic is degenerate.
 */
function fillClosedEllipse(
  positions: Float32Array,
  elements: ClassicalOrbitalElements,
  segments: number,
): boolean {
  const p = elements.semiLatusRectumM;
  const e = elements.eccentricity;
  if (!(p > 0) || !(e >= 0) || e >= 1) return false;
  const { r11, r12, r21, r22, r31, r32 } = orbitBasis(elements);
  for (let i = 0; i <= segments; i++) {
    const nu = (i / segments) * Math.PI * 2;
    const cosNu = Math.cos(nu);
    const sinNu = Math.sin(nu);
    const denom = 1 + e * cosNu;
    if (!(Math.abs(denom) > 1e-15)) return false;
    const rp = (p * cosNu) / denom;
    const rq = (p * sinNu) / denom;
    const o = i * 3;
    positions[o] = r11 * rp + r12 * rq;
    positions[o + 1] = r21 * rp + r22 * rq;
    positions[o + 2] = r31 * rp + r32 * rq;
  }
  return true;
}

function createOrbitLabel(
  labelText: string,
  cssColor: string,
): {
  root: Group;
  mesh: Mesh;
  texture: CanvasTexture;
  material: MeshBasicMaterial;
  geometry: PlaneGeometry;
  widthPx: number;
  heightPx: number;
} {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("2D canvas unavailable for orbit label");
  measure.font = LABEL_FONT;
  const widthPx = Math.ceil(
    measure.measureText(labelText).width + LABEL_PAD_PX * 2,
  );
  const heightPx = Math.ceil(LABEL_FONT_PX + LABEL_PAD_PX * 2);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, widthPx);
  canvas.height = Math.max(1, heightPx);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable for orbit label");
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.font = LABEL_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 3;
  ctx.fillStyle = cssColor;
  const x = LABEL_PAD_PX;
  const y = heightPx / 2;
  ctx.strokeText(labelText, x, y);
  ctx.fillText(labelText, x, y);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.85,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "sol-scale-reference-orbit-label-text";
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;

  const root = new Group();
  root.name = "sol-scale-reference-orbit-label";
  root.add(mesh);
  return { root, mesh, texture, material, geometry, widthPx, heightPx };
}

/**
 * Heliocentric osculating elements of a Sol planet at `julianDate` in the
 * solar invariable frame (same convention as the Sol scene).
 */
export async function solPlanetHeliocentricElementsAtEpoch(
  bodyId: BodyId,
  julianDate: number,
): Promise<ClassicalOrbitalElements | null> {
  const sun = BODIES.sun;
  const body = BODIES[bodyId];
  if (!sun || !body) return null;

  const icrf = await fetchAllSpkStates(["sun", bodyId], julianDate);
  const sunIcrf = icrf.sun;
  const bodyIcrf = icrf[bodyId];
  if (!sunIcrf || !bodyIcrf) return null;

  const sunState = transformStateToInvariable(sunIcrf);
  const bodyState = transformStateToInvariable(bodyIcrf);
  const relPos = {
    x: bodyState.positionM.x - sunState.positionM.x,
    y: bodyState.positionM.y - sunState.positionM.y,
    z: bodyState.positionM.z - sunState.positionM.z,
  };
  const relVel = {
    x: bodyState.velocityMS.x - sunState.velocityMS.x,
    y: bodyState.velocityMS.y - sunState.velocityMS.y,
    z: bodyState.velocityMS.z - sunState.velocityMS.z,
  };
  const mu = G * (sun.mass + body.mass);
  return stateToClassicalElements(relPos, relVel, mu);
}

/** Dotted closed ellipse parented under `scene`. */
export function attachSolScaleReferenceOrbit(
  scene: Scene,
  bodyId: BodyId = "mercury",
): SolScaleReferenceOrbit {
  const root = new Group();
  root.name = "sol-scale-reference-orbit";
  scene.add(root);

  const positions = new Float32Array((ELLIPSE_SEGMENTS + 1) * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));

  const catalog = BODIES[bodyId];
  const color =
    typeof catalog?.color === "number" ? catalog.color : REFERENCE_COLOR_HEX;
  const material = new LineDashedMaterial({
    color,
    dashSize: MERCURY_DASH_SIZE_M,
    gapSize: MERCURY_GAP_SIZE_M,
    transparent: true,
    opacity: LINE_BASE_OPACITY,
    depthWrite: false,
  });
  const line = new Line(geometry, material);
  line.name = "sol-scale-reference-orbit-line";
  line.frustumCulled = false;
  root.add(line);

  const labelText = `${bodyDisplayName(bodyId)}'s Sol orbit`;
  const label = createOrbitLabel(labelText, hexToCss(color));
  root.add(label.root);
  root.visible = false;

  let elementsReady = false;
  let userVisible = true;

  const syncRootVisibility = () => {
    root.visible =
      elementsReady && userVisible && (line.visible || label.root.visible);
  };

  return {
    setElements(elements) {
      const ok = fillClosedEllipse(positions, elements, ELLIPSE_SEGMENTS);
      if (!ok) {
        elementsReady = false;
        syncRootVisibility();
        return;
      }
      const attr = geometry.getAttribute("position") as BufferAttribute;
      attr.needsUpdate = true;
      geometry.computeBoundingSphere();

      const smaAu = elements.semiMajorAxisM / AU_M;
      const dashScale = Math.max(smaAu / MERCURY_SMA_AU, 0.25);
      material.dashSize = MERCURY_DASH_SIZE_M * dashScale;
      material.gapSize = MERCURY_GAP_SIZE_M * dashScale;
      line.computeLineDistances();

      // Place the label at apoapsis (outermost point of the ellipse).
      const apo = ellipsePointAtNu(elements, Math.PI);
      if (apo) label.root.position.copy(apo);
      elementsReady = true;
      line.visible = true;
      label.root.visible = true;
      material.opacity = LINE_BASE_OPACITY;
      label.material.opacity = LABEL_BASE_OPACITY;
      syncRootVisibility();
    },

    setCenter(x, y, z) {
      root.position.set(x, y, z);
    },

    update(camera, viewportHeightPx, bodies, lodMemberId) {
      if (!elementsReady || !userVisible) return;
      if (!(camera as PerspectiveCamera).isPerspectiveCamera) return;
      if (!(viewportHeightPx > 0)) return;

      const perspective = camera as PerspectiveCamera;

      let orbitLod = 1;
      let tagLod = 1;
      if (lodMemberId && bodies && bodies.length > 0) {
        const lod = computeSystemLodStates(
          perspective,
          viewportHeightPx,
          bodies,
        );
        const systemId = lod.bodySystemId.get(lodMemberId);
        const systemLod = systemId ? lod.bySystemId.get(systemId) : undefined;
        if (systemLod) {
          orbitLod = systemOrbitMemberLodWeight(systemLod.diameterPx);
          tagLod = systemTagLodWeights(systemLod.diameterPx).memberWeight;
        } else {
          // Not in a planetary system → treat as a lone heliocentric body (full).
          orbitLod = 1;
          tagLod = 1;
        }
      }

      const showOrbit = orbitLod > LOD_HIDE_OPACITY;
      const showLabel = tagLod > LOD_HIDE_OPACITY;
      line.visible = showOrbit;
      label.root.visible = showLabel;
      material.opacity = LINE_BASE_OPACITY * orbitLod;
      label.material.opacity = LABEL_BASE_OPACITY * tagLod;
      syncRootVisibility();
      if (!root.visible) return;

      root.updateWorldMatrix(true, false);
      label.root.getWorldPosition(_labelWorld);
      const distanceM = Math.max(_labelWorld.distanceTo(camera.position), 1);
      const worldPerPx =
        (2 * distanceM * Math.tan((perspective.fov * Math.PI) / 360)) /
        viewportHeightPx;
      label.mesh.scale.set(
        label.widthPx * worldPerPx,
        label.heightPx * worldPerPx,
        1,
      );

      root.getWorldQuaternion(_parentWorldQuat);
      _billboardLocal
        .copy(_parentWorldQuat)
        .invert()
        .multiply(camera.quaternion);
      label.root.quaternion.copy(_billboardLocal);
    },

    setVisible(visible) {
      userVisible = visible;
      syncRootVisibility();
    },

    dispose() {
      root.removeFromParent();
      geometry.dispose();
      material.dispose();
      label.geometry.dispose();
      label.material.dispose();
      label.texture.dispose();
    },
  };
}
