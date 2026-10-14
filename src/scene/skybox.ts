import {
  BackSide,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Scene,
} from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import skyTextureUrl from "../assets/sky/skysphere-texture.exr?url";
import type { StellarSystemId } from "../data/types";
import { ICRF_TO_INVARIABLE } from "../ephemeris/invariableFrame";
import { icrfToSceneMatrix } from "../ephemeris/sceneFrame";
import { SKYBOX_RADIUS_M } from "./constants";

/**
 * Inverted sphere starfield / Milky Way background.
 *
 * `skysphere-texture.exr` is an ICRF (J2000 equatorial) equirectangular map:
 * u ≈ RA/360° (galactic center near u≈0.74), v = 0 at the north celestial pole.
 * It is not a galactic or invariable-plane map — the Milky Way appears as a
 * ~60°-amplitude sinusoid, matching the galactic plane’s tilt to the equator.
 *
 * The sphere is built Z-up (like body meshes) and rotated by the active
 * star system's ICRF→scene matrix before use. Keep the mesh centered on the
 * camera.
 *
 * - Sol: ICRF → solar-system invariable frame (Souami & Souchay 2012).
 * - Exoplanet systems: ICRF → system invariable frame (XY = invariable plane,
 *   +X toward the Sun when that direction lies in-plane). Distant-star
 *   parallax is neglected for this all-sky EXR.
 */
export async function createSkybox(
  icrfToScene: Matrix3 = ICRF_TO_INVARIABLE,
): Promise<Mesh> {
  const texture = await new EXRLoader().loadAsync(skyTextureUrl);

  const geometry = new SphereGeometry(SKYBOX_RADIUS_M, 64, 32);
  // Three.js SphereGeometry is Y-up; put UV poles on ±Z (ICRF Dec → local Z).
  geometry.rotateX(Math.PI / 2);

  const material = new MeshBasicMaterial({
    map: texture,
    side: BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const skybox = new Mesh(geometry, material);
  skybox.name = "skybox";
  skybox.frustumCulled = false;
  skybox.renderOrder = -1;
  // BackSide viewing mirrors UVs; flip so u=0 maps to ICRF +X (RA=0 / equinox).
  skybox.scale.setX(-1);
  // Local sphere axes are ICRF; rotate into the active scene frame.
  skybox.quaternion.setFromRotationMatrix(
    new Matrix4().setFromMatrix3(icrfToScene),
  );
  return skybox;
}

export async function addSkybox(
  scene: Scene,
  stellarSystemId: StellarSystemId = "sol",
): Promise<Mesh> {
  const skybox = await createSkybox(icrfToSceneMatrix(stellarSystemId));
  scene.add(skybox);
  return skybox;
}
