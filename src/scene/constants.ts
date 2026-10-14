import { BODIES, getRing } from "../data/bodies";
import { ATMOSPHERE_HEIGHT_M } from "../data/types";

/** IAU astronomical unit in meters. */
export const METERS_PER_AU = 149_597_870_700;

/** Body figures — sourced from the shared body data model. */
export const SUN_RADIUS_X_M = BODIES.sun.radiusXM;
export const SUN_RADIUS_Y_M = BODIES.sun.radiusYM;
export const SUN_RADIUS_Z_M = BODIES.sun.radiusZM;

export const MERCURY_RADIUS_X_M = BODIES.mercury.radiusXM;
export const MERCURY_RADIUS_Y_M = BODIES.mercury.radiusYM;
export const MERCURY_RADIUS_Z_M = BODIES.mercury.radiusZM;
export const MERCURY_ELEVATION_MAX_M = BODIES.mercury.elevationMaxM!;
export const MERCURY_ELEVATION_MIN_M = BODIES.mercury.elevationMinM!;

export const VENUS_RADIUS_M = BODIES.venus.radiusXM;
export const VENUS_ATMOSPHERE_RADIUS_M = VENUS_RADIUS_M + ATMOSPHERE_HEIGHT_M;
export const VENUS_ELEVATION_MAX_M = BODIES.venus.elevationMaxM!;
export const VENUS_ELEVATION_MIN_M = BODIES.venus.elevationMinM!;

export const EARTH_RADIUS_X_M = BODIES.earth.radiusXM;
export const EARTH_RADIUS_Y_M = BODIES.earth.radiusYM;
export const EARTH_RADIUS_Z_M = BODIES.earth.radiusZM;
export const EARTH_ATMOSPHERE_RADIUS_X_M =
  EARTH_RADIUS_X_M + ATMOSPHERE_HEIGHT_M;
export const EARTH_ATMOSPHERE_RADIUS_Y_M =
  EARTH_RADIUS_Y_M + ATMOSPHERE_HEIGHT_M;
export const EARTH_ATMOSPHERE_RADIUS_Z_M =
  EARTH_RADIUS_Z_M + ATMOSPHERE_HEIGHT_M;
export const EARTH_ELEVATION_MAX_M = BODIES.earth.elevationMaxM!;
export const EARTH_ELEVATION_MIN_M = BODIES.earth.elevationMinM!;

export const MARS_RADIUS_X_M = BODIES.mars.radiusXM;
export const MARS_RADIUS_Y_M = BODIES.mars.radiusYM;
export const MARS_RADIUS_Z_M = BODIES.mars.radiusZM;
export const MARS_ELEVATION_MAX_M = BODIES.mars.elevationMaxM!;
export const MARS_ELEVATION_MIN_M = BODIES.mars.elevationMinM!;

export const JUPITER_RADIUS_X_M = BODIES.jupiter.radiusXM;
export const JUPITER_RADIUS_Y_M = BODIES.jupiter.radiusYM;
export const JUPITER_RADIUS_Z_M = BODIES.jupiter.radiusZM;

export const SATURN_RADIUS_X_M = BODIES.saturn.radiusXM;
export const SATURN_RADIUS_Y_M = BODIES.saturn.radiusYM;
export const SATURN_RADIUS_Z_M = BODIES.saturn.radiusZM;

export const URANUS_RADIUS_X_M = BODIES.uranus.radiusXM;
export const URANUS_RADIUS_Y_M = BODIES.uranus.radiusYM;
export const URANUS_RADIUS_Z_M = BODIES.uranus.radiusZM;

export const NEPTUNE_RADIUS_X_M = BODIES.neptune.radiusXM;
export const NEPTUNE_RADIUS_Y_M = BODIES.neptune.radiusYM;
export const NEPTUNE_RADIUS_Z_M = BODIES.neptune.radiusZM;

