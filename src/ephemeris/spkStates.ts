import type { BodyId } from "../data/types";
import { apiUrl } from "../api";
import type { BodyState } from "./bodyState";

type StatesResponse = {
  jd: number;
  frame: string;
  center: string;
  states: Partial<Record<BodyId, BodyState>>;
  missing: string[];
};

/** ICRF/J2000 state for one body at a Julian date, from the ephemeris API. */
export async function fetchSpkState(
  bodyId: BodyId,
  julianDate: number,
): Promise<BodyState> {
  const states = await fetchAllSpkStates([bodyId], julianDate);
  const state = states[bodyId];
  if (!state) {
    throw new Error(`No ephemeris state for "${bodyId}" at JD ${julianDate}`);
  }
  return state;
}

/** ICRF/J2000 states for every requested body at one shared epoch. */
export async function fetchAllSpkStates(
  bodyIds: readonly BodyId[],
  julianDate: number,
): Promise<Partial<Record<BodyId, BodyState>>> {
  // Omit `ids` for large catalogs — a 90+ id query string can break proxies
  // and the server already returns the full catalog by default.
  const params = new URLSearchParams({ jd: String(julianDate) });
  if (bodyIds.length > 0 && bodyIds.length <= 20) {
    params.set("ids", bodyIds.join(","));
  }
  const response = await fetch(
    `${apiUrl("/api/ephemeris/states")}?${params.toString()}`,
  );
  if (!response.ok) {
    throw new Error(
      `Ephemeris API failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as StatesResponse;
  for (const id of payload.missing ?? []) {
    if (bodyIds.includes(id as BodyId)) {
      console.warn(`SPK state failed for ${id} (not in API response)`);
    }
  }
  const wanted = new Set(bodyIds);
  const states: Partial<Record<BodyId, BodyState>> = {};
  for (const [id, state] of Object.entries(payload.states ?? {})) {
    if (wanted.has(id as BodyId) && state) {
      states[id as BodyId] = state;
    }
  }
  return states;
}
