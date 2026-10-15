import {
  BODIES,
  bodyStellarSystemId,
  isPrimaryStar,
  type BodyData,
  type BodyId,
  type BodyPositionM,
  type SatelliteGroup,
  type StellarSystemId,
} from "../data";
import {
  catalogOrbitalParentId,
  defaultPlanetarySystemVisibleIds,
  isStellarBarycenterFocusId,
  isSystemFocusId,
  stellarBarycenterFocusId,
  systemDisplayName,
  systemFocusIdForPrimary,
  systemPrimaryId,
  type FocusId,
  type OrbitalParentMap,
  type SystemFocusId,
} from "../simulation";

/** Satellite families auto-revealed when focusing a giant-planet system. */
const JUPITER_FOCUS_SATELLITE_GROUPS = new Set<SatelliteGroup>([
  "inner",
  "galilean",
]);
const SATURN_FOCUS_SATELLITE_GROUPS = new Set<SatelliteGroup>(["major"]);
const URANUS_FOCUS_SATELLITE_GROUPS = new Set<SatelliteGroup>(["major"]);
const NEPTUNE_FOCUS_SATELLITE_GROUPS = new Set<SatelliteGroup>(["inner"]);

export type { FocusId, SystemFocusId };

export type SystemFocusEntry = {
  id: SystemFocusId;
  name: string;
};

export type BodyFocusEntry = {
  /** Primary body this row is built around (planet, sun, dwarf, etc.). */
  body: BodyData;
  /**
   * When set, the expandable header is this system barycenter and `body` is
   * listed as the first nested item (then moons).
   */
  systemHeader: SystemFocusEntry | null;
  /** Moons (or other satellites) nested under the system / primary. */
  children: BodyData[];
};

export type BodyFocusGroup = {
  id: string;
  label: string;
  entries: BodyFocusEntry[];
};

export type BuildBodyFocusGroupsOptions = {
  /** Bodies with ephemeris / scene presence. Omit to include the full catalog. */
  availableBodyIds?: ReadonlySet<BodyId> | null;
  /**
   * Live orbital parents from the n-body hierarchy. When set, nesting follows
   * captures / ejections; when omitted, catalog satellite parents are used.
   */
  parentByBodyId?: OrbitalParentMap | null;
};

/** Display order for named satellite families in the focus picker. */
export const SATELLITE_GROUP_ORDER: readonly SatelliteGroup[] = [
  "inner",
  "galilean",
  "major",
  "regular",
  "himalia",
  "carpo",
  "ananke",
  "carme",
  "pasiphae",
  "inuit",
  "gallic",
  "norse",
  "caliban",
  "irregular",
  "sao",
  "neso",
] as const;

export const SATELLITE_GROUP_LABELS: Record<SatelliteGroup, string> = {
  inner: "Inner moons",
  galilean: "Galilean moons",
  major: "Major moons",
  regular: "Regular moons",
  himalia: "Himalia group",
  carpo: "Carpo group",
  ananke: "Ananke group",
  carme: "Carme group",
  pasiphae: "Pasiphae group",
  inuit: "Inuit group",
  gallic: "Gallic group",
  norse: "Norse group",
  caliban: "Caliban group",
  irregular: "Irregular moons",
  sao: "Sao group",
  neso: "Neso group",
};

export type SatelliteGroupSection = {
  group: SatelliteGroup;
  label: string;
  bodies: BodyData[];
};

const PLANET_TYPES = new Set(["terrestrial-planet", "gas-giant", "ice-giant"]);

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
};

function romanNumeralToInt(roman: string): number {
  let total = 0;
  let prev = 0;
  for (let i = roman.length - 1; i >= 0; i--) {
    const value = ROMAN_VALUES[roman[i]!] ?? 0;
    if (value < prev) total -= value;
    else {
      total += value;
      prev = value;
    }
  }
  return total;
}

/**
 * Roman designation `X*` in parentheses (e.g. `(JVI)`, `(SI)`), where X is the
 * parent planet's initial and * is a Roman numeral. Missing → sort after.
 */
function designationRomanOrder(body: BodyData): number | null {
  const match = /\(([A-Z])([IVXLCDM]+)\)/i.exec(body.name);
  if (!match) return null;
  return romanNumeralToInt(match[2]!.toUpperCase());
}

