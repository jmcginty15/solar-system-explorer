/**
 * Body catalog hydrated from server-owned JSON (bodies.catalog.json).
 * Texture keys are resolved to Vite asset URLs via textureAssets.ts.
 * Call `hydrateBodiesFromApi()` at app startup to refresh from GET /api/bodies.
 */
import catalogJson from "./bodies.catalog.json";
import { resolveTextureKey } from "./textureAssets";
import type {
  AtmosphereData,
  BodyData,
  BodyId,
  RingData,
  RingSystemData,
} from "./types";

type CatalogFile = {
  bodies: Record<string, BodyData>;
  catalogOrder: string[];
};

function bodiesApiUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const base = raw ? raw.replace(/\/$/, "") : "";
  return `${base}/api/bodies`;
}

function resolveAtmosphere(
  atmosphere: AtmosphereData | undefined,
): AtmosphereData | undefined {
  if (!atmosphere) return undefined;
  const textureMapUrl = resolveTextureKey(atmosphere.textureMapUrl);
  const alphaMapUrl = resolveTextureKey(atmosphere.alphaMapUrl);
  if (!textureMapUrl || !alphaMapUrl) return undefined;
  return { textureMapUrl, alphaMapUrl };
}

function resolveRings(
  rings: RingSystemData | undefined,
): RingSystemData | undefined {
  if (!rings) return undefined;
  const textureMapUrl = rings.textureMapUrl
    ? resolveTextureKey(rings.textureMapUrl)
    : undefined;
  return {
    ...rings,
    textureMapUrl,
    rings: rings.rings.map((ring) => ({ ...ring })),
  };
}

function resolveBody(raw: BodyData): BodyData {
  const body: BodyData = { ...raw };

  if (typeof raw.textureMapUrl === "string") {
    body.textureMapUrl = resolveTextureKey(raw.textureMapUrl);
  }
  if (typeof raw.displacementMapUrl === "string") {
    body.displacementMapUrl = resolveTextureKey(raw.displacementMapUrl);
  }
  if (typeof raw.specularMapUrl === "string") {
    body.specularMapUrl = resolveTextureKey(raw.specularMapUrl);
  }
  if (raw.atmosphere) {
    body.atmosphere = resolveAtmosphere(raw.atmosphere);
  }
  if (raw.rings) {
    body.rings = resolveRings(raw.rings);
  }
  return body;
}

function buildCatalog(data: CatalogFile): {
  bodies: Record<BodyId, BodyData>;
  catalog: BodyData[];
} {
  const bodies = {} as Record<BodyId, BodyData>;
  for (const [id, raw] of Object.entries(data.bodies)) {
    bodies[id as BodyId] = resolveBody(raw as BodyData);
  }
  const catalog = data.catalogOrder
    .map((id) => bodies[id as BodyId])
    .filter((body): body is BodyData => Boolean(body));
  return { bodies, catalog };
}

const initial = buildCatalog(catalogJson as CatalogFile);

/** Mutable registry — replaced when hydrating from the API. */
export let BODIES: Record<BodyId, BodyData> = initial.bodies;
export let BODY_CATALOG: BodyData[] = initial.catalog;

/** Replace the in-memory catalog (e.g. after GET /api/bodies). */
export function setBodyCatalog(data: CatalogFile): void {
  const next = buildCatalog(data);
  BODIES = next.bodies;
  BODY_CATALOG = next.catalog;
}

/** Fetch catalog from the ephemeris API and hydrate local registries. */
export async function hydrateBodiesFromApi(): Promise<void> {
  const response = await fetch(bodiesApiUrl());
  if (!response.ok) {
    throw new Error(`Failed to fetch body catalog: HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    bodies: BodyData[];
    catalogOrder: string[];
  };
  const byId: Record<string, BodyData> = {};
  for (const body of payload.bodies) {
    byId[body.id] = body;
  }
  setBodyCatalog({ bodies: byId, catalogOrder: payload.catalogOrder });
}

export function getBody(id: BodyId): BodyData {
  return BODIES[id];
}

export function getRing(bodyId: BodyId, ringId: string): RingData {
  const ring = BODIES[bodyId].rings?.rings.find((entry) => entry.id === ringId);
  if (!ring) {
    throw new Error(`Unknown ring "${ringId}" on body "${bodyId}"`);
  }
  return ring;
}
