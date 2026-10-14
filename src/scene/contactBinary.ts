import {
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  type Material,
} from "three";
import type { BodyData } from "../data";
import { layoutContactBinary } from "../data/contactBinary";
import { createBodySphereGeometry } from "./bodySphere";
import {
  bodyReceivesShadowMap,
  enableBodyShadows,
  mitigateTerminatorShadowAcne,
} from "./shadowDepth";

export {
  DEFAULT_CONTACT_BINARY_NECK_OVERLAP,
  defineContactBinaryBody,
  ellipsoidVolumeM3,
  isContactBinary,
  layoutContactBinary,
  lobeScale,
  type ContactBinaryLayout,
} from "../data/contactBinary";

/**
 * Two ellipsoids on ±X about the system CoM; shared +Z is the spin axis.
 * Driven entirely by `body.contactBinary` + `body.mass` — body-agnostic.
 */
export function createContactBinarySurface(
  body: BodyData,
  options: { widthSegments?: number; heightSegments?: number } = {},
): Group {
  const binary = body.contactBinary;
  if (!binary) {
    throw new Error(`Body "${body.id}" has no contactBinary data`);
  }

  const layout = layoutContactBinary(binary, body.mass);
  const geometry = createBodySphereGeometry(
    options.widthSegments ?? 96,
    options.heightSegments ?? 48,
  );

  const materialParams: ConstructorParameters<typeof MeshPhysicalMaterial>[0] =
    {
      roughness: 0.92,
      metalness: 0.05,
    };
  if (body.albedo !== undefined) {
    materialParams.reflectivity = MathUtils.clamp(body.albedo, 0, 1);
    materialParams.roughness =
      (materialParams.roughness ?? 1) * (1 - 0.25 * body.albedo);
  }
  if (body.color !== undefined) {
    materialParams.color = body.color;
  }
  const material = new MeshPhysicalMaterial(materialParams);
  const receiveShadow = bodyReceivesShadowMap(body);
  if (receiveShadow) mitigateTerminatorShadowAcne(material);

  const root = new Group();
  root.name = body.id;

  const lobeA = new Mesh(geometry, material);
  lobeA.name = `${body.id}-lobe-a`;
  lobeA.position.set(layout.lobeAX_M, 0, 0);
  lobeA.scale.set(
    binary.lobeA.radiusXM,
    binary.lobeA.radiusYM,
    binary.lobeA.radiusZM,
  );
  enableBodyShadows(lobeA, { receiveShadow });
  root.add(lobeA);

  const lobeB = new Mesh(geometry, material);
  lobeB.name = `${body.id}-lobe-b`;
  lobeB.position.set(layout.lobeBX_M, 0, 0);
  lobeB.scale.set(
    binary.lobeB.radiusXM,
    binary.lobeB.radiusYM,
    binary.lobeB.radiusZM,
  );
  enableBodyShadows(lobeB, { receiveShadow });
  root.add(lobeB);

  root.userData.contactBinaryLayout = layout;
  root.userData.sharedMaterials = [material] satisfies Material[];
  return root;
}