/**
 * Provisional designation `S/XXXX Y*` (e.g. `S/2017 J10`), where XXXX is the
 * year, Y is the parent planet's initial, and * is an Arabic number.
 */
function provisionalDesignationOrder(body: BodyData): [number, number] | null {
  const match = /S\/(\d{4})\s*([A-Z])\s*(\d+)/i.exec(body.name);
  if (!match) return null;
  return [Number(match[1]), Number(match[3])];
}

/** True for proper names (Janus, Io); false for provisional `S/2004 S32` forms. */
function isNamedSatellite(body: BodyData): boolean {
  return !/^S\/\d{4}\b/i.test(body.name.trim());
}

function satelliteGroupOrder(body: BodyData): number {
  const group = body.satelliteGroup ?? null;
  if (group == null) return SATELLITE_GROUP_ORDER.length;
  const index = SATELLITE_GROUP_ORDER.indexOf(group);
  return index === -1 ? SATELLITE_GROUP_ORDER.length : index;
}

function compareSatellites(a: BodyData, b: BodyData): number {
  const byGroup = satelliteGroupOrder(a) - satelliteGroupOrder(b);
  if (byGroup !== 0) return byGroup;

  const romanA = designationRomanOrder(a);
  const romanB = designationRomanOrder(b);
  if (romanA != null || romanB != null) {
    if (romanA == null) return 1;
    if (romanB == null) return -1;
    if (romanA !== romanB) return romanA - romanB;
  }

  const provA = provisionalDesignationOrder(a);
  const provB = provisionalDesignationOrder(b);
  if (provA != null || provB != null) {
    if (provA == null) return 1;
    if (provB == null) return -1;
    if (provA[0] !== provB[0]) return provA[0] - provB[0];
    if (provA[1] !== provB[1]) return provA[1] - provB[1];
  }

  return a.name.localeCompare(b.name);
}

function sortChildrenForParent(children: BodyData[]): BodyData[] {
  if (children.length < 2) return children;
  return [...children].sort(compareSatellites);
}

