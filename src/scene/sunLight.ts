import {
  DirectionalLight,
  PCFShadowMap,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
} from "three";
import {
  SUN_LIGHT_COLOR,
  SUN_LIGHT_INTENSITY,
  SUN_SHADOW_MAP_SIZE,
} from "./constants";

const _sun = new Vector3();
const _focus = new Vector3();
const _dir = new Vector3();

/** Enable shadow maps on the renderer. */
export function configureRendererShadows(renderer: WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = true;
}

/** Parallel starlight with a focus-local orthographic shadow frustum. */
export function createSunDirectionalLight(
  color: number = SUN_LIGHT_COLOR,
  intensity: number = SUN_LIGHT_INTENSITY,
): DirectionalLight {
  const light = new DirectionalLight(color, intensity);
  light.name = "sun-light";
  light.castShadow = true;
  light.shadow.mapSize.set(SUN_SHADOW_MAP_SIZE, SUN_SHADOW_MAP_SIZE);
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 1_000;
  light.shadow.intensity = 1;
  light.shadow.radius = 2;
  light.shadow.autoUpdate = true;
  light.shadow.needsUpdate = true;
  return light;
}

/** Retint / rescale the shared directional light for the active primary star. */
export function applyStarLightAppearance(
  light: DirectionalLight,
  color: number,
  intensity: number,
): void {
  light.color.setHex(color);
  light.intensity = intensity;
}

/**
 * Aim sunlight Sun → focus. Light sits near the focus (not at the real Sun)
 * so float32 shadow depth has usable precision at planetary scales.
 *
 * `focusRadiusM` caps normalBias so a system-sized frustum (moon orbit much
 * larger than the primary) still fights terminator self-shadow acne without
 * peter-panning small moons out of the primary’s umbra.
 */
export function updateSunDirectionalLight(
  light: DirectionalLight,
  sunPositionM: { x: number; y: number; z: number } | null | undefined,
  focusPositionM: { x: number; y: number; z: number },
  shadowExtentM: number,
  camera: PerspectiveCamera,
  focusRadiusM = 0,
): void {
  _focus.set(focusPositionM.x, focusPositionM.y, focusPositionM.z);
  const extent = Math.max(shadowExtentM, 1);
  const lightDistance = Math.max(extent * 2.5, 1);

  if (!sunPositionM) {
    light.castShadow = false;
    camera.getWorldDirection(_dir);
    light.position.copy(_focus).addScaledVector(_dir, -lightDistance);
    light.target.position.copy(_focus);
    light.updateMatrixWorld(true);
    light.target.updateMatrixWorld(true);
    return;
  }

  _sun.set(sunPositionM.x, sunPositionM.y, sunPositionM.z);
  _dir.subVectors(_focus, _sun);
  const distToSun = _dir.length();

  if (!(distToSun > 1) || !Number.isFinite(distToSun)) {
    light.castShadow = false;
    light.position.set(_focus.x + lightDistance, _focus.y, _focus.z);
    light.target.position.copy(_focus);
    light.updateMatrixWorld(true);
    light.target.updateMatrixWorld(true);
    return;
  }

  _dir.multiplyScalar(1 / distToSun);

  light.castShadow = true;
  light.position.copy(_focus).addScaledVector(_dir, -lightDistance);
  light.target.position.copy(_focus);
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);

  const cam = light.shadow.camera;
  cam.left = -extent;
  cam.right = extent;
  cam.top = extent;
  cam.bottom = -extent;
  cam.near = Math.max(lightDistance * 0.05, 1);
  cam.far = lightDistance + extent * 2;
  cam.updateProjectionMatrix();

  // World size of one shadow texel. Acne on primaries appears when this is
  // kilometres-scale while normalBias stays at a few hundred metres.
  const texelM = (2 * extent) / SUN_SHADOW_MAP_SIZE;
  const radiusCap =
    focusRadiusM > 0 ? focusRadiusM * 0.04 : Number.POSITIVE_INFINITY;
  light.shadow.normalBias = Math.min(radiusCap, Math.max(500, texelM * 1.25));
  light.shadow.bias = -0.0002;
  light.shadow.needsUpdate = true;
}
