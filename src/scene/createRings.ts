import {
  Color,
  DoubleSide,
  FrontSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type {
  BodyData,
  BodyPositionM,
  RingData,
  RingSystemData,
} from "../data";
import { iauBodyAxesIcrf } from "../ephemeris/iauOrientation";
import { ICRF_TO_INVARIABLE } from "../ephemeris/invariableFrame";
import {
  applyAnalyticalPlanetUmbraOnRing,
  createRingPlanetUmbraState,
  type RingPlanetUmbraState,
} from "./ringPlaneShadow";
import { createRoundedWasherGeometry } from "./roundedWasher";
import { createRingShadowDepthMaterial } from "./shadowDepth";
import { loadLinearTexture } from "./textures";

const BODY_NORTH = new Vector3(0, 0, 1);
const BODY_X = new Vector3(1, 0, 0);
const _meanEquatorRz = new Quaternion();
const _meanEquatorRx = new Quaternion();
const _ringBasis = new Matrix4();
const _ringX = new Vector3();
const _ringY = new Vector3();
const _ringZ = new Vector3();

type RingFaceStyle = {
  color: number;
  emissive: number;
  emissiveIntensity: number;
  opacity: number;
};

/** Half-width of n·sun for lit↔unlit crossfade (~13°). */
const SUN_FACE_FADE = 0.22;

/**
 * Orient a ring group so its plane matches a world-frame orbital pole,
 * given the current body→invariable orientation.
 *
 * Call again whenever the parent body moves (orbit) or spins.
 */
export function setRingAlignedToOrbitalPlane(
  ringGroup: Group,
  bodyOrientation: Quaternion,
  orbitalPoleWorld: Vector3,
): void {
  if (orbitalPoleWorld.lengthSq() < 1e-12) {
    ringGroup.quaternion.identity();
    return;
  }

  const poleLocal = orbitalPoleWorld
    .clone()
    .normalize()
    .applyQuaternion(bodyOrientation.clone().invert());
  if (poleLocal.lengthSq() < 1e-12) {
    ringGroup.quaternion.identity();
    return;
  }
  poleLocal.normalize();
  // Keep the ring normal in the same hemisphere as body north to avoid flips.
  if (poleLocal.dot(BODY_NORTH) < 0) {
    poleLocal.negate();
  }
  ringGroup.quaternion.setFromUnitVectors(BODY_NORTH, poleLocal);
}

/**
 * Ring local orientation: cancel body spin W, then tilt by `inclinationDeg`
 * about mean-equatorial +X (IAU node Q). World plane = mean equator + tilt.
 */
export function setRingAlignedToMeanEquator(
  ringGroup: Group,
  primeMeridianDeg: number,
  inclinationDeg: number,
): void {
  _meanEquatorRx.setFromAxisAngle(BODY_X, MathUtils.degToRad(inclinationDeg));
  _meanEquatorRz.setFromAxisAngle(
    BODY_NORTH,
    MathUtils.degToRad(-primeMeridianDeg),
  );
  ringGroup.quaternion.copy(_meanEquatorRz).multiply(_meanEquatorRx);
}

/**
 * Full inertial ring frame from catalog ICRF α₀, δ₀ with W = 0 (node Q as +X).
 * Fixes the eccentricity periapsis in inertial space so body spin cannot
 * precess the offset.
 */
export function ringFrameInvariableQuaternion(
  northPoleRaDeg: number,
  northPoleDecDeg: number,
): Quaternion {
  const axes = iauBodyAxesIcrf(northPoleRaDeg, northPoleDecDeg, 0);
  _ringX.copy(axes.x).applyMatrix3(ICRF_TO_INVARIABLE).normalize();
  _ringY.copy(axes.y).applyMatrix3(ICRF_TO_INVARIABLE).normalize();
  _ringZ.copy(axes.z).applyMatrix3(ICRF_TO_INVARIABLE).normalize();
  _ringBasis.makeBasis(_ringX, _ringY, _ringZ);
  return new Quaternion().setFromRotationMatrix(_ringBasis);
}

/**
 * Local ring orientation so `bodyOrientation * local = ringWorldOrientation`
 * (inertial pole + node; cancels host spin including eccentric periapsis).
 */
export function setRingAlignedToInertialFrame(
  ringGroup: Group,
  bodyOrientation: Quaternion,
  ringWorldOrientation: Quaternion,
): void {
  ringGroup.quaternion
    .copy(bodyOrientation)
    .invert()
    .multiply(ringWorldOrientation);
}

/**
 * Recompute every ring under `ringsRoot` marked with `alignToOrbitalPlane`
 * for the current body orientation and orbital pole.
 */
export function updateOrbitalPlaneRings(
  ringsRoot: Group,
  bodyOrientation: Quaternion,
  orbitalPoleWorld: Vector3,
): void {
  for (const child of ringsRoot.children) {
    if (!(child instanceof Group)) continue;
    const { alignToOrbitalPlane } = child.userData as {
      alignToOrbitalPlane?: boolean;
    };
    if (!alignToOrbitalPlane) continue;
    setRingAlignedToOrbitalPlane(child, bodyOrientation, orbitalPoleWorld);
  }
}

/**
 * Recompute every ring under `ringsRoot` marked with `alignToMeanEquator`
 * so the ring plane stays fixed to the mean IAU equator + catalog tilt.
 */
export function updateMeanEquatorRings(
  ringsRoot: Group,
  primeMeridianDeg: number,
): void {
  for (const child of ringsRoot.children) {
    if (!(child instanceof Group)) continue;
    const { alignToMeanEquator, inclinationDeg } = child.userData as {
      alignToMeanEquator?: boolean;
      inclinationDeg?: number;
    };
    if (!alignToMeanEquator) continue;
    setRingAlignedToMeanEquator(child, primeMeridianDeg, inclinationDeg ?? 0);
  }
}

/**
 * Recompute rings with catalog ICRF poles so plane and periapsis stay
 * inertially fixed (no spin-locked eccentricity wobble).
 */
export function updatePoleAlignedRings(
  ringsRoot: Group,
  bodyOrientation: Quaternion,
): void {
  for (const child of ringsRoot.children) {
    if (!(child instanceof Group)) continue;
    const { ringWorldOrientation } = child.userData as {
      ringWorldOrientation?: Quaternion;
    };
    if (!ringWorldOrientation) continue;
    setRingAlignedToInertialFrame(child, bodyOrientation, ringWorldOrientation);
  }
}

function softenHaloEdges(material: MeshStandardMaterial) {
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      /* glsl */ `
      float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
      gl_FragColor.a *= smoothstep(0.0, 0.65, facing);
      #include <dithering_fragment>
      `,
    );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `ring-torus-soft-edge|${previousKey.call(material)}`;
}

