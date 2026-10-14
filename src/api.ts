/**
 * Base URL for the Solar System Explorer API.
 * Empty string → same-origin (Vite proxies `/api` in dev).
 */
export function apiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (!raw) return "";
  return raw.replace(/\/$/, "");
}

/** Absolute or same-origin URL for an API path (must start with `/`). */
export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
