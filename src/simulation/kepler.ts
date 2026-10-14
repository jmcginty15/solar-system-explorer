/**
 * Universal-variable two-body propagation (Curtis / Battin).
 * Advances relative state (r, v) about a fixed central mass for time dt.
 */

const MAX_NEWTON_ITERS = 50;
const NEWTON_TOL = 1e-10;

function stumpffC(z: number): number {
  if (z > 0) {
    const s = Math.sqrt(z);
    return (1 - Math.cos(s)) / z;
  }
  if (z < 0) {
    const s = Math.sqrt(-z);
    return (1 - Math.cosh(s)) / z;
  }
  return 0.5;
}

function stumpffS(z: number): number {
  if (z > 0) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < 0) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6;
}

export type Vec3 = { x: number; y: number; z: number };

/**
 * Propagate a relative Keplerian state for `dt` seconds about a center with
 * gravitational parameter `mu` (m³/s²).
 */
export function keplerPropagate(
  r0: Vec3,
  v0: Vec3,
  mu: number,
  dt: number,
): { position: Vec3; velocity: Vec3 } {
  if (!(mu > 0) || !Number.isFinite(dt) || dt === 0) {
    return {
      position: { x: r0.x, y: r0.y, z: r0.z },
      velocity: { x: v0.x, y: v0.y, z: v0.z },
    };
  }

  const rMag = Math.hypot(r0.x, r0.y, r0.z);
  if (!(rMag > 0)) {
    return {
      position: { x: r0.x, y: r0.y, z: r0.z },
      velocity: { x: v0.x, y: v0.y, z: v0.z },
    };
  }

  const v2 = v0.x * v0.x + v0.y * v0.y + v0.z * v0.z;
  const vr0 = (r0.x * v0.x + r0.y * v0.y + r0.z * v0.z) / rMag;
  const alpha = 2 / rMag - v2 / mu; // 1/a

  let chi: number;
  if (Math.abs(alpha) > 1e-12) {
    // Elliptic / hyperbolic first guess
    chi = Math.sqrt(mu) * Math.abs(alpha) * dt;
    if (alpha < 0) {
      const a = 1 / alpha;
      const arg =
        (-2 * mu * alpha * dt) /
        (vr0 * rMag + Math.sign(dt) * Math.sqrt(-mu * a) * (1 - rMag * alpha));
      if (arg > 0) {
        chi = (Math.sign(dt) * Math.sqrt(-a) * Math.log(arg)) / Math.sqrt(mu);
      }
    }
  } else {
    // Near-parabolic
    chi = (Math.sqrt(mu) * dt) / rMag;
  }
  if (!Number.isFinite(chi)) {
    chi = (Math.sqrt(mu) * dt) / rMag;
  }

  for (let iter = 0; iter < MAX_NEWTON_ITERS; iter++) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const rMagChi =
      chi * chi * C +
      ((rMag * vr0) / Math.sqrt(mu)) * chi * (1 - z * S) +
      rMag * (1 - z * C);
    const F =
      ((rMag * vr0) / Math.sqrt(mu)) * chi * chi * C +
      (1 - alpha * rMag) * chi * chi * chi * S +
      rMag * chi -
      Math.sqrt(mu) * dt;
    if (!(Math.abs(rMagChi) > 0)) break;
    const delta = F / rMagChi;
    chi -= delta;
    if (Math.abs(delta) < NEWTON_TOL * (1 + Math.abs(chi))) break;
  }

  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);
  const f = 1 - ((chi * chi) / rMag) * C;
  const g = dt - ((chi * chi * chi) / Math.sqrt(mu)) * S;

  const rx = f * r0.x + g * v0.x;
  const ry = f * r0.y + g * v0.y;
  const rz = f * r0.z + g * v0.z;
  const rNew = Math.hypot(rx, ry, rz);
  if (!(rNew > 0)) {
    return {
      position: { x: rx, y: ry, z: rz },
      velocity: { x: v0.x, y: v0.y, z: v0.z },
    };
  }

  const gdot = 1 - ((chi * chi) / rNew) * C;
  const fdot = (Math.sqrt(mu) / (rNew * rMag)) * chi * (z * S - 1);

  return {
    position: { x: rx, y: ry, z: rz },
    velocity: {
      x: fdot * r0.x + gdot * v0.x,
      y: fdot * r0.y + gdot * v0.y,
      z: fdot * r0.z + gdot * v0.z,
    },
  };
}
