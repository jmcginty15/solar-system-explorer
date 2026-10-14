import { LatheGeometry, Vector2 } from "three";

/** Rim fillet radius as a fraction of washer thickness. */
const WASHER_FILLET_FRACTION = 0.4;

export function washerFilletRadius(
  innerRadius: number,
  outerRadius: number,
  thickness: number,
): number {
  return Math.min(
    thickness * WASHER_FILLET_FRACTION,
    (outerRadius - innerRadius) * 0.25,
  );
}

/**
 * When a ring is specified at a single radius, expand by ±thickness/2 so the
 * washer has a non-zero radial span matching its thickness.
 */
export function resolveWasherRadii(
  innerRadius: number,
  outerRadius: number,
  thickness: number,
): { inner: number; outer: number } {
  if (outerRadius > innerRadius) {
    return { inner: innerRadius, outer: outerRadius };
  }
  const half = thickness / 2;
  return { inner: innerRadius - half, outer: outerRadius + half };
}

/**
 * Washer in the equatorial XY plane with thickness along Z and rounded
 * inner + outer rims. Built as a lathe around Z.
 */
export function createRoundedWasherGeometry(
  innerRadius: number,
  outerRadius: number,
  thickness: number,
  segments = 256,
): LatheGeometry {
  const { inner, outer } = resolveWasherRadii(
    innerRadius,
    outerRadius,
    thickness,
  );
  const half = thickness / 2;
  const fillet = washerFilletRadius(inner, outer, thickness);
  const steps = 12;
  const points: Vector2[] = [];

  // Lathe profile in (radius, height) before rotateX → equatorial washer.
  // Inner bottom fillet: (inner+fillet, -half) → (inner, -half+fillet)
  for (let i = 0; i <= steps; i++) {
    const phi = (i / steps) * (Math.PI / 2);
    points.push(
      new Vector2(
        inner + fillet - fillet * Math.sin(phi),
        -half + fillet - fillet * Math.cos(phi),
      ),
    );
  }

  // Inner wall up to the top fillet.
  points.push(new Vector2(inner, half - fillet));

  // Inner top fillet: (inner, half-fillet) → (inner+fillet, half)
  for (let i = 1; i <= steps; i++) {
    const phi = (i / steps) * (Math.PI / 2);
    points.push(
      new Vector2(
        inner + fillet - fillet * Math.cos(phi),
        half - fillet + fillet * Math.sin(phi),
      ),
    );
  }

  // Top face to outer fillet.
  points.push(new Vector2(outer - fillet, half));

  // Outer top fillet: (outer-fillet, half) → (outer, half-fillet)
  for (let i = 1; i <= steps; i++) {
    const theta = (i / steps) * (Math.PI / 2);
    points.push(
      new Vector2(
        outer - fillet + fillet * Math.sin(theta),
        half - fillet + fillet * Math.cos(theta),
      ),
    );
  }

  // Outer bottom fillet: (outer, half-fillet) → (outer-fillet, -half)
  for (let i = 1; i <= steps; i++) {
    const theta = (i / steps) * (Math.PI / 2);
    points.push(
      new Vector2(
        outer - fillet + fillet * Math.cos(theta),
        -half + fillet - fillet * Math.sin(theta),
      ),
    );
  }

  // Bottom face back to start.
  points.push(new Vector2(inner + fillet, -half));

  const geometry = new LatheGeometry(points, segments);
  // Symmetry axis Y → world Z so the ring lies in the body's equatorial XY plane.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}
