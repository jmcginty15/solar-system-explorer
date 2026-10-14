import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type ColorSpace,
  type Object3D,
  type Texture,
  type WebGLRenderer,
  Mesh,
  Sprite,
} from "three";

const loader = new TextureLoader();

export type LoadTextureOptions = {
  colorSpace?: ColorSpace;
  wrapS?: typeof RepeatWrapping | typeof ClampToEdgeWrapping;
  wrapT?: typeof RepeatWrapping | typeof ClampToEdgeWrapping;
  /** Max anisotropy after upload (default 4). */
  anisotropy?: number;
};

/** Decode a texture URL and apply common sampling defaults. */
export async function loadTexture(
  url: string,
  options: LoadTextureOptions = {},
): Promise<Texture> {
  const texture = await loader.loadAsync(url);
  texture.colorSpace = options.colorSpace ?? SRGBColorSpace;
  texture.wrapS = options.wrapS ?? ClampToEdgeWrapping;
  texture.wrapT = options.wrapT ?? ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = options.anisotropy ?? 4;
  texture.needsUpdate = true;
  return texture;
}

export async function loadSrgbTexture(url: string): Promise<Texture> {
  return loadTexture(url, { colorSpace: SRGBColorSpace });
}

export async function loadLinearTexture(url: string): Promise<Texture> {
  return loadTexture(url, { colorSpace: NoColorSpace });
}

/** Collect unique textures referenced by mesh/sprite materials under `root`. */
export function collectTextures(root: Object3D): Texture[] {
  const seen = new Set<Texture>();
  const out: Texture[] = [];

  const add = (texture: Texture | null | undefined) => {
    if (!texture || seen.has(texture)) return;
    seen.add(texture);
    out.push(texture);
  };

  root.traverse((object) => {
    if (object instanceof Mesh || object instanceof Sprite) {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!material || typeof material !== "object") continue;
        const record = material as Record<string, unknown>;
        for (const key of [
          "map",
          "alphaMap",
          "aoMap",
          "bumpMap",
          "displacementMap",
          "emissiveMap",
          "metalnessMap",
          "normalMap",
          "roughnessMap",
          "specularMap",
        ]) {
          add(record[key] as Texture | undefined);
        }
      }
    }
  });

  return out;
}

/** Force GPU upload now so first on-screen draw does not hitch. */
export function initTextures(
  renderer: WebGLRenderer,
  textures: readonly Texture[],
): void {
  for (const texture of textures) {
    renderer.initTexture(texture);
  }
}
