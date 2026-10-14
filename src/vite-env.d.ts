/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the ephemeris API (empty = same-origin / Vite proxy). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.exr" {
  const src: string;
  export default src;
}

declare module "*.exr?url" {
  const src: string;
  export default src;
}
