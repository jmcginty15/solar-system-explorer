import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  RepeatWrapping,
  ClampToEdgeWrapping,
  Vector3,
  type Object3D,
  type Scene,
  type Texture,
} from "three";
import {
  ATMOSPHERE_HEIGHT_M,
  BODIES,
  BODY_CATALOG,
  type BodyData,
  type BodyId,
  type BodyPositionM,
} from "../data";
import type { BodyState } from "../ephemeris";
import { heliocentricOrbitalPole } from "../ephemeris/orbitalPlane";
import { createBodySphereGeometry } from "./bodySphere";
import { createCometEffects, updateCometEffects } from "./createCometEffects";
import { createContactBinarySurface } from "./contactBinary";
import {
  createRingSystem,
  updateMeanEquatorRings,
  updateOrbitalPlaneRings,
  updatePoleAlignedRings,
} from "./createRings";
import { SUN_BLOOM_LAYER } from "./layers";
import { starColorHex, starGlowOpacities } from "./starEffects";
import { loadLinearTexture, loadSrgbTexture } from "./textures";
import {
  applyAnalyticalRingShadow,
  updateAnalyticalPlanetUmbraOnRings,
  updateAnalyticalRingShadow,
} from "./ringPlaneShadow";
import {
  bodyReceivesShadowMap,
  enableBodyShadows,
  mitigateTerminatorShadowAcne,
} from "./shadowDepth";
import { collectCullables, collectDisplacementStates } from "./visibility";

function softenGasGiantShading(material: MeshStandardMaterial, bodyId: string) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;",
      "float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.45 ) / 1.45 );\n\n\tvec3 irradiance = dotNL * directLight.color;",
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      /^[ \t]*#include <opaque_fragment>/m,
      /* glsl */ `
      float mu = abs(dot(normalize(normal), normalize(vViewPosition)));
      outgoingLight *= mix(0.5, 1.0, pow(clamp(mu, 0.0, 1.0), 0.55));
      #include <opaque_fragment>
      `,
    );
  };
  material.customProgramCacheKey = () => `${bodyId}-gas-soft`;
}

/**
 * Color map × specular mask → bright regions stay emissive,
 * dark spots are suppressed so they glow (and bloom) less.
 */
function createMaskedEmissiveMap(colorMap: Texture, specMap: Texture): Texture {
  const colorImage = colorMap.image as HTMLImageElement | ImageBitmap;
  const specImage = specMap.image as HTMLImageElement | ImageBitmap;
  const width = colorImage.width;
  const height = colorImage.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create masked emissive canvas");
  }

  ctx.drawImage(colorImage, 0, 0, width, height);
  const colorData = ctx.getImageData(0, 0, width, height);

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(specImage, 0, 0, width, height);
  const specData = ctx.getImageData(0, 0, width, height);

  for (let i = 0; i < colorData.data.length; i += 4) {
    const mask = specData.data[i]! / 255;
    colorData.data[i]! *= mask;
    colorData.data[i + 1]! *= mask;
    colorData.data[i + 2]! *= mask;
  }

  ctx.putImageData(colorData, 0, 0);
  const emissiveMap = new CanvasTexture(canvas);
  emissiveMap.colorSpace = SRGBColorSpace;
  return emissiveMap;
}

