import { BODIES, type BodyId } from "../data";
import type { BodyState } from "../ephemeris";
import { catalogOrbitalParentId, updateOrbitalParents } from "./hierarchy";
import { keplerPropagate } from "./kepler";
import { meanToTrueAnomaly, trueToMeanAnomaly } from "./keplerAnomalies";
import {
  classicalElementsToState,
  stateToClassicalElements,
} from "./orbitalElements";

/** CODATA 2018 gravitational constant (m³ kg⁻¹ s⁻²). */
export const G = 6.674_3e-11;

/** Softening length (m) to avoid singular 1/r² at tiny separations. */
export const SOFTENING_M = 1_000_000;

/**
 * Safety factor for adaptive substeps on the primary (non-satellite) system:
 * dt ≤ η · min_i √(ε / |a_i|).
 */
export const TIMESTEP_ETA = 0.1;

/**
 * Cap Verlet substeps per frame for the primary N-body system.
 * Bound satellites use Kepler + capped tidal kicks and do not consume this budget.
 */
export const MAX_SUBSTEPS_PER_FRAME = 256;

/** Max kick–drift–kick tidal substeps per bound satellite per frame. */
export const MAX_TIDAL_SUBSTEPS = 8;
/**
 * Apply third-body tides only when the frame step is a small fraction of the
 * satellite's orbital period. Larger steps make Δv = a_tide·dt unstable
 * (e.g. solar tides on the Moon over multi-year frame steps).
 *
 * Kept tight: even 0.05·P with planetary perturbers can unbind Io-class moons
 * over weeks of integration and then n-body-eject them as false primaries.
 */
export const TIDAL_MAX_DT_ORBIT_FRACTION = 0.01;
/**
 * Ignore low-mass heliocentric bodies as tidal perturbers. Asteroids/comets on
 * bad high-dt trajectories sitting near a planet deliver spurious kicks that
 * unbind inner moons. ~1e25 kg is below Mercury and above the largest asteroids.
 */
export const MIN_TIDAL_PERTURBER_MASS_KG = 1e25;
/** Cap |a_tide| as a fraction of the central μ/r² acceleration. */
export const TIDAL_ACCEL_CAP_FRACTION = 0.05;
/** Max Kepler segment as a fraction of orbital period (multi-rev stability). */
export const MAX_KEPLER_DT_ORBIT_FRACTION = 0.25;
/**
 * If a COM-relative state is barely hyperbolic (v < this × v_esc) treat it as
 * numerical noise and pull it back onto a slightly-bound ellipse. Clearly
 * escaping states (above this factor) are left alone so real ejections work.
 */
export const NUMERICAL_HYPERBOLIC_VESC_FACTOR = 1.05;

export type NbodyBody = {
  id: BodyId;
  mass: number;
  /** Dynamic orbital parent; `null` = heliocentric primary (or Sun). */
  parentId: BodyId | null;
  state: BodyState;
};

export type AccelerationBuffers = {
  ax: Float64Array;
  ay: Float64Array;
  az: Float64Array;
};

/**
 * Brute-force pairwise Newtonian accelerations (m/s²) for a body list.
 * Later Barnes–Hut can replace this without touching the integrator.
 */
export function computeAccelerations(
  bodies: readonly NbodyBody[],
  /** If set, use these masses for force law (e.g. planet + moons). */
  masses?: Float64Array,
): AccelerationBuffers {
  const n = bodies.length;
  const ax = new Float64Array(n);
  const ay = new Float64Array(n);
  const az = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const bi = bodies[i]!;
    const mi = masses ? masses[i]! : bi.mass;
    if (mi <= 0) continue;
    const pi = bi.state.positionM;

    for (let j = i + 1; j < n; j++) {
      const bj = bodies[j]!;
      const mj = masses ? masses[j]! : bj.mass;
      if (mj <= 0) continue;
      const pj = bj.state.positionM;

      const dx = pj.x - pi.x;
      const dy = pj.y - pi.y;
      const dz = pj.z - pi.z;
      const r2 = dx * dx + dy * dy + dz * dz + SOFTENING_M * SOFTENING_M;
      const r = Math.sqrt(r2);
      const accelScale = G / (r2 * r);
      const gx = accelScale * dx;
      const gy = accelScale * dy;
      const gz = accelScale * dz;

      ax[i]! += gx * mj;
      ay[i]! += gy * mj;
      az[i]! += gz * mj;
      ax[j]! -= gx * mi;
      ay[j]! -= gy * mi;
      az[j]! -= gz * mi;
    }
  }

  return { ax, ay, az };
}

