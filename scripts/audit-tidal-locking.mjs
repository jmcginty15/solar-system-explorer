/**
 * Audit tidal locking at the present epoch from live SPK states + IAU models.
 *
 * Usage:
 *   node scripts/audit-tidal-locking.mjs
 *   node scripts/audit-tidal-locking.mjs --write
 *
 * --write updates `tidallyLocked` on server/data/bodies.json and syncs the
 * client catalog copy.
 *
 * Period match tolerance: 5% relative |P_rot − P_orb| / P_orb.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverJson = path.join(root, "server/data/bodies.json");
const clientJson = path.join(root, "src/data/bodies.catalog.json");
const apiBase = process.env.SSE_API_BASE ?? "http://127.0.0.1:8765";

const G = 6.674_3e-11;
const JD_J2000 = 2451545.0;
const MS_PER_DAY = 86_400_000;
const TOLERANCE = 0.05;
const HILL_BIND_FRACTION = 0.5;
const HILL_UNBIND_FRACTION = 0.9;
const MIN_PARENT_MASS_RATIO = 100;

/** Mirror of src/simulation/hierarchy.ts catalogOrbitalParentId. */
function catalogOrbitalParentId(body) {
  switch (body.type) {
    case "terrestrial-satellite":
      return "earth";
    case "martian-satellite":
      return "mars";
    case "jovian-satellite":
      return "jupiter";
    case "saturnian-satellite":
      return "saturn";
    case "uranian-satellite":
      return "uranus";
    case "neptunian-satellite":
      return "neptune";
    case "plutonian-satellite":
      return "pluto";
    case "eridian-satellite":
      return "eris";
    case "haumean-satellite":
      return "haumea";
    case "quaoaran-satellite":
      return "quaoar";
    case "orcinian-satellite":
      return "orcus";
    case "salacian-satellite":
      return "salacia";
    case "kagarian-satellite":
      return "kagara";
    case "didymosian-satellite":
      return "didymos";
    case "patroclian-satellite":
      return "patroclus";
    default:
      return null;
  }
}

function dateToJulianDate(date) {
  return date.getTime() / MS_PER_DAY + 2440587.5;
}

function daysFromJ2000(jd) {
  return jd - JD_J2000;
}

function formatPeriod(seconds) {
  if (seconds == null || !(seconds > 0) || !Number.isFinite(seconds)) {
    return "—";
  }
  const hours = seconds / 3600;
  if (hours < 48) return `${hours.toFixed(3)} h`;
  const days = seconds / 86_400;
  if (days < 1000) return `${days.toFixed(3)} d`;
  return `${(days / 365.25).toFixed(3)} y`;
}

function iauPrimeMeridianRateDegPerDay(model, d) {
  const series = model.primeMeridian;
  return (series.perDay ?? 0) + 2 * (series.perDaySquared ?? 0) * d;
}

function siderealRotationPeriodSeconds(wDotDegPerDay) {
  const absRate = Math.abs(wDotDegPerDay);
  if (!(absRate > 0) || !Number.isFinite(absRate)) return null;
  return (360 / absRate) * 86_400;
}

function centerOfMass(bodies) {
  let m = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const body of bodies) {
    if (!(body.mass > 0)) continue;
    m += body.mass;
    x += body.mass * body.state.positionM.x;
    y += body.mass * body.state.positionM.y;
    z += body.mass * body.state.positionM.z;
  }
  if (!(m > 0)) return null;
  return { x: x / m, y: y / m, z: z / m };
}

function centerOfMassVelocity(bodies) {
  let m = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const body of bodies) {
    if (!(body.mass > 0)) continue;
    m += body.mass;
    x += body.mass * body.state.velocityMS.x;
    y += body.mass * body.state.velocityMS.y;
    z += body.mass * body.state.velocityMS.z;
  }
  if (!(m > 0)) return null;
  return { x: x / m, y: y / m, z: z / m };
}

