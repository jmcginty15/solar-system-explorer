import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LinearFilter,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type Scene,
} from "three";
import { BODIES, type BodyId } from "../data";
import {
  systemDisplayName,
  systemFocusIdForPrimary,
  systemPrimaryId,
  type FocusId,
  type NbodyBody,
  type SystemFocusId,
} from "../simulation";
import { resolveBodyTagColor, resolveSystemTagColor } from "./bodyTagColor";
import { METERS_PER_AU } from "./constants";
import { computeSystemLodStates, systemTagLodWeights } from "./systemLod";
import { apparentSizePx, SUBPIXEL_CULL_PX } from "./visibility";

const scratch = new Vector3();
const parentWorldQuat = new Quaternion();
const billboardLocal = new Quaternion();

/** Floor opacity so distant tags stay faintly readable. */
const MIN_LABEL_OPACITY = 0.12;
/** Circle radius = this × characteristic world radius (body figure or system SMA). */
const TAG_RADIUS_SCALE = 1.5;
/** 2 o'clock on the circle (30° above +X in screen space, Y up). */
const TEXT_ANGLE_RAD = Math.PI / 6;
/** Gap between circle rim and text (CSS px). */
const TEXT_GAP_PX = 4;
/** Hide a tag entirely once LOD×distance opacity falls below this. */
const LOD_HIDE_OPACITY = 0.02;
const RING_SEGMENTS = 64;
const TEXT_FONT_PX = 12;
const TEXT_PAD_PX = 4;
/** Extra gap between the name and distance lines (CSS px). */
const TEXT_LINE_GAP_PX = 2;
/** Switch to AU once distance reaches this fraction of an AU. */
const DISTANCE_AU_THRESHOLD = 0.05;
/**
 * Wide distance sample so the canvas is allocated once at its max width.
 * Three.js cannot change a texture's dimensions after the first upload, so
 * resizing for longer distance strings would leave the initial placeholder.
 */
const DISTANCE_WIDTH_SAMPLE = "99,999,999.999 AU";

const NAME_FONT = `600 ${TEXT_FONT_PX}px ui-sans-serif, system-ui, sans-serif`;
const DISTANCE_FONT = `400 ${TEXT_FONT_PX}px ui-sans-serif, system-ui, sans-serif`;

type LabelEntry = {
  id: FocusId;
  kind: "body" | "system";
  bodyId?: BodyId;
  systemId?: SystemFocusId;
  name: string;
  cssColor: string;
  root: Group;
  ring: Line;
  text: Mesh;
  textCanvas: HTMLCanvasElement;
  textTexture: CanvasTexture;
  textWidthPx: number;
  textHeightPx: number;
  /** Last painted distance string — skip redraw when unchanged. */
  distanceText: string;
  anchor: Group | null;
  visible: boolean;
};

export type BodyLabels = {
  update: (
    camera: Camera,
    viewportHeightPx: number,
    bodies: readonly NbodyBody[],
  ) => void;
  syncVisibility: (visibleIds: ReadonlySet<FocusId>) => void;
  setVisible: (id: FocusId, visible: boolean) => void;
  setAllVisible: (visible: boolean) => void;
  hasVisible: () => boolean;
  dispose: () => void;
};

function maxBodyRadiusM(bodyId: BodyId): number {
  const body = BODIES[bodyId];
  return Math.max(body.radiusXM, body.radiusYM, body.radiusZM, 1);
}

function createRingGeometry(): BufferGeometry {
  const positions = new Float32Array((RING_SEGMENTS + 1) * 3);
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    positions[i * 3] = Math.cos(a);
    positions[i * 3 + 1] = Math.sin(a);
    positions[i * 3 + 2] = 0;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  return geometry;
}

/** Compact camera-distance label (km / m near, AU farther out). */
function formatCameraDistance(meters: number): string {
  const au = meters / METERS_PER_AU;
  if (au >= DISTANCE_AU_THRESHOLD) {
    if (au >= 1000) {
      return `${au.toLocaleString("en-US", { maximumFractionDigits: 0 })} AU`;
    }
    return `${au.toFixed(3)} AU`;
  }
  const km = meters / 1000;
  if (km >= 1000) {
    return `${km.toLocaleString("en-US", { maximumFractionDigits: 0 })} km`;
  }
  if (km >= 100) return `${km.toFixed(1)} km`;
  if (km >= 10) return `${km.toFixed(2)} km`;
  if (km >= 1) return `${km.toFixed(3)} km`;
  if (meters >= 1) return `${meters.toFixed(0)} m`;
  return `${meters.toFixed(2)} m`;
}