/** Softening-based freefall timestep from current accelerations. */
export function suggestTimestepSeconds(
  accel: AccelerationBuffers,
  eta: number = TIMESTEP_ETA,
): number {
  const { ax, ay, az } = accel;
  const n = ax.length;
  let minDt = Number.POSITIVE_INFINITY;

  for (let i = 0; i < n; i++) {
    const aMag = Math.hypot(ax[i]!, ay[i]!, az[i]!);
    if (!(aMag > 0)) continue;
    const dt = eta * Math.sqrt(SOFTENING_M / aMag);
    if (dt < minDt) minDt = dt;
  }

  return Number.isFinite(minDt) ? minDt : Number.POSITIVE_INFINITY;
}

/**
 * One Velocity Verlet substep. `accel` holds a(t) on entry and a(t+dt) on exit.
 */
function velocityVerletSubstep(
  bodies: NbodyBody[],
  masses: Float64Array,
  accel: AccelerationBuffers,
  dt: number,
): void {
  const n = bodies.length;
  const halfDt = 0.5 * dt;
  const { ax, ay, az } = accel;

  for (let i = 0; i < n; i++) {
    if (masses[i]! <= 0) continue;
    const { velocityMS: v, positionM: p } = bodies[i]!.state;
    v.x += ax[i]! * halfDt;
    v.y += ay[i]! * halfDt;
    v.z += az[i]! * halfDt;
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
  }

  const next = computeAccelerations(bodies, masses);
  for (let i = 0; i < n; i++) {
    ax[i] = next.ax[i]!;
    ay[i] = next.ay[i]!;
    az[i] = next.az[i]!;
  }

  for (let i = 0; i < n; i++) {
    if (masses[i]! <= 0) continue;
    const { velocityMS: v } = bodies[i]!.state;
    v.x += ax[i]! * halfDt;
    v.y += ay[i]! * halfDt;
    v.z += az[i]! * halfDt;
  }
}

function stepPrimaries(
  primaries: NbodyBody[],
  masses: Float64Array,
  dt: number,
): void {
  if (primaries.length === 0 || !(dt > 0)) return;

  const accel = computeAccelerations(primaries, masses);
  const dtSafe = suggestTimestepSeconds(accel);
  let substeps = 1;
  if (Number.isFinite(dtSafe) && dtSafe > 0 && dtSafe < dt) {
    substeps = Math.ceil(dt / dtSafe);
  }
  if (substeps > MAX_SUBSTEPS_PER_FRAME) {
    console.warn(
      `n-body primaries: clamping substeps ${substeps} → ${MAX_SUBSTEPS_PER_FRAME} ` +
        `(dt=${dt.toExponential(3)}s, dtSafe=${dtSafe.toExponential(3)}s)`,
    );
    substeps = MAX_SUBSTEPS_PER_FRAME;
  }

  const dtSub = dt / substeps;
  for (let s = 0; s < substeps; s++) {
    velocityVerletSubstep(primaries, masses, accel, dtSub);
  }
}

type Vec3 = { x: number; y: number; z: number };

/** Softened point-mass acceleration of `at` due to mass `m` at `from`. */
function pointAccel(at: Vec3, from: Vec3, m: number): Vec3 {
  const dx = from.x - at.x;
  const dy = from.y - at.y;
  const dz = from.z - at.z;
  const r2 = dx * dx + dy * dy + dz * dz + SOFTENING_M * SOFTENING_M;
  const invR3 = 1 / (r2 * Math.sqrt(r2));
  const s = G * m * invR3;
  return { x: s * dx, y: s * dy, z: s * dz };
}

/**
 * Two-body–equivalent μ for a mass orbiting the system COM with the remaining
 * mass treated as a point at that COM: μ = G · M_rest³ / M_total².
 * (Same formula as `barycentricOrbitMu` — kept local to avoid an import cycle.)
 */
function barycentricMu(totalMassKg: number, orbitingMassKg: number): number {
  const rest = totalMassKg - orbitingMassKg;
  if (!(totalMassKg > 0) || !(rest > 0) || !(orbitingMassKg >= 0)) return 0;
  return (G * rest * rest * rest) / (totalMassKg * totalMassKg);
}

