import { Group, MathUtils, Mesh, type Texture } from "three";
import {
  BODIES,
  type BodyData,
  type BodyId,
  type ContactBinaryLobe,
} from "../data";
import {
  catalogOrbitalParentId,
  systemPrimaryId,
  type SystemFocusId,
} from "../simulation";

/** Fallback when a body has neither a texture nor an explicit color. */
const DEFAULT_BODY_TAG_COLOR_HEX = 0xc8c8c8;
/** Downsample size for texture average (keeps sampling cheap). */
const TEXTURE_AVERAGE_SAMPLE_SIZE = 32;
/** Knud Thomsen exponent for approximate ellipsoid surface area. */
const ELLIPSOID_AREA_P = 1.6075;

export type BodyTagColor = {
  css: string;
  hex: number;
};

function hexToCss(hex: number): string {
  const clamped = MathUtils.clamp(Math.round(hex), 0, 0xffffff);
  return `#${clamped.toString(16).padStart(6, "0")}`;
}

function rgbToHex(r: number, g: number, b: number): number {
  return (
    (MathUtils.clamp(Math.round(r), 0, 255) << 16) |
    (MathUtils.clamp(Math.round(g), 0, 255) << 8) |
    MathUtils.clamp(Math.round(b), 0, 255)
  );
}

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  const h = MathUtils.clamp(Math.round(hex), 0, 0xffffff);
  return {
    r: (h >> 16) & 0xff,
    g: (h >> 8) & 0xff,
    b: h & 0xff,
  };
}

function averageImageColor(
  image: HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas,
): BodyTagColor | null {
  const srcWidth =
    "naturalWidth" in image ? image.naturalWidth || image.width : image.width;
  const srcHeight =
    "naturalHeight" in image
      ? image.naturalHeight || image.height
      : image.height;
  if (!(srcWidth > 0) || !(srcHeight > 0)) return null;

  const sample = TEXTURE_AVERAGE_SAMPLE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = sample;
  canvas.height = sample;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(image as CanvasImageSource, 0, 0, sample, sample);
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, sample, sample);
  } catch {
    return null;
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]!;
    if (a < 16) continue;
    r += pixels[i]!;
    g += pixels[i + 1]!;
    b += pixels[i + 2]!;
    n += 1;
  }
  if (n === 0) return null;
  const hex = rgbToHex(r / n, g / n, b / n);
  return { css: hexToCss(hex), hex };
}

function materialColorMap(material: unknown): Texture | null {
  if (!material || typeof material !== "object") return null;
  const map = (material as { map?: Texture | null }).map;
  return map?.image ? map : null;
}

/** Prefer the main surface mesh map; skip atmosphere / glow / ring children. */
function findBodyColorMap(bodyId: BodyId, group: Group): Texture | null {
  const surface = group.getObjectByName(bodyId);
  if (surface instanceof Mesh) {
    const materials = Array.isArray(surface.material)
      ? surface.material
      : [surface.material];
    for (const material of materials) {
      const map = materialColorMap(material);
      if (map) return map;
    }
  }

  if (surface instanceof Group) {
    let found: Texture | null = null;
    surface.traverse((object) => {
      if (found || !(object instanceof Mesh)) return;
      const map = materialColorMap(object.material);
      if (map) found = map;
    });
    if (found) return found;
  }

  return null;
}

/** Approximate ellipsoid surface area (Knud Thomsen). */
function ellipsoidSurfaceAreaM2(a: number, b: number, c: number): number {
  const aa = Math.max(a, 1);
  const bb = Math.max(b, 1);
  const cc = Math.max(c, 1);
  const p = ELLIPSOID_AREA_P;
  const ap = aa ** p;
  const bp = bb ** p;
  const cp = cc ** p;
  return 4 * Math.PI * ((ap * bp + ap * cp + bp * cp) / 3) ** (1 / p);
}

function lobeSurfaceAreaM2(lobe: ContactBinaryLobe): number {
  return ellipsoidSurfaceAreaM2(lobe.radiusXM, lobe.radiusYM, lobe.radiusZM);
}

/** Surface area used to weight system-tag colors (m²). */
export function bodySurfaceAreaM2(body: BodyData): number {
  if (body.contactBinary) {
    return (
      lobeSurfaceAreaM2(body.contactBinary.lobeA) +
      lobeSurfaceAreaM2(body.contactBinary.lobeB)
    );
  }
  return ellipsoidSurfaceAreaM2(body.radiusXM, body.radiusYM, body.radiusZM);
}

/** Catalog primary + moons for a planetary system. */
export function catalogSystemBodyIds(systemId: SystemFocusId): BodyId[] {
  const primaryId = systemPrimaryId(systemId);
  if (!primaryId) return [];
  const ids: BodyId[] = [primaryId];
  for (const id of Object.keys(BODIES) as BodyId[]) {
    if (catalogOrbitalParentId(id) === primaryId) ids.push(id);
  }
  return ids;
}

/**
 * Object tag / orbit color: average of the surface color map when textured,
 * otherwise the body's solid `color`.
 */
export function resolveBodyTagColor(
  bodyId: BodyId,
  group: Group,
): BodyTagColor {
  const body = BODIES[bodyId];
  if (body.textureMapUrl) {
    const map = findBodyColorMap(bodyId, group);
    const image = map?.image as
      | HTMLImageElement
      | ImageBitmap
      | HTMLCanvasElement
      | OffscreenCanvas
      | undefined;
    if (image) {
      const average = averageImageColor(image);
      if (average) return average;
    }
  }
  if (body.color !== undefined) {
    const hex = MathUtils.clamp(Math.round(body.color), 0, 0xffffff);
    return { css: hexToCss(hex), hex };
  }
  return {
    css: hexToCss(DEFAULT_BODY_TAG_COLOR_HEX),
    hex: DEFAULT_BODY_TAG_COLOR_HEX,
  };
}

/**
 * System tag color: surface-area-weighted average of member body colors.
 * Pass live `memberIds` (primary + bound satellites) when known; otherwise
 * falls back to catalog system membership.
 */
export function resolveSystemTagColor(
  systemId: SystemFocusId,
  bodyGroups: Map<BodyId, Group>,
  memberIds?: readonly BodyId[],
): BodyTagColor {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  const ids = memberIds ?? catalogSystemBodyIds(systemId);
  for (const bodyId of ids) {
    const body = BODIES[bodyId];
    if (!body) continue;
    const area = bodySurfaceAreaM2(body);
    if (!(area > 0)) continue;
    const group = bodyGroups.get(bodyId);
    const color = group
      ? resolveBodyTagColor(bodyId, group)
      : body.color !== undefined
        ? {
            hex: MathUtils.clamp(Math.round(body.color), 0, 0xffffff),
            css: "",
          }
        : { hex: DEFAULT_BODY_TAG_COLOR_HEX, css: "" };
    const rgb = hexToRgb(color.hex);
    r += rgb.r * area;
    g += rgb.g * area;
    b += rgb.b * area;
    weight += area;
  }
  if (!(weight > 0)) {
    return {
      css: hexToCss(DEFAULT_BODY_TAG_COLOR_HEX),
      hex: DEFAULT_BODY_TAG_COLOR_HEX,
    };
  }
  const hex = rgbToHex(r / weight, g / weight, b / weight);
  return { css: hexToCss(hex), hex };
}