function splitWasherGeometryByFace(geometry: BufferGeometry): {
  top: BufferGeometry;
  bottom: BufferGeometry;
} {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const index = geometry.index;
  if (!position || !normal || !index) {
    return { top: geometry, bottom: geometry };
  }

  const topIndices: number[] = [];
  const bottomIndices: number[] = [];

  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const nz = (normal.getZ(a) + normal.getZ(b) + normal.getZ(c)) / 3;
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const isTop = Math.abs(nz) > 0.2 ? nz > 0 : z >= 0;
    (isTop ? topIndices : bottomIndices).push(a, b, c);
  }

  const top = geometry.clone();
  top.setIndex(topIndices);
  const bottom = geometry.clone();
  bottom.setIndex(bottomIndices);
  geometry.dispose();
  return { top, bottom };
}

async function loadRingTexture(url: string): Promise<Texture> {
  return loadLinearTexture(url);
}

function textureUForRadius(
  radiusM: number,
  system: RingSystemData,
  ring: RingData,
): number {
  if (
    ring.textureUInner !== undefined &&
    ring.textureUOuter !== undefined &&
    ring.outerRadiusM !== ring.innerRadiusM
  ) {
    const t =
      (radiusM - ring.innerRadiusM) / (ring.outerRadiusM - ring.innerRadiusM);
    return MathUtils.clamp(
      ring.textureUInner + (ring.textureUOuter - ring.textureUInner) * t,
      0,
      1,
    );
  }
  if (
    ring.textureUInner !== undefined &&
    ring.textureUOuter !== undefined &&
    ring.outerRadiusM === ring.innerRadiusM
  ) {
    return ring.textureUInner;
  }
  const r0 = system.textureRadiusAtU0M;
  const r1 = system.textureRadiusAtU1M;
  if (r0 === undefined || r1 === undefined || r1 === r0) return 0;
  return MathUtils.clamp((radiusM - r0) / (r1 - r0), 0, 1);
}

