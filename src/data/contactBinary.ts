import type { BodyData, ContactBinaryData, ContactBinaryLobe } from "./types";

/** Default fractional overlap of facing X-radii when forming the neck. */
export const DEFAULT_CONTACT_BINARY_NECK_OVERLAP = 0.12;

/** Ellipsoid volume V = ⁴⁄₃π·a·b·c. */
export function ellipsoidVolumeM3(
  radiusXM: number,
  radiusYM: number,
  radiusZM: number,
): number {
  return (4 / 3) * Math.PI * radiusXM * radiusYM * radiusZM;
}

export type ContactBinaryLayout = {
  volumeA_M3: number;
  volumeB_M3: number;
  massA_kg: number;
  massB_kg: number;
  /** Center-to-center separation along X. */
  separationM: number;
  /** Lobe A center X (CoM at origin); ≤ 0. */
  lobeAX_M: number;
  /** Lobe B center X (CoM at origin); ≥ 0. */
  lobeBX_M: number;
  /** Axis-aligned half-extents of the combined figure from the CoM. */
  extentXM: number;
  extentYM: number;
  extentZM: number;
};

export function isContactBinary(
  body: BodyData,
): body is BodyData & { contactBinary: ContactBinaryData } {
  return body.contactBinary !== undefined;
}

/**
 * Place two lobes on the X-axis so the system CoM is at the origin.
 * Separation defaults from X-radii × (1 − neck overlap).
 */
export function layoutContactBinary(
  binary: ContactBinaryData,
  totalMassKg: number,
): ContactBinaryLayout {
  if (!(totalMassKg > 0)) {
    throw new Error("Contact binary total mass must be positive");
  }

  const { lobeA, lobeB } = binary;
  const volumeA_M3 = ellipsoidVolumeM3(
    lobeA.radiusXM,
    lobeA.radiusYM,
    lobeA.radiusZM,
  );
  const volumeB_M3 = ellipsoidVolumeM3(
    lobeB.radiusXM,
    lobeB.radiusYM,
    lobeB.radiusZM,
  );
  const volumeSum = volumeA_M3 + volumeB_M3;
  if (!(volumeSum > 0)) {
    throw new Error("Contact binary lobes must have positive volume");
  }

  const massA_kg = totalMassKg * (volumeA_M3 / volumeSum);
  const massB_kg = totalMassKg * (volumeB_M3 / volumeSum);

  const overlap =
    binary.neckOverlapFraction ?? DEFAULT_CONTACT_BINARY_NECK_OVERLAP;
  const separationM =
    binary.separationM ?? (lobeA.radiusXM + lobeB.radiusXM) * (1 - overlap);

  if (!(separationM > 0)) {
    throw new Error("Contact binary separation must be positive");
  }

  // CoM at 0: mA·xA + mB·xB = 0, xB − xA = separation.
  const lobeAX_M = -separationM * (massB_kg / totalMassKg);
  const lobeBX_M = separationM * (massA_kg / totalMassKg);

  const extentXM = Math.max(
    Math.abs(lobeAX_M) + lobeA.radiusXM,
    Math.abs(lobeBX_M) + lobeB.radiusXM,
  );
  const extentYM = Math.max(lobeA.radiusYM, lobeB.radiusYM);
  const extentZM = Math.max(lobeA.radiusZM, lobeB.radiusZM);

  return {
    volumeA_M3,
    volumeB_M3,
    massA_kg,
    massB_kg,
    separationM,
    lobeAX_M,
    lobeBX_M,
    extentXM,
    extentYM,
    extentZM,
  };
}

export function lobeScale(lobe: ContactBinaryLobe): {
  x: number;
  y: number;
  z: number;
} {
  return { x: lobe.radiusXM, y: lobe.radiusYM, z: lobe.radiusZM };
}

/**
 * Build a catalog body whose `radiusXM/YM/ZM` are the CoM-relative extents of
 * its contact-binary figure (for camera focus, clip planes, etc.).
 */
export function defineContactBinaryBody(
  partial: Omit<BodyData, "radiusXM" | "radiusYM" | "radiusZM"> & {
    contactBinary: ContactBinaryData;
  },
): BodyData {
  const layout = layoutContactBinary(partial.contactBinary, partial.mass);
  return {
    ...partial,
    radiusXM: layout.extentXM,
    radiusYM: layout.extentYM,
    radiusZM: layout.extentZM,
  };
}