/** Jupiter rings */
export const JUPITER_HALO_RING_INNER_M = getRing(
  "jupiter",
  "halo",
).innerRadiusM;
export const JUPITER_HALO_RING_OUTER_M = getRing(
  "jupiter",
  "halo",
).outerRadiusM;
export const JUPITER_MAIN_RING_INNER_M = getRing(
  "jupiter",
  "main",
).innerRadiusM;
export const JUPITER_MAIN_RING_OUTER_M = getRing(
  "jupiter",
  "main",
).outerRadiusM;
export const JUPITER_MAIN_RING_THICKNESS_M = getRing(
  "jupiter",
  "main",
).thicknessM;
export const JUPITER_AMALTHEA_RING_INNER_M = getRing(
  "jupiter",
  "amalthea",
).innerRadiusM;
export const JUPITER_AMALTHEA_RING_OUTER_M = getRing(
  "jupiter",
  "amalthea",
).outerRadiusM;
export const JUPITER_AMALTHEA_RING_THICKNESS_M = getRing(
  "jupiter",
  "amalthea",
).thicknessM;
export const JUPITER_THEBE_RING_INNER_M = getRing(
  "jupiter",
  "thebe",
).innerRadiusM;
export const JUPITER_THEBE_RING_OUTER_M = getRing(
  "jupiter",
  "thebe",
).outerRadiusM;
export const JUPITER_THEBE_RING_THICKNESS_M = getRing(
  "jupiter",
  "thebe",
).thicknessM;