function applyRingTextureUVs(
  geometry: BufferGeometry,
  system: RingSystemData,
  ring: RingData,
) {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!position || !uv) return;

  for (let i = 0; i < position.count; i++) {
    const radiusM = Math.hypot(position.getX(i), position.getY(i));
    uv.setXY(i, textureUForRadius(radiusM, system, ring), 0.5);
  }
  uv.needsUpdate = true;
}

function enableRingMeshShadows(
  mesh: Mesh,
  opacity: number,
  map: Texture | undefined,
): void {
  mesh.castShadow = true;
  // Opaque washers self-shadow to solid black in the map; planet umbra is
  // applied analytically instead (see applyAnalyticalPlanetUmbraOnRing).
  mesh.receiveShadow = false;
  // AU-scale frustum tests falsely cull thin rings from the shadow camera.
  mesh.frustumCulled = false;
  // Thin washers must cast from both sides; force DoubleSide on the shadow mat.
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  for (const material of materials) {
    if (material && typeof material === "object" && "shadowSide" in material) {
      (material as Material & { shadowSide: number | null }).shadowSide =
        DoubleSide;
    }
  }
  mesh.customDepthMaterial = createRingShadowDepthMaterial(opacity, map);
}

function ringFaceStyles(
  system: RingSystemData,
  ring: RingData,
  textured: boolean,
): { lit: RingFaceStyle; unlit: RingFaceStyle } {
  const litColor = ring.color ?? system.color;
  const unlitColor = ring.unlitColor ?? system.unlitColor;
  return {
    lit: {
      color: litColor,
      emissive: textured ? litColor : 0x000000,
      emissiveIntensity: textured ? system.litEmissiveIntensity : 0,
      opacity: ring.opacity,
    },
    unlit: {
      color: unlitColor,
      emissive: textured ? unlitColor : 0x000000,
      emissiveIntensity: textured ? system.unlitEmissiveIntensity : 0,
      opacity: ring.opacity * system.unlitOpacityScale,
    },
  };
}

/**
 * Per-fragment lit/unlit blend from face normal · sun (both faces share the
 * same base material so neither side stays permanently brighter).
 * Requires {@link applyAnalyticalPlanetUmbraOnRing} first (world normal + sun).
 */
function applyRingSunFaceContrast(
  material: MeshStandardMaterial,
  lit: RingFaceStyle,
  unlit: RingFaceStyle,
): void {
  const faceUniforms = {
    uRingFaceLitColor: { value: new Color(lit.color) },
    uRingFaceUnlitColor: { value: new Color(unlit.color) },
    uRingFaceLitEm: { value: new Color(lit.emissive) },
    uRingFaceUnlitEm: { value: new Color(unlit.emissive) },
    uRingFaceLitEmInt: { value: lit.emissiveIntensity },
    uRingFaceUnlitEmInt: { value: unlit.emissiveIntensity },
    uRingFaceLitOpacity: { value: lit.opacity },
    uRingFaceUnlitOpacity: { value: unlit.opacity },
  };

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer,
  ) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, faceUniforms);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uRingFaceLitColor;
        uniform vec3 uRingFaceUnlitColor;
        uniform vec3 uRingFaceLitEm;
        uniform vec3 uRingFaceUnlitEm;
        uniform float uRingFaceLitEmInt;
        uniform float uRingFaceUnlitEmInt;
        uniform float uRingFaceLitOpacity;
        uniform float uRingFaceUnlitOpacity;
        `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        {
          float faceLit = smoothstep(
            0.0,
            ${SUN_FACE_FADE.toFixed(3)},
            max( 0.0, dot( normalize( vRingWorldNormal ), normalize( uRingSunDirWorld ) ) )
          );
          vec3 faceTint = mix( uRingFaceUnlitColor, uRingFaceLitColor, faceLit );
          diffuseColor.rgb *= faceTint / max( uRingFaceLitColor, vec3( 1e-4 ) );
          diffuseColor.a = mix( uRingFaceUnlitOpacity, uRingFaceLitOpacity, faceLit );
        }
        `,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `
        #include <emissivemap_fragment>
        {
          float faceLit = smoothstep(
            0.0,
            ${SUN_FACE_FADE.toFixed(3)},
            max( 0.0, dot( normalize( vRingWorldNormal ), normalize( uRingSunDirWorld ) ) )
          );
          float emScale = mix( uRingFaceUnlitEmInt, uRingFaceLitEmInt, faceLit )
            / max( uRingFaceLitEmInt, 1e-4 );
          vec3 emTint = mix( uRingFaceUnlitEm, uRingFaceLitEm, faceLit )
            / max( uRingFaceLitEm, vec3( 1e-4 ) );
          totalEmissiveRadiance *= emScale * emTint;
        }
        `,
      );
  };

  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `ring-sun-face|${previousKey.call(material)}`;
}

