import type { BodyData } from "../data";
import {
  METERS_PER_AU,
  SUN_LIGHT_COLOR,
  SUN_LIGHT_INTENSITY,
} from "./constants";

/** IAU nominal solar radius (m) — matches TRAPPIST-1 radius scaling. */
export const IAU_SOLAR_RADIUS_M = 695_700_000;

/** Baseline photosphere emissive strength for 1 L☉ / R☉ surface brightness. */
export const SUN_EMISSIVE_INTENSITY = 1.6;

/** Soft-glow sprite opacities for the Sun. */
export const SUN_INNER_GLOW_OPACITY = 0.5;
export const SUN_OUTER_GLOW_OPACITY = 0.28;

/** Selective bloom strength tuned for the Sun. */
export const SUN_BLOOM_STRENGTH = 1.35;

/** Default warm-white star tint (matches former DirectionalLight color). */
export const DEFAULT_STAR_COLOR = SUN_LIGHT_COLOR;

/** Bolometric luminosity in solar units (defaults to 1 for glowAndLight stars). */
export function starLuminosityLSun(body: BodyData): number {
  if (body.luminosityLSun != null && Number.isFinite(body.luminosityLSun)) {
    return Math.max(0, body.luminosityLSun);
  }
  return body.glowAndLight ? 1 : 0;
}

/**
 * Mean surface brightness relative to the Sun: (L/L☉) / (R/R☉)².
 * Drives photosphere emissive intensity and glow opacity when the star is
 * framed at a comparable angular size.
 */
export function starSurfaceBrightnessRelSun(body: BodyData): number {
  const L = starLuminosityLSun(body);
  const meanR = (body.radiusXM + body.radiusYM + body.radiusZM) / 3;
  const r = meanR / IAU_SOLAR_RADIUS_M;
  if (!(r > 0) || !Number.isFinite(r)) return L;
  return L / (r * r);
}

export function starColorHex(body: BodyData): number {
  return body.starColor ?? DEFAULT_STAR_COLOR;
}

/** Photosphere MeshStandardMaterial.emissiveIntensity. */
export function starEmissiveIntensity(body: BodyData): number {
  return SUN_EMISSIVE_INTENSITY * starSurfaceBrightnessRelSun(body);
}

/** Soft glow sprite opacities scaled by surface brightness. */
export function starGlowOpacities(body: BodyData): {
  inner: number;
  outer: number;
} {
  const s = starSurfaceBrightnessRelSun(body);
  // Keep a faint floor so ultra-cool dwarfs still read as glowing up close.
  const scale = Math.max(0.08, s);
  return {
    inner: SUN_INNER_GLOW_OPACITY * scale,
    outer: SUN_OUTER_GLOW_OPACITY * scale,
  };
}

/**
 * Characteristic orbital distance used to scale directional light (m).
 * Closest catalog Keplerian semimajor axis in the system, else 1 AU.
 */
export function starLightReferenceDistanceM(
  systemBodies: readonly BodyData[],
): number {
  let minA = Number.POSITIVE_INFINITY;
  for (const body of systemBodies) {
    const a = body.keplerianElements?.semiMajorAxisM;
    if (a != null && a > 0 && a < minA) minA = a;
  }
  return Number.isFinite(minA) ? minA : METERS_PER_AU;
}

/**
 * Ceiling on Earth-relative insolation used for the single DirectionalLight.
 *
 * Physical insolation at the innermost planet can be tens–hundreds× Earth's
 * (e.g. HD 10180 c). Applying that raw to Three.js lighting washes every
 * planet to white. Keep enough headroom for TRAPPIST-1b (~4×) while clamping
 * extreme close-in systems.
 */
export const MAX_STAR_LIGHT_INSOLATION_REL_EARTH = 5;

/**
 * DirectionalLight intensity for illuminating planets.
 *
 * Three.js directional lights do not fall off with distance, so Sol's intensity
 * is tuned for ~1 AU. For other stars, scale by bolometric luminosity and
 * `(1 AU / d_ref)²` so close-in planets around faint M dwarfs receive the
 * correct relative insolation (TRAPPIST-1b is several× Earth's flux, not ~0),
 * then soft-cap for display so materials keep their catalog colors.
 */
export function starLightIntensity(
  body: BodyData,
  referenceDistanceM: number = METERS_PER_AU,
): number {
  const L = starLuminosityLSun(body);
  const d =
    referenceDistanceM > 0 && Number.isFinite(referenceDistanceM)
      ? referenceDistanceM
      : METERS_PER_AU;
  const insolationRelEarth = L * (METERS_PER_AU / d) ** 2;
  const visualScale = Math.min(
    Math.max(insolationRelEarth, 1e-4),
    MAX_STAR_LIGHT_INSOLATION_REL_EARTH,
  );
  return SUN_LIGHT_INTENSITY * visualScale;
}

/**
 * Bloom strength scales with √(surface brightness) so dim red dwarfs still
 * bloom, but far less than the Sun.
 */
export function starBloomStrength(body: BodyData): number {
  const s = starSurfaceBrightnessRelSun(body);
  return SUN_BLOOM_STRENGTH * Math.sqrt(Math.max(s, 1e-4));
}