/** Saturn rings */
export const SATURN_D_RING_INNER_M = getRing("saturn", "d").innerRadiusM;
export const SATURN_D_RING_OUTER_M = getRing("saturn", "d").outerRadiusM;
export const SATURN_D_RING_THICKNESS_M = getRing("saturn", "d").thicknessM;
export const SATURN_C_RING_INNER_M = getRing("saturn", "c").innerRadiusM;
export const SATURN_C_RING_OUTER_M = getRing("saturn", "c").outerRadiusM;
export const SATURN_C_RING_THICKNESS_M = getRing("saturn", "c").thicknessM;
export const SATURN_B_RING_INNER_M = getRing("saturn", "b").innerRadiusM;
export const SATURN_B_RING_OUTER_M = getRing("saturn", "b").outerRadiusM;
export const SATURN_B_RING_THICKNESS_M = getRing("saturn", "b").thicknessM;
export const SATURN_CASSINI_DIVISION_INNER_M = getRing(
  "saturn",
  "cassini-division",
).innerRadiusM;
export const SATURN_CASSINI_DIVISION_OUTER_M = getRing(
  "saturn",
  "cassini-division",
).outerRadiusM;
export const SATURN_CASSINI_DIVISION_THICKNESS_M = getRing(
  "saturn",
  "cassini-division",
).thicknessM;
export const SATURN_A_RING_INNER_M = getRing("saturn", "a").innerRadiusM;
export const SATURN_A_RING_OUTER_M = getRing("saturn", "a").outerRadiusM;
export const SATURN_A_RING_THICKNESS_M = getRing("saturn", "a").thicknessM;
export const SATURN_ROCHE_DIVISION_INNER_M = getRing(
  "saturn",
  "roche-division",
).innerRadiusM;
export const SATURN_ROCHE_DIVISION_OUTER_M = getRing(
  "saturn",
  "roche-division",
).outerRadiusM;
export const SATURN_ROCHE_DIVISION_THICKNESS_M = getRing(
  "saturn",
  "roche-division",
).thicknessM;
export const SATURN_F_RING_INNER_M = getRing("saturn", "f").innerRadiusM;
export const SATURN_F_RING_OUTER_M = getRing("saturn", "f").outerRadiusM;
export const SATURN_F_RING_THICKNESS_M = getRing("saturn", "f").thicknessM;
export const SATURN_JANUS_EPIMETHEUS_RING_INNER_M = getRing(
  "saturn",
  "janus-epimetheus",
).innerRadiusM;
export const SATURN_JANUS_EPIMETHEUS_RING_OUTER_M = getRing(
  "saturn",
  "janus-epimetheus",
).outerRadiusM;
export const SATURN_JANUS_EPIMETHEUS_RING_THICKNESS_M = getRing(
  "saturn",
  "janus-epimetheus",
).thicknessM;
export const SATURN_G_RING_INNER_M = getRing("saturn", "g").innerRadiusM;
export const SATURN_G_RING_OUTER_M = getRing("saturn", "g").outerRadiusM;
export const SATURN_G_RING_THICKNESS_M = getRing("saturn", "g").thicknessM;
export const SATURN_METHONE_RING_ARC_INNER_M = getRing(
  "saturn",
  "methone-arc",
).innerRadiusM;
export const SATURN_METHONE_RING_ARC_OUTER_M = getRing(
  "saturn",
  "methone-arc",
).outerRadiusM;
export const SATURN_METHONE_RING_ARC_THICKNESS_M = getRing(
  "saturn",
  "methone-arc",
).thicknessM;
export const SATURN_ANTHE_RING_ARC_INNER_M = getRing(
  "saturn",
  "anthe-arc",
).innerRadiusM;
export const SATURN_ANTHE_RING_ARC_OUTER_M = getRing(
  "saturn",
  "anthe-arc",
).outerRadiusM;
export const SATURN_ANTHE_RING_ARC_THICKNESS_M = getRing(
  "saturn",
  "anthe-arc",
).thicknessM;
export const SATURN_PALLENE_RING_ARC_INNER_M = getRing(
  "saturn",
  "pallene-arc",
).innerRadiusM;
export const SATURN_PALLENE_RING_ARC_OUTER_M = getRing(
  "saturn",
  "pallene-arc",
).outerRadiusM;
export const SATURN_PALLENE_RING_ARC_THICKNESS_M = getRing(
  "saturn",
  "pallene-arc",
).thicknessM;
export const SATURN_E_RING_INNER_M = getRing("saturn", "e").innerRadiusM;
export const SATURN_E_RING_OUTER_M = getRing("saturn", "e").outerRadiusM;
export const SATURN_E_RING_THICKNESS_M = getRing("saturn", "e").thicknessM;
export const SATURN_PHOEBE_RING_INNER_M = getRing(
  "saturn",
  "phoebe",
).innerRadiusM;
export const SATURN_PHOEBE_RING_OUTER_M = getRing(
  "saturn",
  "phoebe",
).outerRadiusM;
export const SATURN_PHOEBE_RING_THICKNESS_M = getRing(
  "saturn",
  "phoebe",
).thicknessM;
/** Phoebe ring is coplanar with Saturn’s heliocentric orbital plane. */
export const SATURN_PHOEBE_RING_INCLINATION_DEG = getRing(
  "saturn",
  "phoebe",
).inclinationDeg;