function totalMassKg(bodies) {
  let m = 0;
  for (const body of bodies) {
    if (body.mass > 0) m += body.mass;
  }
  return m;
}

function barycenterFrame(members) {
  const positionM = centerOfMass(members);
  const velocityMS = centerOfMassVelocity(members);
  const mass = totalMassKg(members);
  if (!positionM || !velocityMS || !(mass > 0)) return null;
  return { positionM, velocityMS, totalMassKg: mass };
}

function systemMembers(primaryId, bodies) {
  return bodies.filter(
    (body) => body.id === primaryId || body.parentId === primaryId,
  );
}

function primaryHasBoundSatellites(primaryId, bodies) {
  return bodies.some((body) => body.parentId === primaryId);
}

function orbitReferenceBarycenter(body, bodies) {
  if (body.parentId) {
    return barycenterFrame(systemMembers(body.parentId, bodies));
  }
  if (primaryHasBoundSatellites(body.id, bodies)) {
    return barycenterFrame(systemMembers(body.id, bodies));
  }
  return barycenterFrame(bodies);
}

function barycentricOrbitMu(totalMass, orbitingMass) {
  const rest = totalMass - orbitingMass;
  if (!(totalMass > 0) || !(rest > 0) || !(orbitingMass >= 0)) return 0;
  return (G * rest * rest * rest) / (totalMass * totalMass);
}