function createRingMaterial(
  system: RingSystemData,
  ring: RingData,
  map: Texture | undefined,
  planetUmbra: RingPlanetUmbraState | null,
  options: { sunFaceContrast?: boolean } = {},
): MeshStandardMaterial {
  const textured = Boolean(map);
  const styles = ringFaceStyles(system, ring, textured);
  // Always start from lit; sun-face contrast darkens the anti-sun face in-shader.
  const style = styles.lit;
  // Washers use split FrontSide faces; tori stay DoubleSide (no meaningful "faces").
  const sunFace = options.sunFaceContrast ?? system.sunFaceContrast;

  const material = new MeshStandardMaterial({
    map: map ?? null,
    emissiveMap: map ?? null,
    emissive: new Color(style.emissive),
    emissiveIntensity: style.emissiveIntensity,
    color: style.color,
    transparent: true,
    opacity: style.opacity,
    depthWrite: false,
    side: sunFace ? FrontSide : DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  if (planetUmbra) applyAnalyticalPlanetUmbraOnRing(material, planetUmbra);
  if (sunFace && planetUmbra) {
    applyRingSunFaceContrast(material, styles.lit, styles.unlit);
  }
  return material;
}

function createTorusRing(
  ring: RingData,
  system: RingSystemData,
  planetUmbra: RingPlanetUmbraState | null,
): Group {
  const tubeRadius = (ring.outerRadiusM - ring.innerRadiusM) / 2;
  const majorRadius = (ring.innerRadiusM + ring.outerRadiusM) / 2;
  const color = ring.color ?? system.color;

  const group = new Group();
  group.name = ring.id;

  const coreMaterial = createRingMaterial(
    system,
    ring,
    undefined,
    planetUmbra,
    { sunFaceContrast: false },
  );
  coreMaterial.color.setHex(color);
  softenHaloEdges(coreMaterial);
  const core = new Mesh(
    new TorusGeometry(majorRadius, tubeRadius, 32, 128),
    coreMaterial,
  );
  core.name = `${ring.id}-core`;
  enableRingMeshShadows(core, ring.opacity, undefined);

  const softOpacity = ring.opacity * 0.45;
  const softRing: RingData = { ...ring, opacity: softOpacity };
  const softMaterial = createRingMaterial(
    system,
    softRing,
    undefined,
    planetUmbra,
    { sunFaceContrast: false },
  );
  softMaterial.color.setHex(color);
  softenHaloEdges(softMaterial);
  const soft = new Mesh(
    new TorusGeometry(majorRadius, tubeRadius * 1.12, 32, 128),
    softMaterial,
  );
  soft.name = `${ring.id}-soft`;
  enableRingMeshShadows(soft, softOpacity, undefined);

  group.add(core, soft);
  return group;
}

function createWasherRing(
  ring: RingData,
  system: RingSystemData,
  ringTexture: Texture | undefined,
  bodyOrientation: Quaternion,
  planetUmbra: RingPlanetUmbraState | null,
  orbitalPoleWorld?: Vector3,
  primeMeridianDeg = 0,
): Group {
  const map = ring.textured ? ringTexture : undefined;
  const geometry = createRoundedWasherGeometry(
    ring.innerRadiusM,
    ring.outerRadiusM,
    ring.thicknessM,
  );
  if (map) applyRingTextureUVs(geometry, system, ring);

  // Orientation lives on `group`; eccentricity on a child so the periapsis
  // offset is in ring-plane axes (Three.js translation is parent-space).
  const group = new Group();
  group.name = ring.id;
  const content = new Group();
  content.name = `${ring.id}-content`;
  group.add(content);

  if (ring.alignToOrbitalPlane) {
    group.userData.alignToOrbitalPlane = true;
    if (orbitalPoleWorld) {
      setRingAlignedToOrbitalPlane(group, bodyOrientation, orbitalPoleWorld);
    }
  } else if (
    ring.northPoleRaDeg !== undefined &&
    ring.northPoleDecDeg !== undefined
  ) {
    const ringWorldOrientation = ringFrameInvariableQuaternion(
      ring.northPoleRaDeg,
      ring.northPoleDecDeg,
    );
    group.userData.ringWorldOrientation = ringWorldOrientation;
    setRingAlignedToInertialFrame(group, bodyOrientation, ringWorldOrientation);
  } else if (ring.alignToMeanEquator) {
    group.userData.alignToMeanEquator = true;
    group.userData.inclinationDeg = ring.inclinationDeg;
    setRingAlignedToMeanEquator(group, primeMeridianDeg, ring.inclinationDeg);
  } else if (ring.inclinationDeg !== 0) {
    group.rotation.x = MathUtils.degToRad(ring.inclinationDeg);
  }

  if (system.sunFaceContrast) {
    const { top, bottom } = splitWasherGeometryByFace(geometry);
    const topMesh = new Mesh(
      top,
      createRingMaterial(system, ring, map, planetUmbra),
    );
    topMesh.name = `${ring.id}-top`;
    enableRingMeshShadows(topMesh, ring.opacity, map);
    const bottomMesh = new Mesh(
      bottom,
      createRingMaterial(system, ring, map, planetUmbra),
    );
    bottomMesh.name = `${ring.id}-bottom`;
    enableRingMeshShadows(bottomMesh, ring.opacity, map);
    content.add(topMesh, bottomMesh);
  } else {
    const mesh = new Mesh(
      geometry,
      createRingMaterial(system, ring, map, planetUmbra),
    );
    mesh.name = ring.id;
    enableRingMeshShadows(mesh, ring.opacity, map);
    content.add(mesh);
  }

  if (ring.eccentricity > 0) {
    const semiMajorM = (ring.innerRadiusM + ring.outerRadiusM) / 2;
    content.position.x = semiMajorM * ring.eccentricity;
    content.scale.y = Math.sqrt(1 - ring.eccentricity * ring.eccentricity);
  }

  return group;
}

/** Build a body's ring system in its equatorial XY plane. */
export async function createRingSystem(
  body: BodyData,
  position: BodyPositionM,
  sunPosition: BodyPositionM = { x: 0, y: 0, z: 0 },
  bodyOrientation: Quaternion = new Quaternion(),
  orbitalPoleWorld?: Vector3,
  primeMeridianDeg = 0,
): Promise<Group | null> {
  const system = body.rings;
  if (!system) return null;

  const rings = new Group();
  rings.name = `${body.id}-rings`;
  const planetUmbra = createRingPlanetUmbraState(body);
  rings.userData.planetUmbra = planetUmbra;

  const ringTexture = system.textureMapUrl
    ? await loadRingTexture(system.textureMapUrl)
    : undefined;

  // Keep signature stable; sun direction for face lighting is updated each
  // frame via planetUmbra uniforms (see updateAnalyticalPlanetUmbraOnRings).
  void position;
  void sunPosition;

  for (const ring of system.rings) {
    if (ring.shape === "torus") {
      rings.add(createTorusRing(ring, system, planetUmbra));
    } else {
      rings.add(
        createWasherRing(
          ring,
          system,
          ringTexture,
          bodyOrientation,
          planetUmbra,
          orbitalPoleWorld,
          primeMeridianDeg,
        ),
      );
    }
  }

  return rings;
}