/** Leading MPC / provisional number in a body name (e.g. `617` in `617 Patroclus`). */
function leadingDesignationNumber(name: string): number | null {
  const match = /^(\d+)\b/.exec(name.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function compareByDesignationNumber(a: BodyData, b: BodyData): number {
  const numA = leadingDesignationNumber(a.name);
  const numB = leadingDesignationNumber(b.name);
  if (numA != null || numB != null) {
    if (numA == null) return 1;
    if (numB == null) return -1;
    if (numA !== numB) return numA - numB;
  }
  return a.name.localeCompare(b.name);
}

function sortByDesignationNumber(bodies: BodyData[]): BodyData[] {
  if (bodies.length < 2) return bodies;
  return [...bodies].sort(compareByDesignationNumber);
}

function resolveParentId(
  bodyId: BodyId,
  parentByBodyId: OrbitalParentMap | null | undefined,
): BodyId | null {
  if (parentByBodyId) return parentByBodyId.get(bodyId) ?? null;
  return catalogOrbitalParentId(bodyId);
}

/** Available moons currently bound to (or catalogued under) `primaryId`. */
export function moonsForPrimary(
  primaryId: BodyId,
  availableBodyIds: ReadonlySet<BodyId> | readonly BodyId[],
  parentByBodyId?: OrbitalParentMap | null,
): BodyData[] {
  const available =
    availableBodyIds instanceof Set
      ? availableBodyIds
      : new Set(availableBodyIds);
  const moons: BodyData[] = [];
  for (const id of available) {
    const bodyId = id as BodyId;
    if (resolveParentId(bodyId, parentByBodyId) !== primaryId) continue;
    const body = BODIES[bodyId];
    if (body) moons.push(body);
  }
  return sortChildrenForParent(moons);
}

/**
 * Outermost moon: furthest from the primary in `positions` when available,
 * otherwise the last moon in catalog/group sort order.
 */
export function outermostMoonId(
  primaryId: BodyId,
  moons: readonly BodyData[],
  positions?: Partial<Record<BodyId, BodyPositionM>> | null,
): BodyId | null {
  if (moons.length === 0) return null;
  const primaryPos = positions?.[primaryId];
  if (primaryPos) {
    let bestId: BodyId | null = null;
    let bestDistSq = -1;
    for (const moon of moons) {
      const pos = positions?.[moon.id as BodyId];
      if (!pos) continue;
      const dx = pos.x - primaryPos.x;
      const dy = pos.y - primaryPos.y;
      const dz = pos.z - primaryPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > bestDistSq) {
        bestDistSq = distSq;
        bestId = moon.id as BodyId;
      }
    }
    if (bestId) return bestId;
  }
  return moons[moons.length - 1]!.id as BodyId;
}

export type SystemFocusVisibilityOptions = {
  availableBodyIds: ReadonlySet<BodyId> | readonly BodyId[];
  parentByBodyId?: OrbitalParentMap | null;
  /** Live body positions for outermost-moon distance; optional. */
  positions?: Partial<Record<BodyId, BodyPositionM>> | null;
};

/**
 * Tag / orbit ids when focusing a planetary system (or the solar system).
 * Always includes page-load defaults, then system-specific moons / orbits.
 * Callers should replace visibility sets with this list (not merge).
 */
export function tagOrbitIdsForSystemFocus(
  systemId: SystemFocusId,
  options: SystemFocusVisibilityOptions,
): FocusId[] {
  const available: ReadonlySet<BodyId> =
    options.availableBodyIds instanceof Set
      ? options.availableBodyIds
      : new Set<BodyId>(options.availableBodyIds);
  const availableList: BodyId[] = [...available];
  const ids = new Set<FocusId>(
    defaultPlanetarySystemVisibleIds(availableList, options.parentByBodyId),
  );

  if (isStellarBarycenterFocusId(systemId)) {
    // Reveal the host star tag; planet defaults already come from above.
    for (const id of availableList) {
      const body = BODIES[id];
      if (body?.type === "star" || body?.glowAndLight) ids.add(id);
    }
    return [...ids];
  }

  ids.add(systemId);
  const primaryId = systemPrimaryId(systemId);
  if (!primaryId || !available.has(primaryId)) return [...ids];
  // System-centric primary body (tag + orbit about the system barycenter).
  ids.add(primaryId);

  const moons = moonsForPrimary(primaryId, available, options.parentByBodyId);
  const outermost = outermostMoonId(primaryId, moons, options.positions);
  if (outermost) ids.add(outermost);

  if (moons.length < 50) {
    for (const moon of moons) ids.add(moon.id as BodyId);
  } else if (primaryId === "jupiter") {
    for (const moon of moons) {
      if (
        isNamedSatellite(moon) ||
        (moon.satelliteGroup != null &&
          JUPITER_FOCUS_SATELLITE_GROUPS.has(moon.satelliteGroup))
      ) {
        ids.add(moon.id as BodyId);
      }
    }
  } else if (primaryId === "saturn") {
    for (const moon of moons) {
      if (
        isNamedSatellite(moon) ||
        (moon.satelliteGroup != null &&
          SATURN_FOCUS_SATELLITE_GROUPS.has(moon.satelliteGroup))
      ) {
        ids.add(moon.id as BodyId);
      }
    }
  } else if (primaryId === "uranus") {
    for (const moon of moons) {
      if (
        moon.satelliteGroup &&
        URANUS_FOCUS_SATELLITE_GROUPS.has(moon.satelliteGroup)
      ) {
        ids.add(moon.id as BodyId);
      }
    }
  } else if (primaryId === "neptune") {
    for (const moon of moons) {
      if (
        moon.satelliteGroup &&
        NEPTUNE_FOCUS_SATELLITE_GROUPS.has(moon.satelliteGroup)
      ) {
        ids.add(moon.id as BodyId);
      }
    }
    // Triton and Nereid are ungrouped but part of Neptune's default reveal.
    if (available.has("triton")) ids.add("triton");
    if (available.has("nereid")) ids.add("nereid");
  }

  return [...ids];
}

/**
 * Tag / orbit ids for any focus target. Replaces prior visibility (deselects
 * everything not in the returned set):
 * - solar system / page-load defaults
 * - planetary system → defaults + system members per giant-planet rules
 * - system primary body → same as focusing that system
 * - moon → that system's defaults + the focused moon
 * - heliocentric body → defaults + the focused body
 */
export function tagOrbitIdsForFocus(
  focusId: FocusId,
  options: SystemFocusVisibilityOptions,
): FocusId[] {
  if (isSystemFocusId(focusId)) {
    return tagOrbitIdsForSystemFocus(focusId, options);
  }

  const available =
    options.availableBodyIds instanceof Set
      ? options.availableBodyIds
      : new Set(options.availableBodyIds);
  const availableList = [...available];

  const parentId = resolveParentId(focusId, options.parentByBodyId);
  if (parentId != null && available.has(parentId)) {
    const systemIds = tagOrbitIdsForSystemFocus(
      systemFocusIdForPrimary(parentId),
      options,
    );
    const ids = new Set<FocusId>(systemIds);
    if (available.has(focusId)) ids.add(focusId);
    return [...ids];
  }

  // Focusing a system primary is the same as focusing its system.
  const moons = moonsForPrimary(focusId, available, options.parentByBodyId);
  if (moons.length > 0) {
    return tagOrbitIdsForSystemFocus(systemFocusIdForPrimary(focusId), options);
  }

  const ids = new Set<FocusId>(
    defaultPlanetarySystemVisibleIds(availableList, options.parentByBodyId),
  );
  if (available.has(focusId)) ids.add(focusId);
  return [...ids];
}

/**
 * Partition already-sorted satellites into titled family sections for the
 * focus picker. Ungrouped moons are omitted here — render them separately.
 */
export function satelliteGroupSections(
  children: readonly BodyData[],
): SatelliteGroupSection[] {
  const sections: SatelliteGroupSection[] = [];
  for (const body of children) {
    const group = body.satelliteGroup ?? null;
    if (group == null) continue;
    const last = sections[sections.length - 1];
    if (last && last.group === group) {
      last.bodies.push(body);
      continue;
    }
    sections.push({
      group,
      label: SATELLITE_GROUP_LABELS[group],
      bodies: [body],
    });
  }
  return sections;
}

/** Ungrouped satellites, preserving the order of `children`. */
export function ungroupedSatellites(children: readonly BodyData[]): BodyData[] {
  return children.filter((body) => body.satelliteGroup == null);
}

export function satelliteSectionsShowLabels(
  sections: readonly SatelliteGroupSection[],
): boolean {
  return sections.length > 0;
}

/** Expand-set key for a named satellite family under a system / primary header. */
export function satelliteGroupExpandKey(
  parentHeaderId: FocusId | string,
  group: SatelliteGroup,
): string {
  return `${parentHeaderId}::sat:${group}`;
}

/**
 * Expand-set key for the satellite family that contains `focusId`, if any.
 * Used to auto-open the matching moon group when focusing a member.
 */
export function satelliteGroupExpandKeyForBody(
  groups: readonly BodyFocusGroup[],
  focusId: FocusId,
): string | null {
  for (const group of groups) {
    for (const entry of group.entries) {
      for (const child of entry.children) {
        if (child.id !== focusId || child.satelliteGroup == null) continue;
        return satelliteGroupExpandKey(
          entryHeaderId(entry),
          child.satelliteGroup,
        );
      }
    }
  }
  return null;
}

function systemHeaderFor(
  body: BodyData,
  moons: BodyData[],
): SystemFocusEntry | null {
  if (moons.length === 0) return null;
  const id = systemFocusIdForPrimary(body.id as BodyId);
  return { id, name: systemDisplayName(id) };
}

/** Focus id shown on the entry's header row. */
export function entryHeaderId(entry: BodyFocusEntry): FocusId {
  return entry.systemHeader?.id ?? (entry.body.id as BodyId);
}

/** Display name for the entry's header row. */
export function entryHeaderName(entry: BodyFocusEntry): string {
  return entry.systemHeader?.name ?? entry.body.name;
}

export function entryHasDropdown(entry: BodyFocusEntry): boolean {
  // Stellar barycenter rows are standalone — they do not nest the host star.
  if (entry.systemHeader && isStellarBarycenterFocusId(entry.systemHeader.id)) {
    return false;
  }
  return entry.systemHeader != null || entry.children.length > 0;
}

/** Nested body rows under a system header (primary first, then moons). */
export function entryNestedBodies(entry: BodyFocusEntry): BodyData[] {
  if (
    !entry.systemHeader ||
    isStellarBarycenterFocusId(entry.systemHeader.id)
  ) {
    return entry.children;
  }
  return [entry.body, ...entry.children];
}

/**
 * Group catalog bodies for the focus picker: unlabeled Solar System → star →
 * planets (nested primary + moons under system barycenter) → dwarf planets →
 * asteroids → comets.
 *
 * Nesting follows the live orbital hierarchy when `parentByBodyId` is set
 * (captures appear under the capturer; ejections return to top-level).
 */
export function buildBodyFocusGroups(
  catalog: readonly BodyData[],
  options?: BuildBodyFocusGroupsOptions | null,
): BodyFocusGroup[] {
  const available = options?.availableBodyIds ?? null;
  const parentByBodyId = options?.parentByBodyId ?? null;
  const isAvailable = (id: string): boolean =>
    available == null || available.has(id as BodyId);

  const stars: BodyData[] = [];
  const planets: BodyData[] = [];
  const dwarfs: BodyData[] = [];
  const asteroids: BodyData[] = [];
  const comets: BodyData[] = [];
  const other: BodyData[] = [];
  const childrenByParent = new Map<BodyId, BodyData[]>();

  for (const body of catalog) {
    if (!isAvailable(body.id)) continue;
    const bodyId = body.id as BodyId;
    const parentId = resolveParentId(bodyId, parentByBodyId);
    if (parentId && isAvailable(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(body);
      childrenByParent.set(parentId, list);
      continue;
    }

    const type = body.type;
    if (type === "star") {
      stars.push(body);
      continue;
    }
    if (type && PLANET_TYPES.has(type)) {
      planets.push(body);
      continue;
    }
    if (type === "dwarf-planet") {
      dwarfs.push(body);
      continue;
    }
    if (type === "asteroid") {
      asteroids.push(body);
      continue;
    }
    if (type === "comet") {
      comets.push(body);
      continue;
    }
    other.push(body);
  }

  const withSystems = (bodies: BodyData[]): BodyFocusEntry[] =>
    bodies.map((body) => {
      const parentId = body.id as BodyId;
      const children = sortChildrenForParent(
        childrenByParent.get(parentId) ?? [],
      );
      return {
        body,
        systemHeader: systemHeaderFor(body, children),
        children,
      };
    });

  // Bound children whose parent is not in the main lists still need a home
  // (e.g. asteroid–asteroid capture).
  const knownParents = new Set(
    [...planets, ...dwarfs, ...asteroids, ...comets, ...stars].map(
      (body) => body.id as BodyId,
    ),
  );
  for (const [parentId, children] of childrenByParent) {
    if (knownParents.has(parentId) || children.length === 0) continue;
    const parentBody = catalog.find((body) => body.id === parentId);
    if (parentBody && isAvailable(parentId)) {
      other.push(parentBody);
      knownParents.add(parentId);
    } else {
      other.push(...children);
    }
  }

  const groups: BodyFocusGroup[] = [];
  // Stellar-system barycenter row, then the host star under "Star".
  const primaryStars = stars.filter((body) => isPrimaryStar(body.id as BodyId));
  for (const star of primaryStars) {
    const stellarId = bodyStellarSystemId(star) as StellarSystemId;
    const focusId = stellarBarycenterFocusId(stellarId);
    groups.push({
      id: focusId,
      label: "",
      entries: [
        {
          body: star,
          systemHeader: {
            id: focusId,
            name: "System Barycenter",
          },
          children: [],
        },
      ],
    });
  }
  if (stars.length) {
    groups.push({
      id: "star",
      label: stars.length === 1 ? "Star" : "Stars",
      // Stars may host bound planets (e.g. HD 80606 + b) — nest like planets.
      entries: withSystems(stars),
    });
  }
  if (planets.length) {
    groups.push({
      id: "planets",
      label: "Planets",
      entries: withSystems(planets),
    });
  }
  if (dwarfs.length) {
    groups.push({
      id: "dwarfs",
      label: "Dwarf planets",
      entries: withSystems(sortByDesignationNumber(dwarfs)),
    });
  }
  if (asteroids.length) {
    groups.push({
      id: "asteroids",
      label: "Asteroids",
      entries: withSystems(sortByDesignationNumber(asteroids)),
    });
  }
  if (comets.length) {
    groups.push({
      id: "comets",
      label: "Comets",
      entries: withSystems(comets),
    });
  }
  if (other.length) {
    const seen = new Set<string>();
    const unique = other.filter((body) => {
      if (seen.has(body.id)) return false;
      seen.add(body.id);
      return true;
    });
    groups.push({
      id: "other",
      label: "Other",
      entries: withSystems(unique),
    });
  }

  return groups;
}

function entryMatches(entry: BodyFocusEntry, q: string, groupLabel: string) {
  const headerName = entryHeaderName(entry).toLowerCase();
  const headerId = String(entryHeaderId(entry)).toLowerCase();
  const parentHit =
    entry.body.name.toLowerCase().includes(q) ||
    entry.body.id.toLowerCase().includes(q) ||
    headerName.includes(q) ||
    headerId.includes(q) ||
    groupLabel.toLowerCase().includes(q);
  const systemHit = Boolean(
    entry.systemHeader &&
    (entry.systemHeader.name.toLowerCase().includes(q) ||
      entry.systemHeader.id.toLowerCase().includes(q)),
  );
  const childHits = entry.children.filter(
    (child) =>
      child.name.toLowerCase().includes(q) ||
      child.id.toLowerCase().includes(q),
  );
  const primaryHit =
    entry.systemHeader != null &&
    (entry.body.name.toLowerCase().includes(q) ||
      entry.body.id.toLowerCase().includes(q));
  return { parentHit, systemHit, childHits, primaryHit };
}

/** Filter groups by name / id; keep parent rows when a moon or system matches. */
export function filterBodyFocusGroups(
  groups: readonly BodyFocusGroup[],
  query: string,
): BodyFocusGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return groups.map((group) => ({
      ...group,
      entries: group.entries.map((entry) => ({
        ...entry,
        children: [...entry.children],
      })),
    }));
  }

  const filtered: BodyFocusGroup[] = [];
  for (const group of groups) {
    const entries: BodyFocusEntry[] = [];
    for (const entry of group.entries) {
      const { parentHit, systemHit, childHits, primaryHit } = entryMatches(
        entry,
        q,
        group.label,
      );
      if (parentHit || systemHit) {
        const headerNameHit = entryHeaderName(entry).toLowerCase().includes(q);
        const bodyNameHit = entry.body.name.toLowerCase().includes(q);
        // Header/system/primary match: keep full nest unless only some moons hit.
        const narrowMoons =
          childHits.length > 0 && !headerNameHit && !bodyNameHit && !systemHit;
        entries.push({
          body: entry.body,
          systemHeader: entry.systemHeader,
          children: narrowMoons ? childHits : [...entry.children],
        });
      } else if (primaryHit || childHits.length > 0) {
        entries.push({
          body: entry.body,
          systemHeader: entry.systemHeader,
          children: childHits,
        });
      }
    }
    if (entries.length) filtered.push({ ...group, entries });
  }
  return filtered;
}