function paintLabelText(
  ctx: CanvasRenderingContext2D,
  name: string,
  distanceText: string,
  cssColor: string,
  widthPx: number,
  heightPx: number,
): void {
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#000";
  ctx.fillStyle = cssColor;

  const x = TEXT_PAD_PX;
  const nameY = TEXT_PAD_PX + TEXT_FONT_PX * 0.5;
  const distanceY =
    TEXT_PAD_PX + TEXT_FONT_PX + TEXT_LINE_GAP_PX + TEXT_FONT_PX * 0.5;

  ctx.font = NAME_FONT;
  ctx.strokeText(name, x, nameY);
  ctx.fillText(name, x, nameY);

  if (distanceText) {
    ctx.font = DISTANCE_FONT;
    ctx.strokeText(distanceText, x, distanceY);
    ctx.fillText(distanceText, x, distanceY);
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (measureCtx) return measureCtx;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable for body labels");
  measureCtx = ctx;
  return ctx;
}

/** Stable canvas size for a label — sized for the name and a wide distance. */
function measureLabelCanvas(name: string): {
  widthPx: number;
  heightPx: number;
} {
  const ctx = getMeasureCtx();
  ctx.font = NAME_FONT;
  const nameWidth = ctx.measureText(name).width;
  ctx.font = DISTANCE_FONT;
  const distanceWidth = ctx.measureText(DISTANCE_WIDTH_SAMPLE).width;
  const widthPx = Math.ceil(
    Math.max(nameWidth, distanceWidth) + TEXT_PAD_PX * 2,
  );
  const heightPx = TEXT_PAD_PX * 2 + TEXT_FONT_PX * 2 + TEXT_LINE_GAP_PX;
  return { widthPx: Math.max(1, widthPx), heightPx: Math.max(1, heightPx) };
}

function createTextCanvas(
  name: string,
  distanceText: string,
  cssColor: string,
): {
  canvas: HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
} {
  const { widthPx, heightPx } = measureLabelCanvas(name);
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable for body labels");
  paintLabelText(ctx, name, distanceText, cssColor, widthPx, heightPx);
  return { canvas, widthPx, heightPx };
}

function syncLabelDistanceText(entry: LabelEntry, distanceText: string): void {
  if (entry.distanceText === distanceText) return;
  entry.distanceText = distanceText;

  const ctx = entry.textCanvas.getContext("2d");
  if (!ctx) return;
  paintLabelText(
    ctx,
    entry.name,
    distanceText,
    entry.cssColor,
    entry.textWidthPx,
    entry.textHeightPx,
  );
  entry.textTexture.needsUpdate = true;
}

function createLabelGraphics(
  name: string,
  cssColor: string,
  hex: number,
  dashed: boolean,
): Pick<
  LabelEntry,
  | "root"
  | "ring"
  | "text"
  | "textCanvas"
  | "textTexture"
  | "textWidthPx"
  | "textHeightPx"
  | "distanceText"
> {
  const root = new Group();
  root.name = "body-label";

  const ringMaterial = dashed
    ? new LineDashedMaterial({
        color: hex,
        dashSize: 0.12,
        gapSize: 0.08,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      })
    : new LineBasicMaterial({
        color: hex,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
  const ring = new Line(createRingGeometry(), ringMaterial);
  ring.frustumCulled = false;
  ring.renderOrder = 8;
  if (dashed) ring.computeLineDistances();
  root.add(ring);

  const distanceText = "";
  const { canvas, widthPx, heightPx } = createTextCanvas(
    name,
    distanceText,
    cssColor,
  );
  const textTexture = new CanvasTexture(canvas);
  // Non-power-of-two canvases need linear filtering (three.js default is mipmaps).
  textTexture.minFilter = LinearFilter;
  textTexture.needsUpdate = true;
  const text = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: textTexture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    }),
  );
  text.frustumCulled = false;
  text.renderOrder = 9;
  root.add(text);

  return {
    root,
    ring,
    text,
    textCanvas: canvas,
    textTexture,
    textWidthPx: widthPx,
    textHeightPx: heightPx,
    distanceText,
  };
}

