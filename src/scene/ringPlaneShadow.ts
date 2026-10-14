import {
  Group,
  Matrix3,
  Matrix4,
  Quaternion,
  Vector2,
  Vector3,
  type Mesh,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type { BodyData, BodyPositionM, RingData } from "../data";
import { loadLinearTexture } from "./textures";

/** Enough for Uranus (18 washers) and headroom for future systems. */
const MAX_RING_BANDS = 24;

const BODY_NORTH = new Vector3(0, 0, 1);

type RingShadowUniforms = {
  uRingSunDirLocal: { value: Vector3 };
  uRingBandCount: { value: number };
  uRingInner: { value: Float32Array };
  uRingOuter: { value: Float32Array };
  uRingOpacity: { value: Float32Array };
  uRingBandTextured: { value: Float32Array };
  uRingTexUInner: { value: Float32Array };
  uRingTexUOuter: { value: Float32Array };
  uRingPlaneNormal: { value: Vector3[] };
  uRingRadiusScale: { value: Vector3 };
  uRingOpacityMap: { value: Texture | null };
  uRingTexRadius: { value: Vector2 };
  uRingHasOpacityMap: { value: number };
};

export type RingShadowState = {
  uniforms: RingShadowUniforms;
  /** Washer band ids (same order as uniform arrays) for plane updates. */
  bandIds: string[];
};

/** Shared uniforms: planet disk umbra on ring meshes (no shadow-map receive). */
type RingPlanetUmbraUniforms = {
  uRingPlanetCenter: { value: Vector3 };
  uRingSunDirWorld: { value: Vector3 };
  uRingInvBodyMatrix: { value: Matrix3 };
  uRingPlanetRadii: { value: Vector3 };
  /** Soft limb width in unit-sphere radii (gas giants); 0 = hard edge. */
  uRingUmbraSoftness: { value: number };
};

export type RingPlanetUmbraState = {
  uniforms: RingPlanetUmbraUniforms;
};

/** Penumbra width as a fraction of planetary radius (gas-giant atmospheres). */
const GAS_GIANT_RING_UMBRA_SOFTNESS = 0.04;

const _sunDir = new Vector3();
const _invOrient = new Quaternion();
const _invMatrix4 = new Matrix4();
const _ringNormal = new Vector3();

function washerBands(body: BodyData): RingData[] {
  const rings = body.rings?.rings;
  if (!rings?.length) return [];
  return rings
    .filter(
      (ring) =>
        ring.shape === "washer" &&
        ring.opacity > 0.02 &&
        ring.outerRadiusM > ring.innerRadiusM,
    )
    .slice(0, MAX_RING_BANDS);
}

/**
 * Ring umbra on a globe without shadow-map receive (which blackouts ringed
 * planets). Each washer uses its live body-local plane normal (equatorial,
 * tilted, inertial, or orbital). Textured bands sample the shared radial map
 * with the same U mapping as the ring meshes.
 */
export async function applyAnalyticalRingShadow(
  material: MeshStandardMaterial | MeshPhysicalMaterial,
  body: BodyData,
): Promise<RingShadowState | null> {
  const bands = washerBands(body);
  if (bands.length === 0) return null;

  const system = body.rings!;
  const inner = new Float32Array(MAX_RING_BANDS);
  const outer = new Float32Array(MAX_RING_BANDS);
  const opacity = new Float32Array(MAX_RING_BANDS);
  const textured = new Float32Array(MAX_RING_BANDS);
  const texUInner = new Float32Array(MAX_RING_BANDS);
  const texUOuter = new Float32Array(MAX_RING_BANDS);
  const planeNormals = Array.from(
    { length: MAX_RING_BANDS },
    () => new Vector3(0, 0, 1),
  );
  const bandIds: string[] = [];

  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    bandIds.push(band.id);
    inner[i] = band.innerRadiusM;
    outer[i] = band.outerRadiusM;
    opacity[i] = Math.min(1, Math.max(0, band.opacity));
    textured[i] = band.textured ? 1 : 0;
    texUInner[i] = band.textureUInner !== undefined ? band.textureUInner : -1;
    texUOuter[i] = band.textureUOuter !== undefined ? band.textureUOuter : -1;
  }

  let opacityMap: Texture | null = null;
  let texR0 = 0;
  let texR1 = 0;
  if (
    system.textureMapUrl &&
    system.textureRadiusAtU0M !== undefined &&
    system.textureRadiusAtU1M !== undefined &&
    system.textureRadiusAtU0M !== system.textureRadiusAtU1M
  ) {
    opacityMap = await loadLinearTexture(system.textureMapUrl);
    texR0 = system.textureRadiusAtU0M;
    texR1 = system.textureRadiusAtU1M;
  }

  const uniforms: RingShadowUniforms = {
    uRingSunDirLocal: { value: new Vector3(0, 0, 1) },
    uRingBandCount: { value: bands.length },
    uRingInner: { value: inner },
    uRingOuter: { value: outer },
    uRingOpacity: { value: opacity },
    uRingBandTextured: { value: textured },
    uRingTexUInner: { value: texUInner },
    uRingTexUOuter: { value: texUOuter },
    uRingPlaneNormal: { value: planeNormals },
    uRingRadiusScale: {
      value: new Vector3(body.radiusXM, body.radiusYM, body.radiusZM),
    },
    uRingOpacityMap: { value: opacityMap },
    uRingTexRadius: { value: new Vector2(texR0, texR1) },
    uRingHasOpacityMap: { value: opacityMap ? 1 : 0 },
  };

  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer,
  ) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uRingRadiusScale;
        varying vec3 vRingBodyLocalPos;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vRingBodyLocalPos = position * uRingRadiusScale;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uRingSunDirLocal;
        uniform int uRingBandCount;
        uniform float uRingInner[${MAX_RING_BANDS}];
        uniform float uRingOuter[${MAX_RING_BANDS}];
        uniform float uRingOpacity[${MAX_RING_BANDS}];
        uniform float uRingBandTextured[${MAX_RING_BANDS}];
        uniform float uRingTexUInner[${MAX_RING_BANDS}];
        uniform float uRingTexUOuter[${MAX_RING_BANDS}];
        uniform vec3 uRingPlaneNormal[${MAX_RING_BANDS}];
        uniform sampler2D uRingOpacityMap;
        uniform vec2 uRingTexRadius;
        uniform float uRingHasOpacityMap;
        varying vec3 vRingBodyLocalPos;

        float ringTexUForBand( float r, int i ) {
          float u0 = uRingTexUInner[ i ];
          float u1 = uRingTexUOuter[ i ];
          if ( u0 >= 0.0 && u1 >= 0.0 ) {
            float bandSpan = uRingOuter[ i ] - uRingInner[ i ];
            float t = bandSpan > 1.0
              ? clamp( ( r - uRingInner[ i ] ) / bandSpan, 0.0, 1.0 )
              : 0.0;
            return clamp( mix( u0, u1, t ), 0.0, 1.0 );
          }
          float r0 = uRingTexRadius.x;
          float r1 = uRingTexRadius.y;
          float span = r1 - r0;
          if ( abs( span ) < 1.0 ) return 0.0;
          return clamp( ( r - r0 ) / span, 0.0, 1.0 );
        }

        float ringPlaneShadowFactor( vec3 bodyPos, vec3 sunDir ) {
          float light = 1.0;
          for ( int i = 0; i < ${MAX_RING_BANDS}; i ++ ) {
            if ( i >= uRingBandCount ) break;
            vec3 n = uRingPlaneNormal[ i ];
            float nLen = length( n );
            if ( nLen < 1e-8 ) continue;
            n /= nLen;
            float denom = dot( n, sunDir );
            if ( abs( denom ) < 1e-8 ) continue;
            float t = -dot( n, bodyPos ) / denom;
            if ( t <= 0.0 ) continue;
            vec3 hit = bodyPos + sunDir * t;
            float r = length( hit );
            if ( r < uRingInner[ i ] || r > uRingOuter[ i ] ) continue;

            if ( uRingHasOpacityMap > 0.5 && uRingBandTextured[ i ] > 0.5 ) {
              float u = ringTexUForBand( r, i );
              float dens = clamp(
                texture2D( uRingOpacityMap, vec2( u, 0.5 ) ).a,
                0.0,
                1.0
              );
              light *= max( 0.0, 1.0 - dens * uRingOpacity[ i ] );
            } else {
              light *= max( 0.0, 1.0 - uRingOpacity[ i ] );
            }
          }
          return light;
        }
        `,
      )
      .replace(
        // Must scale reflectedLight *before* outgoingLight is assembled.
        "#include <lights_fragment_end>",
        /* glsl */ `
        #include <lights_fragment_end>
        {
          float ringShadow = ringPlaneShadowFactor(
            vRingBodyLocalPos,
            normalize( uRingSunDirLocal )
          );
          reflectedLight.directDiffuse *= ringShadow;
          reflectedLight.directSpecular *= ringShadow;
          reflectedLight.indirectDiffuse *= ringShadow;
          reflectedLight.indirectSpecular *= ringShadow;
          totalEmissiveRadiance *= ringShadow;
        }
        `,
      );
  };

  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `ring-plane-shadow-${bands.length}-tex${opacityMap ? 1 : 0}|${previousKey.call(material)}`;

  return { uniforms, bandIds };
}

/**
 * Planet umbra on rings without shadow-map receive. Opaque washers self-shadow
 * to solid black in the map; this ray-tests the host ellipsoid instead.
 * Gas giants get a soft limb (see {@link GAS_GIANT_RING_UMBRA_SOFTNESS}).
 */
export function createRingPlanetUmbraState(
  body: BodyData,
): RingPlanetUmbraState {
  return {
    uniforms: {
      uRingPlanetCenter: { value: new Vector3() },
      uRingSunDirWorld: { value: new Vector3(0, 0, 1) },
      uRingInvBodyMatrix: { value: new Matrix3() },
      uRingPlanetRadii: {
        value: new Vector3(body.radiusXM, body.radiusYM, body.radiusZM),
      },
      uRingUmbraSoftness: {
        value: body.gasGiantEffects ? GAS_GIANT_RING_UMBRA_SOFTNESS : 0,
      },
    },
  };
}

export function applyAnalyticalPlanetUmbraOnRing(
  material: MeshStandardMaterial,
  state: RingPlanetUmbraState,
): void {
  const { uniforms } = state;
  const soft = uniforms.uRingUmbraSoftness.value;
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer,
  ) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vRingWorldPos;
        varying vec3 vRingWorldNormal;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vRingWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        vRingWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        uniform vec3 uRingPlanetCenter;
        uniform vec3 uRingSunDirWorld;
        uniform mat3 uRingInvBodyMatrix;
        uniform vec3 uRingPlanetRadii;
        uniform float uRingUmbraSoftness;
        varying vec3 vRingWorldPos;
        varying vec3 vRingWorldNormal;

        float planetUmbraOnRing() {
          vec3 sunDir = uRingSunDirWorld;
          float sunLen = length( sunDir );
          if ( sunLen < 1e-8 ) return 1.0;
          sunDir /= sunLen;
          // Umbra is a sunlight effect — skip the anti-sun face.
          if ( dot( normalize( vRingWorldNormal ), sunDir ) <= 0.0 ) return 1.0;
          vec3 p = uRingInvBodyMatrix * ( vRingWorldPos - uRingPlanetCenter );
          vec3 d = uRingInvBodyMatrix * sunDir;
          vec3 radii = max( uRingPlanetRadii, vec3( 1.0 ) );
          vec3 pS = p / radii;
          vec3 dS = d / radii;
          float a = dot( dS, dS );
          if ( a < 1e-20 ) return 1.0;
          float b = 2.0 * dot( pS, dS );
          float c = dot( pS, pS ) - 1.0;
          float disc = b * b - 4.0 * a * c;
          float invA = 0.5 / a;
          float soft = uRingUmbraSoftness;

          if ( soft > 1e-6 ) {
            // Soft limb from impact parameter (gas-giant atmosphere / haze).
            float tClosest = -dot( pS, dS ) / a;
            if ( tClosest < -soft ) return 1.0;
            float closestDist = length( pS + dS * tClosest );
            return smoothstep( 1.0 - soft, 1.0 + soft, closestDist );
          }

          if ( disc < 0.0 ) return 1.0;
          float sqrtDisc = sqrt( disc );
          float t0 = ( -b - sqrtDisc ) * invA;
          float t1 = ( -b + sqrtDisc ) * invA;
          float tNear = min( t0, t1 );
          float tFar = max( t0, t1 );
          if ( tFar < 1e-3 ) return 1.0;
          if ( tNear > 1e-3 ) return 0.0;
          return 0.0;
        }
        `,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `
        #include <lights_fragment_end>
        {
          float planetUmbra = planetUmbraOnRing();
          reflectedLight.directDiffuse *= planetUmbra;
          reflectedLight.directSpecular *= planetUmbra;
          reflectedLight.indirectDiffuse *= planetUmbra;
          reflectedLight.indirectSpecular *= planetUmbra;
          totalEmissiveRadiance *= planetUmbra;
        }
        `,
      );
  };

  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `ring-planet-umbra-soft${soft.toFixed(3)}|${previousKey.call(material)}`;
}

