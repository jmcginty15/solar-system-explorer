import {
  MathUtils,
  Mesh,
  Sprite,
  type Camera,
  type Group,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import { type BodyData, type BodyId } from "../data";

/** Hide body meshes when smaller than this many pixels on screen. */
export const SUBPIXEL_CULL_PX = 1;
/** Turn off displacement/bump below this apparent size (pixels). */
export const DISPLACEMENT_DISABLE_PX = 12;

type DisplacementMaterial = MeshPhysicalMaterial | MeshStandardMaterial;

type DisplacementState = {
  material: DisplacementMaterial;
  displacementScale: number;
  bumpScale: number;
};

export type BodyVisibilityEntry = {
  id: BodyId;
  group: Group;
  maxRadiusM: number;
  /** When true (Sun), never hide renderables. */
  alwaysVisible: boolean;
  cullables: Object3D[];
  displacement: DisplacementState[];
};

function isDisplacementMaterial(
  material: unknown,
): material is DisplacementMaterial {
  return (
    !!material &&
    typeof material === "object" &&
    "displacementScale" in material &&
    "bumpScale" in material
  );
}

function isLabelObject(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (current.name === "body-label" || current.name.endsWith("-label")) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Collect mesh/sprite children that may be culled (exclude labels). */
export function collectCullables(root: Object3D): Object3D[] {
  const cullables: Object3D[] = [];
  root.traverse((object) => {
    if (object === root) return;
    if (isLabelObject(object)) return;
    if (object instanceof Mesh || object instanceof Sprite) {
      cullables.push(object);
    }
  });
  return cullables;
}

/** Snapshot displacement/bump scales for later distance gating. */
export function collectDisplacementStates(root: Object3D): DisplacementState[] {
  const states: DisplacementState[] = [];
  const seen = new Set<DisplacementMaterial>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!isDisplacementMaterial(material) || seen.has(material)) continue;
      if (!material.displacementMap && !material.bumpMap) continue;
      seen.add(material);
      states.push({
        material,
        displacementScale: material.displacementScale,
        bumpScale: material.bumpScale,
      });
    }
  });
  return states;
}

/**
 * Characteristic radius used for sub-pixel culling. Comets use the full
 * coma + tail extent so the nucleus alone does not cull them away early.
 */
export function cullingRadiusM(body: BodyData): number {
  const figureM = Math.max(body.radiusXM, body.radiusYM, body.radiusZM);
  const effects = body.cometEffects;
  if (!effects) return figureM;
  return Math.max(
    figureM,
    effects.comaOuterRadiusM,
    effects.ionTailLengthM,
    effects.dustTailLengthM,
    effects.ionTailBaseRadiusM,
    effects.dustTailBaseRadiusM,
  );
}

/**
 * Approximate on-screen diameter in CSS pixels for a sphere of `radiusM`
 * at `distanceM` from a perspective camera.
 */
export function apparentSizePx(
  radiusM: number,
  distanceM: number,
  camera: PerspectiveCamera,
  viewportHeightPx: number,
): number {
  if (!(radiusM > 0) || !(distanceM > 0) || !(viewportHeightPx > 0)) return 0;
  const fovYRad = MathUtils.degToRad(camera.fov);
  const worldHeight = 2 * distanceM * Math.tan(fovYRad / 2);
  if (!(worldHeight > 0)) return 0;
  return ((2 * radiusM) / worldHeight) * viewportHeightPx;
}

/** Apply sub-pixel mesh culling and displacement gating for all bodies. */
export function updateBodyVisibility(
  entries: readonly BodyVisibilityEntry[],
  camera: Camera,
  viewportHeightPx: number,
): void {
  if (!(camera as PerspectiveCamera).isPerspectiveCamera) return;
  const perspective = camera as PerspectiveCamera;
  const camPos = perspective.position;

  for (const entry of entries) {
    const distanceM = Math.max(entry.group.position.distanceTo(camPos), 1);
    const px = apparentSizePx(
      entry.maxRadiusM,
      distanceM,
      perspective,
      viewportHeightPx,
    );

    const showMesh = entry.alwaysVisible || px >= SUBPIXEL_CULL_PX;
    for (const object of entry.cullables) {
      object.visible = showMesh;
    }

    const useDisplacement =
      entry.alwaysVisible || px >= DISPLACEMENT_DISABLE_PX;
    for (const state of entry.displacement) {
      state.material.displacementScale = useDisplacement
        ? state.displacementScale
        : 0;
      state.material.bumpScale = useDisplacement ? state.bumpScale : 0;
    }
  }
}