/**
 * Tidal acceleration on a system member relative to the system COM from other
 * heliocentric primaries: a_body − a_COM from each third body.
 * `systemPrimaryId` is skipped (its slot holds the composite during the step).
 */
function tidalAccelerationAboutCom(
  bodyAbs: Vec3,
  comAbs: Vec3,
  systemPrimaryId: BodyId,
  perturbers: readonly NbodyBody[],
): Vec3 {
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (const body of perturbers) {
    if (body.id === systemPrimaryId) continue;
    if (!(body.mass >= MIN_TIDAL_PERTURBER_MASS_KG)) continue;
    const aBody = pointAccel(bodyAbs, body.state.positionM, body.mass);
    const aCom = pointAccel(comAbs, body.state.positionM, body.mass);
    ax += aBody.x - aCom.x;
    ay += aBody.y - aCom.y;
    az += aBody.z - aCom.z;
  }
  return { x: ax, y: ay, z: az };
}

/** Cap a tidal acceleration vector to `cap` m/s². */
function capAcceleration(a: Vec3, cap: number): Vec3 {
  if (!(cap > 0)) return { x: 0, y: 0, z: 0 };
  const mag = Math.hypot(a.x, a.y, a.z);
  if (!(mag > cap)) return a;
  const s = cap / mag;
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/**
 * Pull a barely-unbound COM-relative state back onto a slightly-bound ellipse.
 * Leaves clearly escaping states unchanged so genuine ejections can proceed.
 */
function scrubNumericalHyperbola(
  r: Vec3,
  v: Vec3,
  mu: number,
): { r: Vec3; v: Vec3 } {
  const rMag = Math.hypot(r.x, r.y, r.z);
  if (!(rMag > 0) || !(mu > 0)) return { r, v };
  const v2 = v.x * v.x + v.y * v.y + v.z * v.z;
  const eps = 0.5 * v2 - mu / rMag;
  if (!(eps >= 0)) return { r, v };
  const vMag = Math.sqrt(v2);
  const vEsc = Math.sqrt((2 * mu) / rMag);
  if (!(vMag > 0) || vMag >= NUMERICAL_HYPERBOLIC_VESC_FACTOR * vEsc) {
    return { r, v };
  }
  // Target a nearly-circular bound orbit at the current radius.
  const vBound = Math.sqrt(mu / rMag) * 0.999;
  const s = vBound / vMag;
  return { r, v: { x: v.x * s, y: v.y * s, z: v.z * s } };
}

const TWO_PI = 2 * Math.PI;

function wrapTwoPi(angleRad: number): number {
  const a = angleRad % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/**
 * Advance a Keplerian relative state over `dt`.
 *
 * Bound elliptic orbits advance by mean anomaly in one shot — required when
 * frame steps span hundreds–thousands of revolutions (e.g. HD 80606 b while
 * the binary is viewed at kyr/s). Chaining universal-variable substeps that
 * long accumulates error and unbinds high-e moons.
 *
 * Hyperbolic / degenerate states still use universal-variable substeps.
 */
function keplerPropagateSubstepped(
  r0: Vec3,
  v0: Vec3,
  mu: number,
  dt: number,
  period: number,
): { position: Vec3; velocity: Vec3 } {
  const scrubbed = scrubNumericalHyperbola(r0, v0, mu);

  const elements = stateToClassicalElements(scrubbed.r, scrubbed.v, mu);
  if (
    elements &&
    elements.eccentricity >= 0 &&
    elements.eccentricity < 1 &&
    Number.isFinite(elements.semiMajorAxisM) &&
    elements.semiMajorAxisM > 0
  ) {
    const a = elements.semiMajorAxisM;
    const n = Math.sqrt(mu / (a * a * a));
    if (Number.isFinite(n) && n > 0) {
      const mean0 = trueToMeanAnomaly(
        elements.trueAnomalyRad,
        elements.eccentricity,
      );
      const mean1 = wrapTwoPi(mean0 + n * dt);
      const true1 = meanToTrueAnomaly(mean1, elements.eccentricity);
      const next = classicalElementsToState(
        { ...elements, trueAnomalyRad: true1 },
        mu,
      );
      if (next) {
        return { position: next.positionM, velocity: next.velocityMS };
      }
    }
  }

  const maxDt =
    period < Number.POSITIVE_INFINITY && period > 0
      ? MAX_KEPLER_DT_ORBIT_FRACTION * period
      : Math.abs(dt);
  if (!(maxDt > 0) || Math.abs(dt) <= maxDt) {
    return keplerPropagate(scrubbed.r, scrubbed.v, mu, dt);
  }
  let r = { x: scrubbed.r.x, y: scrubbed.r.y, z: scrubbed.r.z };
  let v = { x: scrubbed.v.x, y: scrubbed.v.y, z: scrubbed.v.z };
  let remaining = dt;
  const sign = dt >= 0 ? 1 : -1;
  while (Math.abs(remaining) > 0) {
    const step = sign * Math.min(Math.abs(remaining), maxDt);
    const drifted = keplerPropagate(r, v, mu, step);
    r = drifted.position;
    v = drifted.velocity;
    remaining -= step;
  }
  return { position: r, velocity: v };
}

function circularOrbitalPeriodSeconds(rMag: number, mu: number): number {
  if (!(rMag > 0) || !(mu > 0)) return Number.POSITIVE_INFINITY;
  return 2 * Math.PI * Math.sqrt((rMag * rMag * rMag) / mu);
}

/** Osculating elliptic period from a, else circular period at |r|. */
function orbitalPeriodSeconds(r: Vec3, v: Vec3, mu: number): number {
  const elements = stateToClassicalElements(r, v, mu);
  if (
    elements &&
    elements.eccentricity >= 0 &&
    elements.eccentricity < 1 &&
    Number.isFinite(elements.semiMajorAxisM) &&
    elements.semiMajorAxisM > 0
  ) {
    const a = elements.semiMajorAxisM;
    return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
  }
  return circularOrbitalPeriodSeconds(Math.hypot(r.x, r.y, r.z), mu);
}

/**
 * Propagate a system-member state about the system barycenter
 * (Kepler with barycentric μ + capped tidal kicks).
 */
function propagateAboutBarycenter(
  orbiting: NbodyBody,
  systemPrimaryId: BodyId,
  primaries: readonly NbodyBody[],
  comAbs: Vec3,
  totalMassKg: number,
  r0: Vec3,
  v0: Vec3,
  dt: number,
): { r: Vec3; v: Vec3 } {
  const mu = barycentricMu(totalMassKg, orbiting.mass);
  if (!(mu > 0)) {
    return { r: { ...r0 }, v: { ...v0 } };
  }
  const scrubbed = scrubNumericalHyperbola(r0, v0, mu);
  const rMag = Math.hypot(scrubbed.r.x, scrubbed.r.y, scrubbed.r.z);
  // Use osculating a for eccentric moons — circular-at-|r| underestimates P
  // near periapsis and opens the tidal-kick path at unsafe frame steps.
  const period = orbitalPeriodSeconds(scrubbed.r, scrubbed.v, mu);
  const centralAccel = rMag > 0 ? mu / (rMag * rMag) : 0;
  const tideCap = TIDAL_ACCEL_CAP_FRACTION * centralAccel;

  if (
    !(dt > 0) ||
    !(period < Number.POSITIVE_INFINITY) ||
    dt > TIDAL_MAX_DT_ORBIT_FRACTION * period
  ) {
    const drifted = keplerPropagateSubstepped(
      scrubbed.r,
      scrubbed.v,
      mu,
      dt,
      period,
    );
    return { r: drifted.position, v: drifted.velocity };
  }

  let r = { x: scrubbed.r.x, y: scrubbed.r.y, z: scrubbed.r.z };
  let v = { x: scrubbed.v.x, y: scrubbed.v.y, z: scrubbed.v.z };

  const steps = Math.max(
    1,
    Math.min(MAX_TIDAL_SUBSTEPS, Math.ceil(dt / (period / 12))),
  );
  const dtSub = dt / steps;
  const half = 0.5 * dtSub;

  for (let s = 0; s < steps; s++) {
    const bodyAbs = {
      x: comAbs.x + r.x,
      y: comAbs.y + r.y,
      z: comAbs.z + r.z,
    };
    const tide = capAcceleration(
      tidalAccelerationAboutCom(bodyAbs, comAbs, systemPrimaryId, primaries),
      tideCap,
    );
    v.x += tide.x * half;
    v.y += tide.y * half;
    v.z += tide.z * half;

    const drifted = keplerPropagate(r, v, mu, dtSub);
    r = drifted.position;
    v = drifted.velocity;

    const rMag2 = Math.hypot(r.x, r.y, r.z);
    const tideCap2 =
      rMag2 > 0 ? TIDAL_ACCEL_CAP_FRACTION * (mu / (rMag2 * rMag2)) : 0;
    const bodyAbs2 = {
      x: comAbs.x + r.x,
      y: comAbs.y + r.y,
      z: comAbs.z + r.z,
    };
    const tide2 = capAcceleration(
      tidalAccelerationAboutCom(bodyAbs2, comAbs, systemPrimaryId, primaries),
      tideCap2,
    );
    v.x += tide2.x * half;
    v.y += tide2.y * half;
    v.z += tide2.z * half;
  }

  return { r, v };
}

function systemComFrame(
  primary: NbodyBody,
  moons: readonly NbodyBody[],
): {
  positionM: Vec3;
  velocityMS: Vec3;
  totalMassKg: number;
} | null {
  let mTot = primary.mass;
  let cx = primary.mass * primary.state.positionM.x;
  let cy = primary.mass * primary.state.positionM.y;
  let cz = primary.mass * primary.state.positionM.z;
  let vx = primary.mass * primary.state.velocityMS.x;
  let vy = primary.mass * primary.state.velocityMS.y;
  let vz = primary.mass * primary.state.velocityMS.z;
  for (const moon of moons) {
    if (!(moon.mass > 0)) continue;
    mTot += moon.mass;
    cx += moon.mass * moon.state.positionM.x;
    cy += moon.mass * moon.state.positionM.y;
    cz += moon.mass * moon.state.positionM.z;
    vx += moon.mass * moon.state.velocityMS.x;
    vy += moon.mass * moon.state.velocityMS.y;
    vz += moon.mass * moon.state.velocityMS.z;
  }
  if (!(mTot > 0)) return null;
  return {
    positionM: { x: cx / mTot, y: cy / mTot, z: cz / mTot },
    velocityMS: { x: vx / mTot, y: vy / mTot, z: vz / mTot },
    totalMassKg: mTot,
  };
}

/**
 * Hierarchical advance with dynamic binding:
 * 1) Update parents (Hill + energy hysteresis)
 * 2) Capture COM-relative states for satellites
 * 3) Park each moon-hosting primary's state on its system barycenter
 * 4) N-body Velocity Verlet on unbound bodies (composite mass at barycenter)
 * 5) Kepler (+ tidal kicks) each satellite about the system barycenter with
 *    barycentric μ (rest mass at COM)
 * 6) Place the primary on the mass-weighted reflex of its satellites so the
 *    system COM stays at the integrated barycenter — the primary orbits that
 *    COM the same way (Pluto–Charon mutual orbit; Jupiter’s tiny wobble)
 * 7) Re-classify parents after the step
 *
 * Satellites share one COM-Kepler propagator. The primary is not frozen at the
 * COM and is not independently Kepler’d with a point-mass moon blob (that
 * fights multi-moon geometry and pumps ejections via re-centering). Reflex
 * placement is the COM constraint: identical to barycentric Kepler for a
 * binary, and the correct primary motion about COM for N satellites.
 */
export type StepNbodyOptions = {
  /**
   * Integrate every body with pairwise Newtonian forces (no Kepler moons).
   * Used for compact moonless systems such as TRAPPIST-1.
   */
  forceSummationOnly?: boolean;
};

/**
 * Shift all states into the system barycentric frame. When `pinPrimary` is
 * true (default), park `starId` at the origin at rest afterward — appropriate
 * for single-star Keplerian systems. Binary / multi-star systems pass
 * `pinPrimary: false` so every star keeps its COM-relative reflex motion.
 */
export function parkStarAtBarycenter(
  states: Partial<Record<BodyId, BodyState>>,
  starId: BodyId,
  options?: { pinPrimary?: boolean },
): void {
  const ids = Object.keys(states) as BodyId[];
  if (ids.length === 0 || !states[starId]) return;

  let totalMass = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (const id of ids) {
    const state = states[id];
    if (!state) continue;
    const mass = BODIES[id]?.mass ?? 0;
    if (!(mass > 0)) continue;
    totalMass += mass;
    cx += mass * state.positionM.x;
    cy += mass * state.positionM.y;
    cz += mass * state.positionM.z;
    vx += mass * state.velocityMS.x;
    vy += mass * state.velocityMS.y;
    vz += mass * state.velocityMS.z;
  }
  if (!(totalMass > 0)) return;

  const comX = cx / totalMass;
  const comY = cy / totalMass;
  const comZ = cz / totalMass;
  const comVx = vx / totalMass;
  const comVy = vy / totalMass;
  const comVz = vz / totalMass;

  for (const id of ids) {
    const state = states[id];
    if (!state) continue;
    state.positionM.x -= comX;
    state.positionM.y -= comY;
    state.positionM.z -= comZ;
    state.velocityMS.x -= comVx;
    state.velocityMS.y -= comVy;
    state.velocityMS.z -= comVz;
  }

  if (options?.pinPrimary === false) return;

  const star = states[starId]!;
  star.positionM.x = 0;
  star.positionM.y = 0;
  star.positionM.z = 0;
  star.velocityMS.x = 0;
  star.velocityMS.y = 0;
  star.velocityMS.z = 0;
}

export function stepNbody(
  bodies: NbodyBody[],
  dtSeconds: number,
  options?: StepNbodyOptions,
): void {
  const n = bodies.length;
  if (n === 0 || !(dtSeconds > 0)) return;

  if (options?.forceSummationOnly) {
    for (const body of bodies) body.parentId = null;
    const masses = new Float64Array(n);
    for (let i = 0; i < n; i++) masses[i] = bodies[i]!.mass;
    stepPrimaries(bodies, masses, dtSeconds);
    return;
  }

  updateOrbitalParents(bodies);

  const byId = new Map<BodyId, NbodyBody>();
  for (const body of bodies) byId.set(body.id, body);

  const primaries: NbodyBody[] = [];
  const moonMassByParent = new Map<BodyId, number>();
  const moonsByPrimary = new Map<BodyId, NbodyBody[]>();

  for (const body of bodies) {
    const parentId = body.parentId;
    if (!parentId) {
      primaries.push(body);
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent) {
      body.parentId = null;
      primaries.push(body);
      continue;
    }
    moonMassByParent.set(
      parentId,
      (moonMassByParent.get(parentId) ?? 0) + body.mass,
    );
    const list = moonsByPrimary.get(parentId);
    if (list) list.push(body);
    else moonsByPrimary.set(parentId, [body]);
  }

  type SatelliteRel = {
    body: NbodyBody;
    primaryId: BodyId;
    r: Vec3;
    v: Vec3;
  };

  // COM-relative satellite states, captured before parking the composite.
  const satelliteRels: SatelliteRel[] = [];
  for (const primary of primaries) {
    const moons = moonsByPrimary.get(primary.id);
    if (!moons || moons.length === 0) continue;
    const com = systemComFrame(primary, moons);
    if (!com) continue;

    for (const moon of moons) {
      const p = moon.state.positionM;
      const v = moon.state.velocityMS;
      satelliteRels.push({
        body: moon,
        primaryId: primary.id,
        r: {
          x: p.x - com.positionM.x,
          y: p.y - com.positionM.y,
          z: p.z - com.positionM.z,
        },
        v: {
          x: v.x - com.velocityMS.x,
          y: v.y - com.velocityMS.y,
          z: v.z - com.velocityMS.z,
        },
      });
    }
  }

  const primaryMasses = new Float64Array(primaries.length);
  for (let i = 0; i < primaries.length; i++) {
    const id = primaries[i]!.id;
    primaryMasses[i] = primaries[i]!.mass + (moonMassByParent.get(id) ?? 0);
  }

  // Composite mass sits at the system barycenter for the heliocentric step.
  for (const primary of primaries) {
    const moons = moonsByPrimary.get(primary.id);
    if (!moons || moons.length === 0) continue;
    const com = systemComFrame(primary, moons);
    if (!com) continue;
    primary.state.positionM.x = com.positionM.x;
    primary.state.positionM.y = com.positionM.y;
    primary.state.positionM.z = com.positionM.z;
    primary.state.velocityMS.x = com.velocityMS.x;
    primary.state.velocityMS.y = com.velocityMS.y;
    primary.state.velocityMS.z = com.velocityMS.z;
  }

  stepPrimaries(primaries, primaryMasses, dtSeconds);

  // Integrated barycenters (still stored on the primary slot).
  const integratedCom = new Map<
    BodyId,
    { positionM: Vec3; velocityMS: Vec3; totalMassKg: number }
  >();
  for (const primary of primaries) {
    const moons = moonsByPrimary.get(primary.id);
    if (!moons) continue;
    const p = primary.state.positionM;
    const v = primary.state.velocityMS;
    integratedCom.set(primary.id, {
      positionM: { x: p.x, y: p.y, z: p.z },
      velocityMS: { x: v.x, y: v.y, z: v.z },
      totalMassKg: primary.mass + (moonMassByParent.get(primary.id) ?? 0),
    });
  }

  // Kepler satellites about the integrated barycenter; group by primary.
  const driftedByPrimary = new Map<BodyId, SatelliteRel[]>();
  for (const rel of satelliteRels) {
    const com = integratedCom.get(rel.primaryId);
    if (!com || !(com.totalMassKg > 0)) continue;
    const drifted = propagateAboutBarycenter(
      rel.body,
      rel.primaryId,
      primaries,
      com.positionM,
      com.totalMassKg,
      rel.r,
      rel.v,
      dtSeconds,
    );
    const entry: SatelliteRel = {
      body: rel.body,
      primaryId: rel.primaryId,
      r: drifted.r,
      v: drifted.v,
    };
    const list = driftedByPrimary.get(rel.primaryId);
    if (list) list.push(entry);
    else driftedByPrimary.set(rel.primaryId, [entry]);
  }

  // Place moons and set each primary to the reflex that keeps Σ m·r = 0
  // about the integrated COM (primary orbits the system barycenter).
  for (const primary of primaries) {
    const moons = driftedByPrimary.get(primary.id);
    if (!moons || moons.length === 0) continue;
    const com = integratedCom.get(primary.id);
    if (!com || !(com.totalMassKg > 0) || !(primary.mass > 0)) continue;

    let moonMassMomentX = 0;
    let moonMassMomentY = 0;
    let moonMassMomentZ = 0;
    let moonMassMomentVx = 0;
    let moonMassMomentVy = 0;
    let moonMassMomentVz = 0;
    for (const m of moons) {
      const mass = m.body.mass;
      moonMassMomentX += mass * m.r.x;
      moonMassMomentY += mass * m.r.y;
      moonMassMomentZ += mass * m.r.z;
      moonMassMomentVx += mass * m.v.x;
      moonMassMomentVy += mass * m.v.y;
      moonMassMomentVz += mass * m.v.z;

      const p = m.body.state.positionM;
      const v = m.body.state.velocityMS;
      p.x = com.positionM.x + m.r.x;
      p.y = com.positionM.y + m.r.y;
      p.z = com.positionM.z + m.r.z;
      v.x = com.velocityMS.x + m.v.x;
      v.y = com.velocityMS.y + m.v.y;
      v.z = com.velocityMS.z + m.v.z;
    }

    const invMp = 1 / primary.mass;
    const pp = primary.state.positionM;
    const pv = primary.state.velocityMS;
    pp.x = com.positionM.x - moonMassMomentX * invMp;
    pp.y = com.positionM.y - moonMassMomentY * invMp;
    pp.z = com.positionM.z - moonMassMomentZ * invMp;
    pv.x = com.velocityMS.x - moonMassMomentVx * invMp;
    pv.y = com.velocityMS.y - moonMassMomentVy * invMp;
    pv.z = com.velocityMS.z - moonMassMomentVz * invMp;
  }

  updateOrbitalParents(bodies);
}

/** Build mutable n-body particles from catalog masses + current states. */
export function createNbodySystem(
  states: Partial<Record<BodyId, BodyState>>,
  bodyIds: readonly BodyId[],
): NbodyBody[] {
  const bodies: NbodyBody[] = [];
  for (const id of bodyIds) {
    const state = states[id];
    if (!state) continue;
    bodies.push({
      id,
      mass: BODIES[id].mass,
      parentId: catalogOrbitalParentId(id),
      state: {
        positionM: { ...state.positionM },
        velocityMS: { ...state.velocityMS },
      },
    });
  }
  return bodies;
}