function applyEntryVisibility(entry: LabelEntry): void {
  entry.root.visible = entry.visible;
  if (entry.anchor) entry.anchor.visible = entry.visible;
}

function setBillboardFacingCamera(entry: LabelEntry, camera: Camera): void {
  const parent = entry.root.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(parentWorldQuat);
    billboardLocal.copy(parentWorldQuat).invert().multiply(camera.quaternion);
    entry.root.quaternion.copy(billboardLocal);
  } else {
    entry.root.quaternion.copy(camera.quaternion);
  }
}

/**
 * Depth-tested WebGL billboard tags (ring + text). Intervening bodies occlude
 * them in the normal scene pass — no CSS2D, no second canvas.
 */
export function attachBodyLabels(
  scene: Scene,
  bodyGroups: Map<BodyId, Group>,
): BodyLabels {
  const entries: LabelEntry[] = [];
  const byId = new Map<FocusId, LabelEntry>();

  for (const [bodyId, group] of bodyGroups) {
    const name = BODIES[bodyId].name;
    const color = resolveBodyTagColor(bodyId, group);
    const graphics = createLabelGraphics(name, color.css, color.hex, false);
    graphics.root.name = `${bodyId}-label`;
    group.add(graphics.root);
    const entry: LabelEntry = {
      id: bodyId,
      kind: "body",
      bodyId,
      name,
      cssColor: color.css,
      ...graphics,
      anchor: null,
      visible: true,
    };
    applyEntryVisibility(entry);
    entries.push(entry);
    byId.set(bodyId, entry);
  }

  for (const bodyId of bodyGroups.keys()) {
    if (bodyId === "sun") continue;
    const systemId = systemFocusIdForPrimary(bodyId);
    const name = systemDisplayName(systemId);
    const color = resolveSystemTagColor(systemId, bodyGroups, [bodyId]);
    const graphics = createLabelGraphics(name, color.css, color.hex, true);
    const anchor = new Group();
    anchor.name = `${systemId}-label-anchor`;
    graphics.root.name = `${systemId}-label`;
    anchor.add(graphics.root);
    scene.add(anchor);
    const entry: LabelEntry = {
      id: systemId,
      kind: "system",
      systemId,
      name,
      cssColor: color.css,
      ...graphics,
      anchor,
      visible: true,
    };
    applyEntryVisibility(entry);
    entries.push(entry);
    byId.set(systemId, entry);
  }

  return {
    update(camera, viewportHeightPx, bodies) {
      if (!(camera as PerspectiveCamera).isPerspectiveCamera) return;
      const perspective = camera as PerspectiveCamera;

      const visibleEntries = entries.filter((entry) => entry.visible);
      if (visibleEntries.length === 0) {
        for (const entry of entries) entry.root.visible = false;
        return;
      }

      const { bySystemId, bodySystemId } = computeSystemLodStates(
        perspective,
        viewportHeightPx,
        bodies,
      );

      const bodyById = new Map<BodyId, NbodyBody>();
      for (const body of bodies) bodyById.set(body.id, body);

      const logDistances: number[] = [];
      const lodWeights: number[] = [];
      let logMin = Infinity;
      let logMax = -Infinity;

      for (const entry of visibleEntries) {
        let worldRadiusM = 0;
        let lodWeight = 1;

        if (entry.kind === "body" && entry.bodyId) {
          worldRadiusM = TAG_RADIUS_SCALE * maxBodyRadiusM(entry.bodyId);
          // Use simulation / group translation — not label world matrix (orientation
          // can corrupt matrixWorld without changing the body center).
          const body = bodyById.get(entry.bodyId);
          if (body) {
            const { x, y, z } = body.state.positionM;
            scratch.set(x, y, z);
          } else if (entry.root.parent) {
            scratch.copy(entry.root.parent.position);
          } else {
            entry.root.getWorldPosition(scratch);
          }
          const systemId = bodySystemId.get(entry.bodyId);
          if (systemId) {
            const lod = bySystemId.get(systemId);
            lodWeight = lod
              ? systemTagLodWeights(lod.diameterPx).memberWeight
              : 0;
          }
        } else if (entry.kind === "system" && entry.systemId && entry.anchor) {
          const lod = bySystemId.get(entry.systemId);
          if (lod) {
            entry.anchor.position.set(lod.centerX, lod.centerY, lod.centerZ);
            scratch.set(lod.centerX, lod.centerY, lod.centerZ);
            worldRadiusM = lod.worldRadiusM;
            lodWeight = systemTagLodWeights(lod.diameterPx).systemWeight;
          } else {
            // Moonless / inactive system tag: fall back to the primary's center.
            const primaryId = systemPrimaryId(entry.systemId);
            const primary = primaryId ? bodyById.get(primaryId) : undefined;
            if (primary) {
              const { x, y, z } = primary.state.positionM;
              scratch.set(x, y, z);
              entry.anchor.position.set(x, y, z);
            }
            lodWeight = 0;
          }
        }

        const rawDistanceM = scratch.distanceTo(camera.position);
        const distanceM = Number.isFinite(rawDistanceM)
          ? Math.max(rawDistanceM, 1)
          : 1;
        syncLabelDistanceText(entry, formatCameraDistance(distanceM));
        const diameterPx =
          worldRadiusM > 0
            ? apparentSizePx(
                worldRadiusM,
                distanceM,
                perspective,
                viewportHeightPx,
              )
            : 0;

        // Layout billboards for every picker-visible tag; opacity (below) may
        // still hide ones that have faded out via distance × LOD.
        setBillboardFacingCamera(entry, camera);

        const circleVisible = diameterPx >= SUBPIXEL_CULL_PX;
        entry.ring.visible = circleVisible;
        if (circleVisible) {
          entry.ring.scale.setScalar(Math.max(worldRadiusM, 1));
        }

        const mPerPx =
          (2 * Math.tan((perspective.fov * Math.PI) / 360) * distanceM) /
          viewportHeightPx;
        const textH = entry.textHeightPx * mPerPx;
        const textW = entry.textWidthPx * mPerPx;
        entry.text.scale.set(textW, textH, 1);

        const rimM = circleVisible
          ? worldRadiusM + TEXT_GAP_PX * mPerPx
          : TEXT_GAP_PX * mPerPx;
        // Keep the name line on the rim ray; distance sits just below it.
        const nameOffsetM =
          (TEXT_FONT_PX * 0.5 + TEXT_LINE_GAP_PX * 0.5) * mPerPx;
        entry.text.position.set(
          rimM * Math.cos(TEXT_ANGLE_RAD) + textW * 0.5,
          rimM * Math.sin(TEXT_ANGLE_RAD) - nameOffsetM,
          0,
        );

        const logD = Math.log(distanceM);
        logDistances.push(logD);
        lodWeights.push(lodWeight);
        if (logD < logMin) logMin = logD;
        if (logD > logMax) logMax = logD;
      }

      // Same relative log-distance fade as the old CSS tags: nearest → 1,
      // furthest → MIN_LABEL_OPACITY, then multiply by system LOD weight.
      const span = Math.max(logMax - logMin, 1e-6);
      for (let i = 0; i < visibleEntries.length; i++) {
        const entry = visibleEntries[i]!;
        const t = (logDistances[i]! - logMin) / span;
        const distanceOpacity = MathUtils.clamp(
          1 - t * (1 - MIN_LABEL_OPACITY),
          MIN_LABEL_OPACITY,
          1,
        );
        const opacity = distanceOpacity * lodWeights[i]!;
        (entry.ring.material as LineBasicMaterial).opacity = opacity;
        (entry.text.material as MeshBasicMaterial).opacity = opacity;
        entry.root.visible = opacity > LOD_HIDE_OPACITY;
      }
    },

    syncVisibility(visibleIds) {
      for (const entry of entries) {
        entry.visible = visibleIds.has(entry.id);
        applyEntryVisibility(entry);
      }
    },

    setVisible(id, visible) {
      const entry = byId.get(id);
      if (!entry) return;
      entry.visible = visible;
      applyEntryVisibility(entry);
    },

    setAllVisible(visible) {
      for (const entry of entries) {
        entry.visible = visible;
        applyEntryVisibility(entry);
      }
    },

    hasVisible() {
      return entries.some((entry) => entry.visible);
    },

    dispose() {
      for (const entry of entries) {
        entry.root.removeFromParent();
        entry.ring.geometry.dispose();
        (entry.ring.material as LineBasicMaterial).dispose();
        entry.text.geometry.dispose();
        entry.textTexture.dispose();
        (entry.text.material as MeshBasicMaterial).dispose();
        if (entry.anchor) entry.anchor.removeFromParent();
      }
      entries.length = 0;
      byId.clear();
    },
  };
}