/** Uranus rings */
export const URANUS_ZETA_CC_RING_INNER_M = getRing(
  "uranus",
  "zeta-cc",
).innerRadiusM;
export const URANUS_ZETA_CC_RING_OUTER_M = getRing(
  "uranus",
  "zeta-cc",
).outerRadiusM;
export const URANUS_ZETA_CC_RING_THICKNESS_M = getRing(
  "uranus",
  "zeta-cc",
).thicknessM;
export const URANUS_ZETA_C_RING_INNER_M = getRing(
  "uranus",
  "zeta-c",
).innerRadiusM;
export const URANUS_ZETA_C_RING_OUTER_M = getRing(
  "uranus",
  "zeta-c",
).outerRadiusM;
export const URANUS_ZETA_C_RING_THICKNESS_M = getRing(
  "uranus",
  "zeta-c",
).thicknessM;
export const URANUS_1986U2R_RING_INNER_M = getRing(
  "uranus",
  "1986u2r",
).innerRadiusM;
export const URANUS_1986U2R_RING_OUTER_M = getRing(
  "uranus",
  "1986u2r",
).outerRadiusM;
export const URANUS_1986U2R_RING_THICKNESS_M = getRing(
  "uranus",
  "1986u2r",
).thicknessM;
export const URANUS_ZETA_RING_INNER_M = getRing("uranus", "zeta").innerRadiusM;
export const URANUS_ZETA_RING_OUTER_M = getRing("uranus", "zeta").outerRadiusM;
export const URANUS_ZETA_RING_THICKNESS_M = getRing(
  "uranus",
  "zeta",
).thicknessM;
export const URANUS_6_RING_INNER_M = getRing("uranus", "6").innerRadiusM;
export const URANUS_6_RING_OUTER_M = getRing("uranus", "6").outerRadiusM;
export const URANUS_6_RING_THICKNESS_M = getRing("uranus", "6").thicknessM;
export const URANUS_6_RING_ECCENTRICITY = getRing("uranus", "6").eccentricity;
export const URANUS_6_RING_INCLINATION_DEG = getRing(
  "uranus",
  "6",
).inclinationDeg;
export const URANUS_5_RING_INNER_M = getRing("uranus", "5").innerRadiusM;
export const URANUS_5_RING_OUTER_M = getRing("uranus", "5").outerRadiusM;
export const URANUS_5_RING_THICKNESS_M = getRing("uranus", "5").thicknessM;
export const URANUS_5_RING_ECCENTRICITY = getRing("uranus", "5").eccentricity;
export const URANUS_5_RING_INCLINATION_DEG = getRing(
  "uranus",
  "5",
).inclinationDeg;
export const URANUS_4_RING_INNER_M = getRing("uranus", "4").innerRadiusM;
export const URANUS_4_RING_OUTER_M = getRing("uranus", "4").outerRadiusM;
export const URANUS_4_RING_THICKNESS_M = getRing("uranus", "4").thicknessM;
export const URANUS_4_RING_ECCENTRICITY = getRing("uranus", "4").eccentricity;
export const URANUS_4_RING_INCLINATION_DEG = getRing(
  "uranus",
  "4",
).inclinationDeg;
export const URANUS_ALPHA_RING_INNER_M = getRing(
  "uranus",
  "alpha",
).innerRadiusM;
export const URANUS_ALPHA_RING_OUTER_M = getRing(
  "uranus",
  "alpha",
).outerRadiusM;
export const URANUS_ALPHA_RING_THICKNESS_M = getRing(
  "uranus",
  "alpha",
).thicknessM;
export const URANUS_ALPHA_RING_ECCENTRICITY = getRing(
  "uranus",
  "alpha",
).eccentricity;
export const URANUS_ALPHA_RING_INCLINATION_DEG = getRing(
  "uranus",
  "alpha",
).inclinationDeg;
export const URANUS_BETA_RING_INNER_M = getRing("uranus", "beta").innerRadiusM;
export const URANUS_BETA_RING_OUTER_M = getRing("uranus", "beta").outerRadiusM;
export const URANUS_BETA_RING_THICKNESS_M = getRing(
  "uranus",
  "beta",
).thicknessM;
export const URANUS_BETA_RING_ECCENTRICITY = getRing(
  "uranus",
  "beta",
).eccentricity;
export const URANUS_BETA_RING_INCLINATION_DEG = getRing(
  "uranus",
  "beta",
).inclinationDeg;
export const URANUS_ETA_RING_INNER_M = getRing("uranus", "eta").innerRadiusM;
export const URANUS_ETA_RING_OUTER_M = getRing("uranus", "eta").outerRadiusM;
export const URANUS_ETA_RING_THICKNESS_M = getRing("uranus", "eta").thicknessM;
export const URANUS_ETA_RING_INCLINATION_DEG = getRing(
  "uranus",
  "eta",
).inclinationDeg;
export const URANUS_ETA_C_RING_INNER_M = getRing(
  "uranus",
  "eta-c",
).innerRadiusM;
export const URANUS_ETA_C_RING_OUTER_M = getRing(
  "uranus",
  "eta-c",
).outerRadiusM;
export const URANUS_ETA_C_RING_THICKNESS_M = getRing(
  "uranus",
  "eta-c",
).thicknessM;
export const URANUS_ETA_C_RING_INCLINATION_DEG = getRing(
  "uranus",
  "eta-c",
).inclinationDeg;
export const URANUS_GAMMA_RING_INNER_M = getRing(
  "uranus",
  "gamma",
).innerRadiusM;
export const URANUS_GAMMA_RING_OUTER_M = getRing(
  "uranus",
  "gamma",
).outerRadiusM;
export const URANUS_GAMMA_RING_THICKNESS_M = getRing(
  "uranus",
  "gamma",
).thicknessM;
export const URANUS_GAMMA_RING_ECCENTRICITY = getRing(
  "uranus",
  "gamma",
).eccentricity;
export const URANUS_GAMMA_RING_INCLINATION_DEG = getRing(
  "uranus",
  "gamma",
).inclinationDeg;
export const URANUS_DELTA_C_RING_INNER_M = getRing(
  "uranus",
  "delta-c",
).innerRadiusM;
export const URANUS_DELTA_C_RING_OUTER_M = getRing(
  "uranus",
  "delta-c",
).outerRadiusM;
export const URANUS_DELTA_C_RING_THICKNESS_M = getRing(
  "uranus",
  "delta-c",
).thicknessM;
export const URANUS_DELTA_C_RING_INCLINATION_DEG = getRing(
  "uranus",
  "delta-c",
).inclinationDeg;
export const URANUS_DELTA_RING_INNER_M = getRing(
  "uranus",
  "delta",
).innerRadiusM;
export const URANUS_DELTA_RING_OUTER_M = getRing(
  "uranus",
  "delta",
).outerRadiusM;
export const URANUS_DELTA_RING_THICKNESS_M = getRing(
  "uranus",
  "delta",
).thicknessM;
export const URANUS_DELTA_RING_INCLINATION_DEG = getRing(
  "uranus",
  "delta",
).inclinationDeg;
export const URANUS_LAMBDA_RING_INNER_M = getRing(
  "uranus",
  "lambda",
).innerRadiusM;
export const URANUS_LAMBDA_RING_OUTER_M = getRing(
  "uranus",
  "lambda",
).outerRadiusM;
export const URANUS_LAMBDA_RING_THICKNESS_M = getRing(
  "uranus",
  "lambda",
).thicknessM;
export const URANUS_EPSILON_RING_INNER_M = getRing(
  "uranus",
  "epsilon",
).innerRadiusM;
export const URANUS_EPSILON_RING_OUTER_M = getRing(
  "uranus",
  "epsilon",
).outerRadiusM;
export const URANUS_EPSILON_RING_THICKNESS_M = getRing(
  "uranus",
  "epsilon",
).thicknessM;
export const URANUS_EPSILON_RING_ECCENTRICITY = getRing(
  "uranus",
  "epsilon",
).eccentricity;
export const URANUS_NU_RING_INNER_M = getRing("uranus", "nu").innerRadiusM;
export const URANUS_NU_RING_OUTER_M = getRing("uranus", "nu").outerRadiusM;
export const URANUS_NU_RING_THICKNESS_M = getRing("uranus", "nu").thicknessM;
export const URANUS_MU_RING_INNER_M = getRing("uranus", "mu").innerRadiusM;
export const URANUS_MU_RING_OUTER_M = getRing("uranus", "mu").outerRadiusM;
export const URANUS_MU_RING_THICKNESS_M = getRing("uranus", "mu").thicknessM;

