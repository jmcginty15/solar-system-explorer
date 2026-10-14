import {
  BasicDepthPacking,
  DoubleSide,
  MeshDepthMaterial,
  type Material,
  type Mesh,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";

/**
 * Ring casters: DoubleSide (thin washers vanish with BackSide) + linear depth
 * (strip log-depth so the ortho shadow camera matches shadowMatrix).
 */
export function createRingShadowDepthMaterial(
  opacity: number,
  map: Texture | undefined,
): MeshDepthMaterial {
  const clamped = Math.min(1, Math.max(0, opacity));
  const material = new MeshDepthMaterial({
    depthPacking: BasicDepthPacking,
    map: map ?? null,
    alphaTest: 0.05,
    opacity: clamped,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <logdepthbuf_vertex>",
      "/* linear shadow depth */",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <logdepthbuf_fragment>",
      "/* linear shadow depth */",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      /* glsl */ `
      #include <map_fragment>
      diffuseColor.a *= opacity;
      `,
    );
  };
  material.customProgramCacheKey = () =>
    `ring-shadow-depth-${clamped.toFixed(3)}-${map ? "tex" : "flat"}`;
  return material;
}

/**
 * Solid body casters for the ortho sun shadow map.
 * Always strips log-depth (main renderer uses logarithmicDepthBuffer; ortho
 * shadow compares linear depth via shadowMatrix).
 *
 * When the same mesh also receives, extrude slightly along the normal so the
 * stored depth sits behind the real surface — kills terminator self-shadow
 * acne from system-sized frustums without changing cast/receive flags.
 * `normalOffsetLocal` is in mesh-local units (≈ world offset / radius when
 * the globe is a scaled unit sphere).
 */
export function createBodyShadowDepthMaterial(
  normalOffsetLocal = 0,
): MeshDepthMaterial {
  const offset = Math.max(0, normalOffsetLocal);
  const material = new MeshDepthMaterial({
    depthPacking: BasicDepthPacking,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <logdepthbuf_vertex>", "/* linear shadow depth */")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        transformed += objectNormal * float(${offset});
        `,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <logdepthbuf_fragment>",
      "/* linear shadow depth */",
    );
  };
  material.customProgramCacheKey = () =>
    `body-shadow-depth-${offset.toFixed(5)}`;
  return material;
}

/**
 * Solid body shadows.
 * - Always cast (Earth → Moon, planet → moons, …).
 * - Receive on every solid body except ringed globes: open rings paint over the
 *   whole disk from the sun’s view and black out the planet. Ring↔planet
 *   umbras are analytical on both sides.
 * - Self-shadow acne is handled by {@link createBodyShadowDepthMaterial}
 *   (linear depth + normal extrusion), not by toggling cast/receive.
 */
export function bodyReceivesShadowMap(body: {
  rings?: { rings: readonly unknown[] };
}): boolean {
  return !body.rings?.rings.length;
}

/** Local normal extrusion when a globe both casts and receives (~2.5% of R). */
const SELF_SHADOW_NORMAL_OFFSET_LOCAL = 0.025;

export function enableBodyShadows(
  mesh: Mesh,
  options: { receiveShadow?: boolean } = {},
): void {
  mesh.castShadow = true;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.frustumCulled = false;
  // Linear ortho depth for all casters; extrude when self-shadow is possible.
  mesh.customDepthMaterial = createBodyShadowDepthMaterial(
    mesh.receiveShadow ? SELF_SHADOW_NORMAL_OFFSET_LOCAL : 0,
  );
}

/**
 * Fade shadow-map influence near the lighting terminator (low N·L).
 * Backup for residual acne; moon umbras on the lit hemisphere stay strong.
 */
export function mitigateTerminatorShadowAcne(material: Material): void {
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    previousCompile(shader, renderer);
    // Three.js indents this line with tabs; match flexibly.
    const replaced = shader.fragmentShader.replace(
      /directLight\.color\s*\*=\s*\(\s*directLight\.visible\s*&&\s*receiveShadow\s*\)\s*\?\s*getShadow\(\s*directionalShadowMap\[\s*i\s*\]\s*,\s*directionalLightShadow\.shadowMapSize\s*,\s*directionalLightShadow\.shadowIntensity\s*,\s*directionalLightShadow\.shadowBias\s*,\s*directionalLightShadow\.shadowRadius\s*,\s*vDirectionalShadowCoord\[\s*i\s*\]\s*\)\s*:\s*1\.0\s*;/,
      /* glsl */ `
      {
        float shadowFactor = ( directLight.visible && receiveShadow )
          ? getShadow(
              directionalShadowMap[ i ],
              directionalLightShadow.shadowMapSize,
              directionalLightShadow.shadowIntensity,
              directionalLightShadow.shadowBias,
              directionalLightShadow.shadowRadius,
              vDirectionalShadowCoord[ i ]
            )
          : 1.0;
        float ndotl = saturate( dot( geometryNormal, directLight.direction ) );
        shadowFactor = mix( 1.0, shadowFactor, smoothstep( 0.04, 0.35, ndotl ) );
        directLight.color *= shadowFactor;
      }
      `,
    );
    shader.fragmentShader = replaced;
  };

  material.customProgramCacheKey = () =>
    `${previousKey?.() ?? material.uuid}|term-shadow-acne-v2`;
}
