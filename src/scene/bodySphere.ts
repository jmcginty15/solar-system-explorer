import { SphereGeometry } from "three";

/**
 * Unit sphere for solar-system bodies in invariable-plane coordinates
 * (XY equator, +Z north).
 *
 * Three.js SphereGeometry is Y-up and cannot be configured otherwise; rotating the
 * vertex data once puts UV poles on ±Z so equirectangular maps wrap along the equator.
 */
export function createBodySphereGeometry(
  widthSegments = 64,
  heightSegments = 32,
): SphereGeometry {
  const geometry = new SphereGeometry(1, widthSegments, heightSegments);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
