import {
  AdditiveBlending,
  CanvasTexture,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Texture,
} from "three";
import type { BodyData, BodyPositionM, CometEffectsData } from "../data";
import { SUN_BLOOM_LAYER } from "./layers";

const ANTI_SUN = new Vector3();
const DUST_DIR = new Vector3();
const VELOCITY = new Vector3();
const AIM = new Vector3();
const BODY_Q_INV = new Quaternion();
const WORLD_AIM_Q = new Quaternion();
const Y_AXIS = new Vector3(0, 1, 0);

/** Tiny deterministic hash → [0, 1) for wispy density noise. */
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise2(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x: number, y: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    value += amp * valueNoise2(x * freq, y * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return value;
}

function createComaTexture(colorHex: number): Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create comet coma canvas");

  const r = (colorHex >> 16) & 0xff;
  const g = (colorHex >> 8) & 0xff;
  const b = colorHex & 0xff;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.7)`);
  gradient.addColorStop(0.18, `rgba(${r}, ${g}, ${b}, 0.35)`);
  gradient.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.12)`);
  gradient.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, 0.03)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Soft plume map for cone shells.
 * v = along the tail (tip→end). Circumferential u gets streak noise only;
 * softness along the length comes from nested shells + axial fade.
 */
function createGaseousTailTexture(
  colorHex: number,
  options: { streaminess: number; seed: number },
): Texture {
  const width = 128;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create comet tail canvas");

  const r = (colorHex >> 16) & 0xff;
  const g = (colorHex >> 8) & 0xff;
  const b = colorHex & 0xff;
  const image = ctx.createImageData(width, height);
  const { streaminess, seed } = options;

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const axial = Math.exp(-1.8 * v) * Math.pow(1 - v, 1.15);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const streak = fbm2(u * 6 + seed, v * streaminess * 14 + seed * 0.7);
      const blotch = fbm2(u * 3 + seed * 1.3, v * 4 + seed);
      const density = Math.max(0.2, 0.55 + 0.5 * streak + 0.25 * blotch);
      const alpha = Math.min(1, axial * density * 0.85);
      const i = (y * width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createComaSprite(
  map: Texture,
  color: number,
  worldSize: number,
  opacity: number,
  name: string,
): Sprite {
  const material = new SpriteMaterial({
    map,
    color,
    opacity,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const sprite = new Sprite(material);
  sprite.name = name;
  sprite.scale.set(worldSize, worldSize, 1);
  sprite.frustumCulled = false;
  sprite.layers.set(SUN_BLOOM_LAYER);
  return sprite;
}

function softenTailShellRim(material: MeshBasicMaterial) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vTailRimNormal;
        `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vTailRimNormal = normalize(mat3(modelViewMatrix) * normal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vTailRimNormal;
        `,
      )
      .replace(
        "#include <dithering_fragment>",
        /* glsl */ `
        // Fade the grazing silhouette so the cone rim reads as soft gas.
        float facing = abs(dot(normalize(vTailRimNormal), vec3(0.0, 0.0, 1.0)));
        gl_FragColor.a *= smoothstep(0.02, 0.55, facing);
        #include <dithering_fragment>
        `,
      );
  };
  material.customProgramCacheKey = () => "comet-tail-soft-rim";
}

function createTailShell(
  lengthM: number,
  baseRadiusM: number,
  color: number,
  opacity: number,
  map: Texture,
): Mesh {
  // Tip at origin, base at −Y (tail extends along −Y until reoriented).
  const geometry = new ConeGeometry(baseRadiusM, lengthM, 48, 1, true);
  geometry.translate(0, -lengthM / 2, 0);

  const material = new MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  });
  softenTailShellRim(material);

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * Nested translucent cones — soft volume without screen-space overdraw artifacts.
 * Outer shells are wider and fainter; a view-angle fade softens the hard rim.
 */
function createTailGroup(
  name: string,
  lengthM: number,
  baseRadiusM: number,
  color: number,
  opacity: number,
  map: Texture,
  style: "ion" | "dust",
): Group {
  const group = new Group();
  group.name = name;

  const layers =
    style === "ion"
      ? [
          { length: 1, radius: 0.18, opacity: 0.5 },
          { length: 0.98, radius: 0.45, opacity: 0.3 },
          { length: 0.95, radius: 0.85, opacity: 0.16 },
          { length: 0.9, radius: 1.25, opacity: 0.08 },
          { length: 0.84, radius: 1.75, opacity: 0.035 },
        ]
      : [
          { length: 0.96, radius: 0.3, opacity: 0.38 },
          { length: 1, radius: 0.65, opacity: 0.26 },
          { length: 0.96, radius: 1.05, opacity: 0.14 },
          { length: 0.9, radius: 1.5, opacity: 0.07 },
          { length: 0.84, radius: 2.05, opacity: 0.03 },
        ];

  for (const layer of layers) {
    group.add(
      createTailShell(
        lengthM * layer.length,
        baseRadiusM * layer.radius,
        color,
        opacity * layer.opacity,
        map,
      ),
    );
  }

  return group;
}