function rgbaFromHex(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createSoftGlowTexture(starColor: number): Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create soft glow canvas");
  }

  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, rgbaFromHex(starColor, 0.55));
  gradient.addColorStop(0.2, rgbaFromHex(starColor, 0.28));
  gradient.addColorStop(0.45, rgbaFromHex(starColor, 0.1));
  gradient.addColorStop(0.75, rgbaFromHex(starColor, 0.03));
  gradient.addColorStop(1, rgbaFromHex(starColor, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createGlowSprite(
  map: Texture,
  worldSize: number,
  opacity: number,
  color: number,
) {
  const material = new SpriteMaterial({
    map,
    color,
    opacity,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(worldSize, worldSize, 1);
  sprite.frustumCulled = false;
  sprite.layers.set(SUN_BLOOM_LAYER);
  return sprite;
}

/** Soft-glow sprite diameters as multiples of mean solar radius (full width). */
export const SUN_INNER_GLOW_DIAMETER_FACTOR = 3.2;
export const SUN_OUTER_GLOW_DIAMETER_FACTOR = 5.5;

/** Center→edge extent of the Sun's outer glow sprite. */
export function sunOuterGlowRadiusM(body: {
  radiusXM: number;
  radiusYM: number;
  radiusZM: number;
}): number {
  const meanRadius = (body.radiusXM + body.radiusYM + body.radiusZM) / 3;
  return (meanRadius * SUN_OUTER_GLOW_DIAMETER_FACTOR) / 2;
}

function surfaceSegmentCounts(body: BodyData): {
  widthSegments: number;
  heightSegments: number;
} {
  if (body.displacementMapUrl)
    return { widthSegments: 256, heightSegments: 128 };
  if (body.glowAndLight) return { widthSegments: 64, heightSegments: 32 };
  if (body.gasGiantEffects) return { widthSegments: 96, heightSegments: 48 };
  return { widthSegments: 96, heightSegments: 48 };
}

async function createSurfaceMesh(body: BodyData): Promise<Mesh | Group> {
  if (body.contactBinary) {
    const { widthSegments, heightSegments } = surfaceSegmentCounts(body);
    return createContactBinarySurface(body, { widthSegments, heightSegments });
  }

  const { widthSegments, heightSegments } = surfaceSegmentCounts(body);
  const geometry = createBodySphereGeometry(widthSegments, heightSegments);

  if (body.glowAndLight) {
    if (!body.textureMapUrl) {
      throw new Error(
        `Body "${body.id}" has glowAndLight but no textureMapUrl`,
      );
    }
    const colorMap = await loadSrgbTexture(body.textureMapUrl);

    // Prefer the specular-masked emissive atlas when present (Sun faculae /
    // darker spots); otherwise the color map is the photosphere itself.
    let photosphereMap: Texture = colorMap;
    if (body.specularMapUrl) {
      const specMap = await loadLinearTexture(body.specularMapUrl);
      photosphereMap = createMaskedEmissiveMap(colorMap, specMap);
      specMap.dispose();
      colorMap.dispose();
    }

    // Unlit photosphere: stars are self-luminous. MeshStandardMaterial still
    // responds to the scene DirectionalLight, which paints a hard terminator
    // on dim M dwarfs (low emissive vs bright planet-scaled insolation).
    const photosphere = new Mesh(
      geometry,
      new MeshBasicMaterial({
        map: photosphereMap,
        color: body.color ?? 0xffffff,
      }),
    );
    photosphere.name = `${body.id}-photosphere`;
    photosphere.scale.set(body.radiusXM, body.radiusYM, body.radiusZM);
    photosphere.layers.enable(SUN_BLOOM_LAYER);
    // Stars neither cast nor receive shadows.
    photosphere.castShadow = false;
    photosphere.receiveShadow = false;
    return photosphere;
  }

  const hasColorMap = Boolean(body.textureMapUrl);
  // Untextured catalog colors (exoplanet ice/gas giants) stay matte — any
  // residual metalness adds a white specular sheen that washes the tint.
  const materialParams: ConstructorParameters<typeof MeshPhysicalMaterial>[0] =
    {
      roughness: body.gasGiantEffects
        ? 0.95
        : body.specularMapUrl
          ? 0.7
          : hasColorMap
            ? 0.9
            : 0.97,
      metalness: body.gasGiantEffects
        ? 0
        : body.specularMapUrl
          ? 1
          : hasColorMap
            ? 0.05
            : 0,
    };

  if (body.albedo !== undefined) {
    // Dielectric F0; stacks with metalness / metalnessMap (oceans, etc.).
    materialParams.reflectivity = MathUtils.clamp(body.albedo, 0, 1);
    // Milder roughness so higher-albedo bodies read a bit shinier under the sun.
    materialParams.roughness =
      (materialParams.roughness ?? 1) * (1 - 0.25 * body.albedo);
  }

  if (body.color !== undefined) {
    materialParams.color = body.color;
  }

  if (body.textureMapUrl) {
    materialParams.map = await loadSrgbTexture(body.textureMapUrl);
  }

  if (body.displacementMapUrl) {
    const heightMap = await loadLinearTexture(body.displacementMapUrl);
    heightMap.wrapS = RepeatWrapping;
    heightMap.wrapT = ClampToEdgeWrapping;
    if (body.displacementMapOffset) {
      heightMap.offset.set(
        body.displacementMapOffset.x,
        body.displacementMapOffset.y,
      );
    }
    const elevationMin = body.elevationMinM ?? 0;
    const elevationMax = body.elevationMaxM ?? 0;
    materialParams.displacementMap = heightMap;
    materialParams.displacementBias = elevationMin / body.radiusXM;
    materialParams.displacementScale =
      (elevationMax - elevationMin) / body.radiusXM;
    materialParams.bumpMap = heightMap;
    materialParams.bumpScale = 1;
  }

  if (body.specularMapUrl) {
    materialParams.metalnessMap = await loadLinearTexture(body.specularMapUrl);
  }

  const material = new MeshPhysicalMaterial(materialParams);
  if (!hasColorMap || body.gasGiantEffects) {
    // Flat catalog tints / banded gas shading: kill dielectric specular so the
    // directional star light doesn't bleach the base color to white.
    material.specularIntensity = 0.15;
  }
  if (body.gasGiantEffects) softenGasGiantShading(material, body.id);
  const ringShadow = await applyAnalyticalRingShadow(material, body);
  const receiveShadow = bodyReceivesShadowMap(body) && !ringShadow;
  if (receiveShadow) mitigateTerminatorShadowAcne(material);

  const mesh = new Mesh(geometry, material);
  mesh.name = body.id;
  mesh.scale.set(body.radiusXM, body.radiusYM, body.radiusZM);
  // Ringed globes skip shadow-map receive (open rings black out the disk).
  // Others cast + receive; terminator acne is shader-faded (not cast/receive).
  enableBodyShadows(mesh, { receiveShadow });
  if (ringShadow) mesh.userData.ringShadow = ringShadow;
  return mesh;
}

async function createAtmosphereMesh(body: BodyData): Promise<Mesh | null> {
  if (!body.atmosphere) return null;

  const colorMap = await loadSrgbTexture(body.atmosphere.textureMapUrl);
  const alphaMap = await loadLinearTexture(body.atmosphere.alphaMapUrl);

  const atmosphere = new Mesh(
    createBodySphereGeometry(64, 32),
    new MeshStandardMaterial({
      map: colorMap,
      alphaMap,
      transparent: true,
      depthWrite: false,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  atmosphere.name = `${body.id}-atmosphere`;
  atmosphere.scale.set(
    body.radiusXM + ATMOSPHERE_HEIGHT_M,
    body.radiusYM + ATMOSPHERE_HEIGHT_M,
    body.radiusZM + ATMOSPHERE_HEIGHT_M,
  );
  return atmosphere;
}

function createBloomOccluder(body: BodyData, surface: Mesh | Group): Object3D {
  if (surface instanceof Group) {
    const occluderGroup = new Group();
    occluderGroup.name = `${body.id}-bloom-occluder`;
    for (const child of surface.children) {
      if (!(child instanceof Mesh)) continue;
      const occluder = new Mesh(
        child.geometry,
        new MeshBasicMaterial({ color: 0x000000 }),
      );
      occluder.name = `${child.name}-bloom-occluder`;
      occluder.position.copy(child.position);
      occluder.scale.copy(child.scale);
      occluder.quaternion.copy(child.quaternion);
      occluder.layers.set(SUN_BLOOM_LAYER);
      occluder.renderOrder = -1;
      occluderGroup.add(occluder);
    }
    return occluderGroup;
  }

  const occluder = new Mesh(
    surface.geometry.clone(),
    new MeshBasicMaterial({ color: 0x000000 }),
  );
  occluder.name = `${body.id}-bloom-occluder`;
  occluder.scale.copy(surface.scale);
  occluder.quaternion.copy(surface.quaternion);
  occluder.layers.set(SUN_BLOOM_LAYER);
  occluder.renderOrder = -1;
  return occluder;
}

/**
 * Atmosphere spin rate as a fraction of the solid-body prime-meridian rate.
 * Local counter-rotation makes clouds drift slowly across the surface.
 */
const ATMOSPHERE_SPIN_FRACTION = 0.85;

/**
 * Set a body group's invariable-frame orientation and keep any
 * `alignToOrbitalPlane` rings (e.g. Phoebe) coplanar with the body's
 * heliocentric orbital plane when `orbitalPoleWorld` is provided.
 *
 * Rings marked `alignToMeanEquator` stay fixed to the mean IAU equator
 * (cancelling prime-meridian spin) when `atmospherePrimeMeridianDeg` is set.
 * Rings with catalog ICRF poles stay inertially fixed to those poles.
 *
 * When `atmospherePrimeMeridianDeg` is set, the atmosphere shell lags the
 * body's spin so it appears to move relative to the surface.
 *
 * When `sunPositionM` is set, comet tails are aimed anti-sunward.
 */
export function setBodyOrientation(
  bodyGroup: Group,
  orientation: Quaternion,
  options: {
    atmospherePrimeMeridianDeg?: number;
    /** Heliocentric orbital pole in the invariable frame. */
    orbitalPoleWorld?: Vector3;
    sunPositionM?: BodyPositionM;
    velocityMS?: BodyPositionM;
  } = {},
): void {
  bodyGroup.quaternion.copy(orientation);
  const rings = bodyGroup.getObjectByName(`${bodyGroup.name}-rings`);
  if (rings instanceof Group) {
    if (options.orbitalPoleWorld) {
      updateOrbitalPlaneRings(rings, orientation, options.orbitalPoleWorld);
    }
    if (options.atmospherePrimeMeridianDeg !== undefined) {
      updateMeanEquatorRings(rings, options.atmospherePrimeMeridianDeg);
    }
    updatePoleAlignedRings(rings, orientation);
  }

  const atmosphere = bodyGroup.getObjectByName(`${bodyGroup.name}-atmosphere`);
  if (atmosphere && options.atmospherePrimeMeridianDeg !== undefined) {
    const lagFraction = 1 - ATMOSPHERE_SPIN_FRACTION;
    atmosphere.rotation.z = MathUtils.degToRad(
      -lagFraction * options.atmospherePrimeMeridianDeg,
    );
  }

  if (options.sunPositionM) {
    const bodyPositionM = {
      x: bodyGroup.position.x,
      y: bodyGroup.position.y,
      z: bodyGroup.position.z,
    };
    updateAnalyticalRingShadow(
      bodyGroup,
      orientation,
      bodyPositionM,
      options.sunPositionM,
    );
    if (rings instanceof Group) {
      updateAnalyticalPlanetUmbraOnRings(
        rings,
        orientation,
        bodyPositionM,
        options.sunPositionM,
      );
    }
    updateCometEffects(
      bodyGroup,
      orientation,
      bodyPositionM,
      options.sunPositionM,
      options.velocityMS,
    );
  }
}

function fallbackOrientation(_body: BodyData): Quaternion {
  return new Quaternion();
}

export type CreateBodyOptions = {
  /** Invariable-frame ephemeris state (required for placement). */
  state: BodyState;
  /** Invariable-frame orientation; falls back to identity. */
  orientation?: Quaternion;
  /** Sun position in invariable frame (for ring lighting). */
  sunPositionM: BodyPositionM;
  /** IAU W (deg) for atmosphere spin lag relative to the surface. */
  atmospherePrimeMeridianDeg?: number;
  /** Heliocentric orbital pole in invariable frame (orbital-plane rings). */
  orbitalPoleWorld?: Vector3;
};

/**
 * Build a complete body group from catalog data: surface, optional atmosphere,
 * rings, bloom occluder, comet effects, and (for glowAndLight) soft glow sprites.
 * Scene sunlight is a shared DirectionalLight (see `sunLight.ts`), not per-body.
 */
export async function createBody(
  bodyId: BodyId,
  options: CreateBodyOptions,
): Promise<Group> {
  const body = BODIES[bodyId];
  const position = options.state.positionM;
  const { sunPositionM } = options;
  const group = new Group();
  group.name = body.id;

  const surface = await createSurfaceMesh(body);
  group.add(surface);

  const atmosphere = await createAtmosphereMesh(body);
  if (atmosphere) group.add(atmosphere);

  const orientation = options.orientation ?? fallbackOrientation(body);

  const rings = await createRingSystem(
    body,
    position,
    sunPositionM,
    orientation,
    options.orbitalPoleWorld,
    options.atmospherePrimeMeridianDeg ?? 0,
  );
  if (rings) group.add(rings);

  const comet = createCometEffects(body);
  if (comet) group.add(comet);

  if (!body.glowAndLight) {
    group.add(createBloomOccluder(body, surface));
  } else {
    const meanRadius = (body.radiusXM + body.radiusYM + body.radiusZM) / 3;
    const tint = starColorHex(body);
    const opacities = starGlowOpacities(body);
    const glowMap = createSoftGlowTexture(tint);
    // Texture already carries the star tint; keep sprite color white.
    const innerGlow = createGlowSprite(
      glowMap,
      meanRadius * SUN_INNER_GLOW_DIAMETER_FACTOR,
      opacities.inner,
      0xffffff,
    );
    innerGlow.name = `${body.id}-glow-inner`;
    group.add(innerGlow);
    const outerGlow = createGlowSprite(
      glowMap,
      meanRadius * SUN_OUTER_GLOW_DIAMETER_FACTOR,
      opacities.outer,
      0xffffff,
    );
    outerGlow.name = `${body.id}-glow-outer`;
    group.add(outerGlow);
  }

  group.position.set(position.x, position.y, position.z);
  group.userData.state = options.state;
  group.userData.cullables = collectCullables(group);
  group.userData.displacementStates = collectDisplacementStates(group);
  setBodyOrientation(group, orientation, {
    atmospherePrimeMeridianDeg: options.atmospherePrimeMeridianDeg,
    orbitalPoleWorld: options.orbitalPoleWorld,
    sunPositionM,
    velocityMS: options.state.velocityMS,
  });
  return group;
}

/** Add one catalog body (and its accessories) to the scene. */
export async function addBody(
  scene: Scene,
  bodyId: BodyId,
  options: CreateBodyOptions,
): Promise<Group> {
  const group = await createBody(bodyId, options);
  scene.add(group);
  return group;
}

export type AddAllBodiesOptions = {
  /** Per-body invariable ephemeris states (bodies without a state are skipped). */
  states: Partial<Record<BodyId, BodyState>>;
  /** Per-body invariable orientations (missing entries use identity). */
  orientations?: Partial<Record<BodyId, Quaternion>>;
  /** Per-body IAU W (deg) for atmosphere lag. */
  atmospherePrimeMeridianDeg?: Partial<Record<BodyId, number>>;
  /** Defaults to the Sun's ephemeris position when present. */
  sunPositionM?: BodyPositionM;
};

/** Locate the primary star state among loaded ephemeris states. */
function primaryStarStateFrom(
  states: Partial<Record<BodyId, BodyState>>,
): { id: BodyId; state: BodyState } | null {
  for (const body of BODY_CATALOG) {
    if (!body.glowAndLight && body.type !== "star") continue;
    const bodyId = body.id as BodyId;
    const state = states[bodyId];
    if (state) return { id: bodyId, state };
  }
  return null;
}

/** Add every catalog body that has an ephemeris state to the scene. */
export async function addAllBodies(
  scene: Scene,
  options: AddAllBodiesOptions,
): Promise<Group[]> {
  const primary = primaryStarStateFrom(options.states);
  const sunPositionM =
    options.sunPositionM ??
    primary?.state.positionM ??
    options.states.sun?.positionM;
  if (!sunPositionM) {
    throw new Error("addAllBodies requires the primary star's position");
  }
  const sunState = primary?.state ?? options.states.sun;

  const groups: Group[] = [];
  for (const body of BODY_CATALOG) {
    const bodyId = body.id as BodyId;
    const state = options.states[bodyId];
    if (!state) {
      // Bodies outside the active stellar system (or missing SPK) are omitted.
      continue;
    }
    const orbitalPoleWorld =
      sunState && body.rings?.rings.some((ring) => ring.alignToOrbitalPlane)
        ? heliocentricOrbitalPole(state, sunState)
        : undefined;
    groups.push(
      await addBody(scene, bodyId, {
        state,
        orientation: options.orientations?.[bodyId],
        atmospherePrimeMeridianDeg:
          options.atmospherePrimeMeridianDeg?.[bodyId],
        sunPositionM,
        orbitalPoleWorld,
      }),
    );
  }
  return groups;
}