function orbitalPeriodAboutParentBarycenterS(body, bodies) {
  const frame = orbitReferenceBarycenter(body, bodies);
  if (!frame) return null;
  const mu = barycentricOrbitMu(frame.totalMassKg, body.mass);
  if (!(mu > 0)) return null;

  const rx = body.state.positionM.x - frame.positionM.x;
  const ry = body.state.positionM.y - frame.positionM.y;
  const rz = body.state.positionM.z - frame.positionM.z;
  const vx = body.state.velocityMS.x - frame.velocityMS.x;
  const vy = body.state.velocityMS.y - frame.velocityMS.y;
  const vz = body.state.velocityMS.z - frame.velocityMS.z;
  const r = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;
  if (!(r > 0)) return null;

  const energy = 0.5 * v2 - mu / r;
  if (!(energy < 0)) return null;
  const a = -mu / (2 * energy);
  if (!(a > 0) || !Number.isFinite(a)) return null;

  // Eccentricity check via angular momentum / semi-latus rectum.
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const h2 = hx * hx + hy * hy + hz * hz;
  if (!(h2 > 0)) return null;
  const p = h2 / mu;
  const e = Math.sqrt(Math.max(0, 1 - p / a));
  if (!(e < 1)) return null;

  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

function hillRadiusM(parentMass, parentHeliocentricDistanceM, sunMass) {
  if (
    !(parentMass > 0) ||
    !(sunMass > 0) ||
    !(parentHeliocentricDistanceM > 0)
  ) {
    return 0;
  }
  return parentHeliocentricDistanceM * Math.cbrt(parentMass / (3 * sunMass));
}

function twoBodySpecificEnergy(parent, child) {
  const dx = child.state.positionM.x - parent.state.positionM.x;
  const dy = child.state.positionM.y - parent.state.positionM.y;
  const dz = child.state.positionM.z - parent.state.positionM.z;
  const r = Math.hypot(dx, dy, dz);
  const dvx = child.state.velocityMS.x - parent.state.velocityMS.x;
  const dvy = child.state.velocityMS.y - parent.state.velocityMS.y;
  const dvz = child.state.velocityMS.z - parent.state.velocityMS.z;
  const v2 = dvx * dvx + dvy * dvy + dvz * dvz;
  const mu = G * (parent.mass + child.mass);
  if (!(r > 0) || !(mu > 0)) {
    return { r: 0, eps: Number.POSITIVE_INFINITY };
  }
  return { r, eps: 0.5 * v2 - mu / r };
}

function isEligibleParent(
  parent,
  child,
  parentParentId,
  childParentId,
  catalog,
) {
  if (parent.id === child.id || parent.id === "sun") return false;
  if (parentParentId !== null) return false;
  if (parent.mass >= MIN_PARENT_MASS_RATIO * child.mass) return true;
  if (childParentId === parent.id) return true;
  if (catalogOrbitalParentId(catalog[child.id]) === parent.id) return true;
  return false;
}

function stillBoundToParent(parent, child, sun) {
  const { r, eps } = twoBodySpecificEnergy(parent, child);
  if (!(r > 0)) return false;
  const a = Math.hypot(
    parent.state.positionM.x - sun.state.positionM.x,
    parent.state.positionM.y - sun.state.positionM.y,
    parent.state.positionM.z - sun.state.positionM.z,
  );
  const rH = hillRadiusM(parent.mass, a, sun.mass);
  if (!(rH > 0)) return false;
  if (r > HILL_UNBIND_FRACTION * rH) return false;
  if (r < HILL_BIND_FRACTION * rH) return true;
  return eps < 0;
}

function canBindToParent(parent, child, sun) {
  const { r, eps } = twoBodySpecificEnergy(parent, child);
  if (!(r > 0) || !(eps < 0)) return false;
  const a = Math.hypot(
    parent.state.positionM.x - sun.state.positionM.x,
    parent.state.positionM.y - sun.state.positionM.y,
    parent.state.positionM.z - sun.state.positionM.z,
  );
  const rH = hillRadiusM(parent.mass, a, sun.mass);
  if (!(rH > 0)) return false;
  return r < HILL_BIND_FRACTION * rH;
}

/** Mirror of src/simulation/hierarchy.ts updateOrbitalParents. */
function updateOrbitalParents(bodies, catalog) {
  const sun = bodies.find((body) => body.id === "sun");
  if (!sun) {
    for (const body of bodies) body.parentId = null;
    return;
  }

  const parentSnapshot = new Map();
  for (const body of bodies) parentSnapshot.set(body.id, body.parentId);

  for (const child of bodies) {
    if (child.id === "sun") {
      child.parentId = null;
      continue;
    }

    const currentParentId = parentSnapshot.get(child.id) ?? null;
    const currentParent =
      currentParentId != null
        ? bodies.find((body) => body.id === currentParentId)
        : null;

    if (
      currentParent &&
      stillBoundToParent(currentParent, child, sun) &&
      isEligibleParent(
        currentParent,
        child,
        parentSnapshot.get(currentParent.id) ?? null,
        currentParentId,
        catalog,
      )
    ) {
      child.parentId = currentParent.id;
      continue;
    }

    let bestId = null;
    let bestEps = Number.POSITIVE_INFINITY;
    for (const parent of bodies) {
      if (
        !isEligibleParent(
          parent,
          child,
          parentSnapshot.get(parent.id) ?? null,
          currentParentId,
          catalog,
        )
      ) {
        continue;
      }
      if (!canBindToParent(parent, child, sun)) continue;
      const { eps } = twoBodySpecificEnergy(parent, child);
      if (eps < bestEps) {
        bestEps = eps;
        bestId = parent.id;
      }
    }
    child.parentId = bestId;
  }
}

async function fetchStates(jd) {
  const url = `${apiBase}/api/ephemeris/states?jd=${encodeURIComponent(String(jd))}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Ephemeris API failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

async function main() {
  const write = process.argv.includes("--write");
  const catalog = JSON.parse(readFileSync(serverJson, "utf8"));
  const byId = catalog.bodies;

  const jd = dateToJulianDate(new Date());
  console.log(
    `Auditing tidal lock at JD ${jd.toFixed(5)} (tolerance ${(TOLERANCE * 100).toFixed(1)}%)`,
  );
  console.log(`API: ${apiBase}`);

  const payload = await fetchStates(jd);
  const bodies = [];
  const missing = [];
  for (const id of catalog.catalogOrder) {
    const state = payload.states?.[id];
    const meta = byId[id];
    if (!state || !meta) {
      missing.push(id);
      continue;
    }
    bodies.push({
      id,
      mass: meta.mass,
      parentId: catalogOrbitalParentId(meta),
      state: {
        positionM: { ...state.positionM },
        velocityMS: { ...state.velocityMS },
      },
    });
  }

  updateOrbitalParents(bodies, byId);
  const d = daysFromJ2000(jd);

  const entries = [];
  for (const body of bodies) {
    const meta = byId[body.id];
    const wDot = iauPrimeMeridianRateDegPerDay(meta.iauOrientation, d);
    const rotationPeriodS = siderealRotationPeriodSeconds(wDot);
    const orbitalPeriodS = orbitalPeriodAboutParentBarycenterS(body, bodies);

    let relativeDiff = null;
    let tidallyLocked = false;
    let skipReason;
    if (rotationPeriodS == null) {
      skipReason = "no IAU W rate";
    } else if (orbitalPeriodS == null) {
      skipReason = "no bound elliptical orbit about parent barycenter";
    } else {
      relativeDiff =
        Math.abs(rotationPeriodS - orbitalPeriodS) / orbitalPeriodS;
      tidallyLocked = relativeDiff <= TOLERANCE;
    }

    entries.push({
      id: body.id,
      name: meta.name,
      orbitParentId: body.parentId,
      orbitalPeriodS,
      rotationPeriodS,
      relativeDiff,
      tidallyLocked,
      skipReason,
    });
  }

  const locked = entries.filter((e) => e.tidallyLocked);
  const nearMisses = entries
    .filter(
      (e) =>
        !e.tidallyLocked &&
        e.relativeDiff != null &&
        e.relativeDiff <= TOLERANCE * 3,
    )
    .sort((a, b) => a.relativeDiff - b.relativeDiff);

  console.log(`\nBodies with SPK state: ${bodies.length}`);
  if (missing.length) {
    console.log(`Missing SPK state (${missing.length}): ${missing.join(", ")}`);
  }

  console.log(`\nTidally locked (${locked.length}):`);
  for (const entry of locked.sort((a, b) => a.name.localeCompare(b.name))) {
    const parent = entry.orbitParentId ?? "ssb";
    const pct = `${(entry.relativeDiff * 100).toFixed(3)}%`;
    console.log(
      `  ${entry.name.padEnd(22)}  Porb=${formatPeriod(entry.orbitalPeriodS).padEnd(12)}  Prot=${formatPeriod(entry.rotationPeriodS).padEnd(12)}  Δ=${pct.padEnd(9)}  parent=${parent}`,
    );
  }

  if (nearMisses.length) {
    console.log(`\nNear misses (≤ ${(TOLERANCE * 300).toFixed(0)}%):`);
    for (const entry of nearMisses.slice(0, 25)) {
      const pct = `${(entry.relativeDiff * 100).toFixed(3)}%`;
      console.log(
        `  ${entry.name.padEnd(22)}  Porb=${formatPeriod(entry.orbitalPeriodS).padEnd(12)}  Prot=${formatPeriod(entry.rotationPeriodS).padEnd(12)}  Δ=${pct}`,
      );
    }
  }

  if (write) {
    const lockedIds = new Set(locked.map((e) => e.id));
    for (const [id, body] of Object.entries(catalog.bodies)) {
      if (lockedIds.has(id)) {
        body.tidallyLocked = true;
      } else {
        delete body.tidallyLocked;
      }
    }
    writeFileSync(serverJson, `${JSON.stringify(catalog, null, 2)}\n`);
    mkdirSync(path.dirname(clientJson), { recursive: true });
    copyFileSync(serverJson, clientJson);
    console.log(
      `\nWrote tidallyLocked=true on ${lockedIds.size} bodies → ${serverJson}`,
    );
    console.log(`Synced → ${clientJson}`);
  } else {
    console.log("\n(Dry run — pass --write to update bodies.json)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