/** Neptune rings */
export const NEPTUNE_GALLE_RING_INNER_M = getRing(
  "neptune",
  "galle",
).innerRadiusM;
export const NEPTUNE_GALLE_RING_OUTER_M = getRing(
  "neptune",
  "galle",
).outerRadiusM;
export const NEPTUNE_GALLE_RING_THICKNESS_M = getRing(
  "neptune",
  "galle",
).thicknessM;
export const NEPTUNE_LE_VERRIER_RING_INNER_M = getRing(
  "neptune",
  "le-verrier",
).innerRadiusM;
export const NEPTUNE_LE_VERRIER_RING_OUTER_M = getRing(
  "neptune",
  "le-verrier",
).outerRadiusM;
export const NEPTUNE_LE_VERRIER_RING_THICKNESS_M = getRing(
  "neptune",
  "le-verrier",
).thicknessM;
export const NEPTUNE_LASSELL_RING_INNER_M = getRing(
  "neptune",
  "lassell",
).innerRadiusM;
export const NEPTUNE_LASSELL_RING_OUTER_M = getRing(
  "neptune",
  "lassell",
).outerRadiusM;
export const NEPTUNE_LASSELL_RING_THICKNESS_M = getRing(
  "neptune",
  "lassell",
).thicknessM;
export const NEPTUNE_ARAGO_RING_INNER_M = getRing(
  "neptune",
  "arago",
).innerRadiusM;
export const NEPTUNE_ARAGO_RING_OUTER_M = getRing(
  "neptune",
  "arago",
).outerRadiusM;
export const NEPTUNE_ARAGO_RING_THICKNESS_M = getRing(
  "neptune",
  "arago",
).thicknessM;
export const NEPTUNE_ADAMS_RING_INNER_M = getRing(
  "neptune",
  "adams",
).innerRadiusM;
export const NEPTUNE_ADAMS_RING_OUTER_M = getRing(
  "neptune",
  "adams",
).outerRadiusM;
export const NEPTUNE_ADAMS_RING_THICKNESS_M = getRing(
  "neptune",
  "adams",
).thicknessM;
export const NEPTUNE_ADAMS_RING_ECCENTRICITY = getRing(
  "neptune",
  "adams",
).eccentricity;
export const NEPTUNE_ADAMS_RING_INCLINATION_DEG = getRing(
  "neptune",
  "adams",
).inclinationDeg;