/**
 * Build coma sprites + ion/dust tails for a comet.
 * Tails initially point along −Y; call `updateCometEffects` to aim anti-sun.
 */
export function createCometEffects(body: BodyData): Group | null {
  const effects = body.cometEffects;
  if (!effects) return null;

  const root = new Group();
  root.name = `${body.id}-comet`;

  const comaMap = createComaTexture(effects.comaColor);
  root.add(
    createComaSprite(
      comaMap,
      effects.comaColor,
      // Sprite scale is full width; radius fields are center→edge.
      2 * effects.comaInnerRadiusM,
      effects.comaInnerOpacity,
      `${body.id}-coma-inner`,
    ),
  );
  root.add(
    createComaSprite(
      comaMap,
      effects.comaColor,
      2 * effects.comaOuterRadiusM,
      effects.comaOuterOpacity,
      `${body.id}-coma-outer`,
    ),
  );

  const ionMap = createGaseousTailTexture(effects.ionTailColor, {
    streaminess: 1.35,
    seed: 1.7,
  });
  root.add(
    createTailGroup(
      `${body.id}-ion-tail`,
      effects.ionTailLengthM,
      effects.ionTailBaseRadiusM,
      effects.ionTailColor,
      effects.ionTailOpacity,
      ionMap,
      "ion",
    ),
  );

  const dustMap = createGaseousTailTexture(effects.dustTailColor, {
    streaminess: 0.85,
    seed: 4.2,
  });
  root.add(
    createTailGroup(
      `${body.id}-dust-tail`,
      effects.dustTailLengthM,
      effects.dustTailBaseRadiusM,
      effects.dustTailColor,
      effects.dustTailOpacity,
      dustMap,
      "dust",
    ),
  );

  root.userData.cometEffects = effects;
  return root;
}

/**
 * Aim ion/dust tails anti-sunward in the invariable frame.
 * Dust lags slightly along the heliocentric velocity (orbital trail).
 * Because the parent body group carries IAU spin, directions are expressed
 * in the body's local frame.
 */
export function updateCometEffects(
  bodyGroup: Group,
  bodyOrientation: Quaternion,
  bodyPositionM: BodyPositionM,
  sunPositionM: BodyPositionM,
  velocityMS?: BodyPositionM,
): void {
  const root = bodyGroup.getObjectByName(`${bodyGroup.name}-comet`);
  if (!(root instanceof Group)) return;

  const effects = root.userData.cometEffects as CometEffectsData | undefined;
  if (!effects) return;

  // Away from the Sun: from Sun through the comet and beyond.
  ANTI_SUN.set(
    bodyPositionM.x - sunPositionM.x,
    bodyPositionM.y - sunPositionM.y,
    bodyPositionM.z - sunPositionM.z,
  );
  if (ANTI_SUN.lengthSq() < 1e-12) return;
  ANTI_SUN.normalize();

  BODY_Q_INV.copy(bodyOrientation).invert();

  // Cone extends along −Y; rotate so −Y matches anti-sun in local space.
  AIM.copy(ANTI_SUN).applyQuaternion(BODY_Q_INV).normalize().negate();
  WORLD_AIM_Q.setFromUnitVectors(Y_AXIS, AIM);

  const ionTail = root.getObjectByName(`${bodyGroup.name}-ion-tail`);
  if (ionTail) ionTail.quaternion.copy(WORLD_AIM_Q);

  DUST_DIR.copy(ANTI_SUN);
  if (velocityMS) {
    VELOCITY.set(velocityMS.x, velocityMS.y, velocityMS.z);
    if (VELOCITY.lengthSq() > 1e-12) {
      VELOCITY.normalize();
      DUST_DIR.addScaledVector(VELOCITY, 0.28).normalize();
    }
  }
  AIM.copy(DUST_DIR).applyQuaternion(BODY_Q_INV).normalize().negate();
  WORLD_AIM_Q.setFromUnitVectors(Y_AXIS, AIM);

  const dustTail = root.getObjectByName(`${bodyGroup.name}-dust-tail`);
  if (dustTail) dustTail.quaternion.copy(WORLD_AIM_Q);
}