/**
 * Visible focus ids in display order. Nested primary + moons are included only
 * when their header id is in `expandedParentIds` (or always when `expandAll`).
 * Named moon groups are nested a level deeper and use
 * {@link satelliteGroupExpandKey} entries in the same set.
 */
export function flattenBodyFocusIds(
  groups: readonly BodyFocusGroup[],
  expandedParentIds: ReadonlySet<string>,
  expandAll = false,
): FocusId[] {
  const ids: FocusId[] = [];
  for (const group of groups) {
    for (const entry of group.entries) {
      const headerId = entryHeaderId(entry);
      const headerKey = String(headerId);
      ids.push(headerId);
      const showChildren = expandAll || expandedParentIds.has(headerKey);
      if (!showChildren || !entryHasDropdown(entry)) continue;

      if (entry.systemHeader) {
        ids.push(entry.body.id as BodyId);
      }

      const sections = satelliteGroupSections(entry.children);
      if (satelliteSectionsShowLabels(sections)) {
        for (const section of sections) {
          const satKey = satelliteGroupExpandKey(headerKey, section.group);
          if (!expandAll && !expandedParentIds.has(satKey)) continue;
          for (const child of section.bodies) {
            ids.push(child.id as BodyId);
          }
        }
        for (const child of ungroupedSatellites(entry.children)) {
          ids.push(child.id as BodyId);
        }
      } else {
        for (const child of entry.children) {
          ids.push(child.id as BodyId);
        }
      }
    }
  }
  return ids;
}

/** Header focus id for a nested primary/moon, if any. */
export function focusTreeParentId(
  groups: readonly BodyFocusGroup[],
  focusId: FocusId,
): FocusId | null {
  for (const group of groups) {
    for (const entry of group.entries) {
      if (!entryHasDropdown(entry)) continue;
      const headerId = entryHeaderId(entry);
      if (headerId === focusId) continue;
      if (entryNestedBodies(entry).some((body) => body.id === focusId)) {
        return headerId;
      }
    }
  }
  return null;
}