/**
 * Camera-centered sky sphere radius.
 * Kept modest for Float32 precision; the mesh tracks the camera so parallax
 * is zero regardless of where the viewer is in the solar system.
 */
export const SKYBOX_RADIUS_M = METERS_PER_AU;

/** Far clip large enough to frame the outer solar system from the Sun. */
export const CAMERA_FAR_M = 2_000 * METERS_PER_AU;

/** Orbit zoom range (distance from controls target), in meters. */
export const CAMERA_MIN_DISTANCE_M = 3 * NEPTUNE_RADIUS_X_M;
export const CAMERA_MAX_DISTANCE_M = CAMERA_FAR_M * 0.5;

/** Log-distance change per wheel notch (natural log of meters). */
export const CAMERA_LOG_ZOOM_SPEED = 0.05;

/**
 * Target horizontal FOV in degrees.
 * ~90° shows more sky than a narrow "window" view while staying in the
 * usual rectilinear range (wide enough to feel open, not fisheye).
 * Three.js cameras use vertical FOV, so this is converted via aspect ratio.
 */
export const CAMERA_HORIZONTAL_FOV_DEG = 90;

/**
 * World +Z is invariable-plane north (XY = invariable plane).
 * Use as the camera "up" so the invariable plane reads horizontal on screen.
 */
export const INVARIABLE_UP = { x: 0, y: 0, z: 1 } as const;

/** Faint starlight fill so night sides of planets aren't pure black. */
export const STARLIGHT_AMBIENT_INTENSITY = 0.075;
export const STARLIGHT_AMBIENT_COLOR = 0xb8c4d8;

/** Parallel sunlight (DirectionalLight) — matches former Sun PointLight. */
export const SUN_LIGHT_COLOR = 0xfff1d0;
export const SUN_LIGHT_INTENSITY = 3;
/** Shadow map resolution per side (DirectionalLight). */
export const SUN_SHADOW_MAP_SIZE = 4096;