/** Surface mesh is named like its group; getObjectByName would return the group. */
function bodySurfaceMesh(bodyGroup: Group): Mesh | undefined {
  for (const child of bodyGroup.children) {
    if (child.name === bodyGroup.name && (child as Mesh).isMesh) {
      return child as Mesh;
    }
  }
  return undefined;
}

/** Update body-local sun direction and per-band ring plane normals. */
export function updateAnalyticalRingShadow(
  bodyGroup: Group,
  bodyOrientation: Quaternion,
  bodyPositionM: BodyPositionM,
  sunPositionM: BodyPositionM,
): void {
  const surface = bodySurfaceMesh(bodyGroup);
  if (!surface) return;
  const state = surface.userData.ringShadow as RingShadowState | undefined;
  if (!state) return;

  _sunDir.set(
    sunPositionM.x - bodyPositionM.x,
    sunPositionM.y - bodyPositionM.y,
    sunPositionM.z - bodyPositionM.z,
  );
  if (_sunDir.lengthSq() < 1e-12) {
    state.uniforms.uRingSunDirLocal.value.set(0, 0, 1);
  } else {
    _sunDir.normalize();
    _invOrient.copy(bodyOrientation).invert();
    _sunDir.applyQuaternion(_invOrient);
    state.uniforms.uRingSunDirLocal.value.copy(_sunDir);
  }

  const ringsRoot = bodyGroup.getObjectByName(`${bodyGroup.name}-rings`);
  if (!(ringsRoot instanceof Group)) return;

  const normals = state.uniforms.uRingPlaneNormal.value;
  for (let i = 0; i < state.bandIds.length; i++) {
    const ringGroup = ringsRoot.getObjectByName(state.bandIds[i]!);
    if (ringGroup) {
      // Ring +Z in body-local space (ringGroup is parented under the body).
      _ringNormal
        .copy(BODY_NORTH)
        .applyQuaternion(ringGroup.quaternion)
        .normalize();
      normals[i]!.copy(_ringNormal);
    } else {
      normals[i]!.set(0, 0, 1);
    }
  }
}

/** Update planet→ring analytical umbra uniforms on a rings root group. */
export function updateAnalyticalPlanetUmbraOnRings(
  ringsRoot: Group,
  bodyOrientation: Quaternion,
  bodyPositionM: BodyPositionM,
  sunPositionM: BodyPositionM,
): void {
  const state = ringsRoot.userData.planetUmbra as
    | RingPlanetUmbraState
    | undefined;
  if (!state) return;

  state.uniforms.uRingPlanetCenter.value.set(
    bodyPositionM.x,
    bodyPositionM.y,
    bodyPositionM.z,
  );
  _sunDir.set(
    sunPositionM.x - bodyPositionM.x,
    sunPositionM.y - bodyPositionM.y,
    sunPositionM.z - bodyPositionM.z,
  );
  if (_sunDir.lengthSq() < 1e-12) {
    state.uniforms.uRingSunDirWorld.value.set(0, 0, 1);
  } else {
    state.uniforms.uRingSunDirWorld.value.copy(_sunDir).normalize();
  }
  _invOrient.copy(bodyOrientation).invert();
  _invMatrix4.makeRotationFromQuaternion(_invOrient);
  state.uniforms.uRingInvBodyMatrix.value.setFromMatrix4(_invMatrix4);
}
