/** Atmosphere shells sit this far above the body's reference surface. */
export const ATMOSPHERE_HEIGHT_M = 100_000;

export type RingShape = "washer" | "torus";

/** Optional cloud / haze shell around a body. */
export interface AtmosphereData {
  textureMapUrl: string;
  alphaMapUrl: string;
}

/**
 * One ellipsoid lobe of a contact binary (radii in meters).
 * Local axes match the body frame: +Z is the shared spin axis.
 */
export interface ContactBinaryLobe {
  radiusXM: number;
  radiusYM: number;
  radiusZM: number;
}

/**
 * Two ellipsoidal lobes joined in the equatorial (XY) plane about a shared
 * +Z spin axis through the system center of mass.
 *
 * Mass is split by lobe volume (uniform density). Separation is along +X;
 * lobe A sits at x ≤ 0 and lobe B at x ≥ 0 after CoM placement.
 * Works for any contact-binary body (comets, asteroids, …).
 */
export interface ContactBinaryData {
  lobeA: ContactBinaryLobe;
  lobeB: ContactBinaryLobe;
  /**
   * Center-to-center separation along X (meters).
   * When omitted, derived from the X-radii and `neckOverlapFraction`.
   */
  separationM?: number;
  /**
   * Fractional overlap of the facing X-radii used when `separationM` is
   * omitted (0 = just touching, 1 = centers coincide). Default 0.12.
   */
  neckOverlapFraction?: number;
}

/**
 * Coma + dual-tail visuals for an active comet.
 * Lengths / radii are meters; colors are hex RGB.
 */
export interface CometEffectsData {
  /** Soft additive coma tint (often pale cyan-white). */
  comaColor: number;
  /**
   * Coma radii from the nucleus center (meters).
   * Sprites are sized to diameter = 2× radius so the glow reaches this distance.
   */
  comaInnerRadiusM: number;
  comaOuterRadiusM: number;
  comaInnerOpacity: number;
  comaOuterOpacity: number;
  /** Ion (plasma) tail — narrow, bluish, anti-sunward. */
  ionTailColor: number;
  ionTailLengthM: number;
  ionTailBaseRadiusM: number;
  ionTailOpacity: number;
  /** Dust tail — broader, yellowish; lags slightly along the orbit. */
  dustTailColor: number;
  dustTailLengthM: number;
  dustTailBaseRadiusM: number;
  dustTailOpacity: number;
}

/**
 * One ring (or ring component) in a body's ring system.
 * Radii / thicknesses are in meters; angles in degrees.
 */
export interface RingData {
  id: string;
  innerRadiusM: number;
  outerRadiusM: number;
  thicknessM: number;
  eccentricity: number;
  inclinationDeg: number;
  /**
   * Continuously align this ring with the host body's heliocentric orbital
   * plane at the displayed epoch (e.g. Saturn’s Phoebe ring). Recomputed via
   * `setBodyOrientation` whenever the host moves or spins.
   */
  alignToOrbitalPlane?: boolean;
  /**
   * Keep this ring fixed relative to the body's mean IAU equator (α₀, δ₀),
   * cancelling prime-meridian spin W so a nonzero `inclinationDeg` does not
   * wobble with the surface (e.g. Haumea’s ring).
   */
  alignToMeanEquator?: boolean;
  /**
   * ICRF north-pole right ascension / declination (deg) for this ring plane.
   * When set, the ring is kept inertially fixed to that pole (tilt relative to
   * the host follows from the difference vs the body's α₀, δ₀; e.g. Chariklo).
   */
  northPoleRaDeg?: number;
  northPoleDecDeg?: number;
  shape: RingShape;
  /** When true, samples the ring system's shared density texture. */
  textured: boolean;
  /**
   * Optional explicit texture U at the ring's inner / outer edges
   * (used when mapping is not a simple linear radial span, e.g. Jupiter).
   */
  textureUInner?: number;
  textureUOuter?: number;
  opacity: number;
  /** Per-ring lit color override; falls back to the system color. */
  color?: number;
  /** Per-ring anti-sun color override; falls back to the system unlit color. */
  unlitColor?: number;
}

/** Shared appearance + geometry for a body's rings. */
export interface RingSystemData {
  textureMapUrl?: string;
  /** Planetocentric radius sampled at texture U=0 (image left). */
  textureRadiusAtU0M?: number;
  /** Planetocentric radius sampled at texture U=1 (image right). */
  textureRadiusAtU1M?: number;
  color: number;
  unlitColor: number;
  litEmissiveIntensity: number;
  unlitEmissiveIntensity: number;
  unlitOpacityScale: number;
  /**
   * Split washers into sunlit vs anti-sun faces and shade by normal·sun.
   * Used for all ring systems; lit/unlit intensities may match when contrast
   * is weak (e.g. Jupiter).
   */
  sunFaceContrast: boolean;
  rings: RingData[];
}

/**
 * Linear angle used inside IAU orientation series, degrees.
 * value = constant + perCentury·T + perDay·d + perDaySquared·d²
 * (T = Julian centuries from J2000.0, d = Julian days from J2000.0).
 */
export interface IauAngleSeries {
  constant: number;
  perCentury?: number;
  perDay?: number;
  /** Coefficient of d² (e.g. Moon W). */
  perDaySquared?: number;
}

/**
 * Periodic contribution a·sin(k·θ) + b·cos(k·θ), degrees.
 * `angle` names an entry in `IauOrientationModel.auxiliaryAngles`.
 */
export interface IauPeriodicTerm {
  angle: string;
  /** Multiplier on the auxiliary angle (e.g. 2 for sin(2·M1)). Default 1. */
  multiple?: number;
  sinCoeff?: number;
  cosCoeff?: number;
}

/** α₀ / δ₀ / W polynomial + optional Fourier terms (IAU WGCCRE style). */
export interface IauOrientationSeries extends IauAngleSeries {
  periodic?: IauPeriodicTerm[];
}

/**
 * IAU WGCCRE rotational elements as coefficients, not precomputed tilts.
 * Evaluate at an epoch to get ICRF north-pole (α₀, δ₀) and prime meridian W.
 */
export interface IauOrientationModel {
  /** North pole right ascension α₀ (deg, ICRF). */
  northPoleRa: IauOrientationSeries;
  /** North pole declination δ₀ (deg, ICRF). */
  northPoleDec: IauOrientationSeries;
  /** Prime meridian angle W (deg). */
  primeMeridian: IauOrientationSeries;
  /** Named angles referenced by periodic terms (e.g. Mercury M1, Neptune N). */
  auxiliaryAngles?: Record<string, IauAngleSeries>;
}

/** Which star system a catalog body belongs to (default `"sol"`). */
export type StellarSystemId =
  | "sol"
  | "trappist-1"
  | "hd-110067"
  | "hd-10180"
  | "hd-219134"
  | "kepler-90"
  | "hd-80606"
  | "kepler-16"
  | "kepler-47"
  | "gliese-876";

/**
 * Catalog two-body Keplerian elements about the system primary (SI units).
 * Used for exoplanet systems (and other bodies) that lack SPK ephemerides.
 *
 * Epoch is given as a transit / conjunction time plus orbital period so the
 * mean anomaly at any Julian date can be recovered without a separate M₀.
 */
export interface KeplerianElements {
  /** Semimajor axis (m). */
  semiMajorAxisM: number;
  /** Eccentricity (≥ 0). */
  eccentricity: number;
  /**
   * Inclination (rad).
   * When `referencePlane` is `"sky"` (default), this is the sky-plane
   * inclination used in exoplanet literature (0 = face-on, ~π/2 = edge-on).
   * At runtime it is rotated into the system invariable frame (scene XY).
   */
  inclinationRad: number;
  /** Argument of periapsis ω (rad). */
  argPeriapsisRad: number;
  /**
   * Longitude of the ascending node Ω (rad) in the sky plane.
   * When omitted, 0 is used for invariable-plane construction (shared node);
   * near-coplanar orbits then get a legacy periapsis convention in-scene.
   */
  raanRad?: number;
  /** Sidereal orbital period (s). */
  periodS: number;
  /**
   * Mid-transit / inferior-conjunction epoch as Julian Date (TDB), on the
   * same time scale as the simulation clock. Used when `periastronJd` is
   * omitted (typical for transiting planets).
   */
  transitJd?: number;
  /**
   * Epoch of periastron as Julian Date (TDB). When set, mean anomaly is
   * measured from periapsis (M = 0 at this epoch) — typical for RV solutions.
   */
  periastronJd?: number;
  /** Full transit duration (s), when known. */
  transitDurationS?: number;
  /**
   * Stellar radial-velocity semi-amplitude K (m/s), when measured.
   * Stored for catalog fidelity; not required for state synthesis.
   */
  radialVelocityAmplitudeMS?: number;
  /**
   * Plane in which inclination / node are defined.
   * - `"sky"` (default): exoplanet sky-plane convention; rotated into the
   *   system invariable frame (scene XY) at load time.
   * - `"orbital"`: elements already expressed in the active scene frame.
   */
  referencePlane?: "sky" | "orbital";
}

/**
 * Static description of a solar-system body.
 * Position is omitted — it is derived (or placeholder-stored) elsewhere.
 */
export interface BodyData {
  id: string;
  name: string;
  radiusXM: number;
  radiusYM: number;
  radiusZM: number;
  textureMapUrl?: string;
  displacementMapUrl?: string;
  /** Elevation extremes for displacement (meters vs the reference ellipsoid). */
  elevationMinM?: number;
  elevationMaxM?: number;
  /**
   * UV offset applied only to the displacement / bump map, so a height map
   * from a different source can be registered to the color texture.
   * Same convention as Three.js `Texture.offset` (fraction of map size).
   */
  displacementMapOffset?: { x: number; y: number };
  /**
   * Optional base surface color (hex RGB). Used when there is no color
   * texture, or as a tint when a map is present (Three.js multiplies).
   */
  color?: number;
  specularMapUrl?: string;
  atmosphere?: AtmosphereData;
  /**
   * Contact-binary nucleus: two ellipsoids joined in XY about a shared +Z
   * spin axis through the system center of mass (replaces the single sphere).
   */
  contactBinary?: ContactBinaryData;
  /** Soft coma + dust/ion tails (active comets). */
  cometEffects?: CometEffectsData;
  gasGiantEffects: boolean;
  /** Soft glow sprites + emissive photosphere (stars). */
  glowAndLight: boolean;
  /**
   * Bolometric luminosity in solar units (L / L☉). Drives star light intensity,
   * photosphere emissive strength, glow opacity, and bloom relative to the Sun.
   */
  luminosityLSun?: number;
  /** Morgan–Keenan / spectral class label for stars (e.g. "G2V", "M8V"). */
  spectralType?: string;
  /**
   * Photosphere / glow / directional-light tint (hex RGB) for `glowAndLight`
   * bodies. Defaults to a warm solar white when omitted.
   */
  starColor?: number;
  /** Star system this body belongs to. Omitted → `"sol"`. */
  stellarSystemId?: StellarSystemId;
  /**
   * Two-body Keplerian elements about the system primary.
   * When set, initial state is synthesized at the simulation epoch (no SPK).
   */
  keplerianElements?: KeplerianElements;
  rings?: RingSystemData;
  type?:
    | "star"
    | "terrestrial-planet"
    | "dwarf-planet"
    | "gas-giant"
    | "ice-giant"
    | "terrestrial-satellite"
    | "martian-satellite"
    | "jovian-satellite"
    | "saturnian-satellite"
    | "uranian-satellite"
    | "neptunian-satellite"
    | "plutonian-satellite"
    | "eridian-satellite"
    | "haumean-satellite"
    | "quaoaran-satellite"
    | "orcinian-satellite"
    | "salacian-satellite"
    | "kagarian-satellite"
    | "didymosian-satellite"
    | "patroclian-satellite"
    | "asteroid"
    | "comet";
  mass: number;
  /** Bond / geometric albedo; drives surface dielectric reflectivity. */
  albedo?: number;
  /**
   * Named dynamical / catalog satellite family (e.g. Himalia group).
   * Null / omitted when ungrouped or not applicable.
   */
  satelliteGroup?: SatelliteGroup | null;
  /**
   * IAU pole / prime-meridian coefficient model (WGCCRE).
   * Orientation is derived from α₀, δ₀, W at the scene epoch.
   */
  iauOrientation: IauOrientationModel;
  /**
   * True when the IAU sidereal rotation period matches the osculating orbital
   * period about the parent-system barycenter (1:1 tidal lock). Set by audit;
   * unused for rendering until a dedicated lock mechanism is wired up.
   */
  tidallyLocked?: boolean;
}

/** Dynamical / catalog family for natural satellites. */
export type SatelliteGroup =
  | "inner"
  | "galilean"
  | "major"
  | "regular"
  | "himalia"
  | "carpo"
  | "ananke"
  | "carme"
  | "pasiphae"
  | "inuit"
  | "gallic"
  | "norse"
  | "caliban"
  | "irregular"
  | "sao"
  | "neso";

export type BodyId =
  | "sun"
  | "trappist1"
  | "trappist1b"
  | "trappist1c"
  | "trappist1d"
  | "trappist1e"
  | "trappist1f"
  | "trappist1g"
  | "trappist1h"
  | "hd110067"
  | "hd110067b"
  | "hd110067c"
  | "hd110067d"
  | "hd110067e"
  | "hd110067f"
  | "hd110067g"
  | "hd10180"
  | "hd10180c"
  | "hd10180d"
  | "hd10180e"
  | "hd10180f"
  | "hd10180g"
  | "hd10180h"
  | "hd219134"
  | "hd219134b"
  | "hd219134c"
  | "hd219134d"
  | "hd219134f"
  | "hd219134g"
  | "hd219134h"
  | "kepler90"
  | "kepler90b"
  | "kepler90c"
  | "kepler90d"
  | "kepler90e"
  | "kepler90f"
  | "kepler90g"
  | "kepler90h"
  | "kepler90i"
  | "hd80606"
  | "hd80606b"
  | "hd80607"
  | "kepler16A"
  | "kepler16B"
  | "kepler16b"
  | "kepler47A"
  | "kepler47B"
  | "kepler47b"
  | "kepler47c"
  | "kepler47d"
  | "gliese876"
  | "gliese876b"
  | "gliese876c"
  | "gliese876d"
  | "gliese876e"
  | "mercury"
  | "venus"
  | "earth"
  | "mars"
  | "ceres"
  | "pallas"
  | "vesta"
  | "psyche"
  | "lutetia"
  | "kalliope"
  | "eugenia"
  | "sylvia"
  | "antiope"
  | "kleopatra"
  | "ida"
  | "mathilde"
  | "eros"
  | "davida"
  | "icarus"
  | "didymos"
  | "dimorphos"
  | "patroclus"
  | "menoetius"
  | "toutatis"
  | "chariklo"
  | "itokawa"
  | "quaoar"
  | "sedna"
  | "orcus"
  | "salacia"
  | "kagara"
  | "bennu"
  | "ryugu"
  | "arrokoth"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "pluto"
  | "eris"
  | "makemake"
  | "haumea"
  | "moon"
  | "phobos"
  | "deimos"
  | "io"
  | "europa"
  | "ganymede"
  | "callisto"
  | "amalthea"
  | "callirrhoe"
  | "themisto"
  | "himalia"
  | "elara"
  | "pasiphae"
  | "sinope"
  | "lysithea"
  | "carme"
  | "ananke"
  | "leda"
  | "megaclite"
  | "taygete"
  | "chaldene"
  | "harpalyke"
  | "kalyke"
  | "iocaste"
  | "erinome"
  | "isonoe"
  | "praxidike"
  | "autonoe"
  | "thyone"
  | "hermippe"
  | "aitne"
  | "eurydome"
  | "euanthe"
  | "euporie"
  | "orthosie"
  | "sponde"
  | "kale"
  | "pasithee"
  | "hegemone"
  | "mneme"
  | "aoede"
  | "thelxinoe"
  | "arche"
  | "kallichore"
  | "helike"
  | "carpo"
  | "eukelade"
  | "cyllene"
  | "kore"
  | "herse"
  | "s2010j1"
  | "s2010j2"
  | "s2010j3"
  | "s2010j4"
  | "s2010j5"
  | "s2010j6"
  | "dia"
  | "s2016j1"
  | "s2016j3"
  | "s2016j4"
  | "s2003j4"
  | "s2003j9"
  | "s2003j10"
  | "s2003j12"
  | "s2003j16"
  | "s2003j18"
  | "s2003j23"
  | "s2003j24"
  | "eirene"
  | "philophrosyne"
  | "s2017j1"
  | "eupheme"
  | "s2003j19"
  | "valetudo"
  | "s2017j2"
  | "s2017j3"
  | "pandia"
  | "s2017j5"
  | "s2017j6"
  | "s2017j7"
  | "s2017j8"
  | "s2017j9"
  | "ersa"
  | "s2011j1"
  | "s2003j2"
  | "s2018j2"
  | "s2018j3"
  | "s2018j4"
  | "s2018j5"
  | "s2011j2"
  | "s2011j3"
  | "s2011j4"
  | "s2011j5"
  | "s2011j6"
  | "s2021j1"
  | "s2021j2"
  | "s2021j3"
  | "s2021j4"
  | "s2021j5"
  | "s2021j6"
  | "s2021j7"
  | "s2021j8"
  | "s2022j1"
  | "s2022j2"
  | "s2022j3"
  | "s2024j1"
  | "s2017j10"
  | "s2017j11"
  | "s2017j12"
  | "s2017j13"
  | "s2017j14"
  | "s2017j15"
  | "s2017j16"
  | "s2017j17"
  | "s2017j18"
  | "thebe"
  | "adrastea"
  | "metis"
  | "mimas"
  | "enceladus"
  | "tethys"
  | "dione"
  | "rhea"
  | "titan"
  | "hyperion"
  | "iapetus"
  | "phoebe"
  | "ymir"
  | "suttungr"
  | "mundilfari"
  | "skathi"
  | "thrymr"
  | "narvi"
  | "aegir"
  | "bergelmir"
  | "bestla"
  | "farbauti"
  | "fenrir"
  | "fornjot"
  | "hati"
  | "hyrrokkin"
  | "kari"
  | "loge"
  | "skoll"
  | "surtur"
  | "jarnsaxa"
  | "greip"
  | "gridr"
  | "angrboda"
  | "skrymir"
  | "gerd"
  | "s2004s26"
  | "eggther"
  | "beli"
  | "gunnlod"
  | "thiazzi"
  | "s2004s34"
  | "alvaldi"
  | "geirrod"
  | "janus"
  | "epimetheus"
  | "helene"
  | "telesto"
  | "calypso"
  | "atlas"
  | "prometheus"
  | "pandora"
  | "pan"
  | "methone"
  | "pallene"
  | "polydeuces"
  | "daphnis"
  | "anthe"
  | "s2009s2"
  | "aegaeon"
  | "paaliaq"
  | "ijiraq"
  | "kiviuq"
  | "siarnaq"
  | "tarqeq"
  | "tarvos"
  | "albiorix"
  | "erriapus"
  | "bebhionn"
  | "s2004s7"
  | "s2004s12"
  | "s2004s13"
  | "s2004s17"
  | "s2004s21"
  | "s2004s24"
  | "s2004s28"
  | "s2004s29"
  | "s2004s31"
  | "s2004s36"
  | "s2004s37"
  | "s2004s39"
  | "s2004s40"
  | "s2004s41"
  | "s2004s42"
  | "s2004s43"
  | "s2004s44"
  | "s2004s45"
  | "s2004s46"
  | "s2004s47"
  | "s2004s48"
  | "s2004s49"
  | "s2004s50"
  | "s2004s51"
  | "s2004s52"
  | "s2004s53"
  | "s2004s54"
  | "s2004s55"
  | "s2004s56"
  | "s2004s57"
  | "s2004s58"
  | "s2004s59"
  | "s2004s60"
  | "s2004s61"
  | "s2005s4"
  | "s2005s5"
  | "s2005s6"
  | "s2005s7"
  | "s2006s1"
  | "s2006s3"
  | "s2006s9"
  | "s2006s10"
  | "s2006s11"
  | "s2006s12"
  | "s2006s13"
  | "s2006s14"
  | "s2006s15"
  | "s2006s16"
  | "s2006s17"
  | "s2006s18"
  | "s2006s19"
  | "s2006s20"
  | "s2006s21"
  | "s2006s22"
  | "s2006s23"
  | "s2006s24"
  | "s2006s25"
  | "s2006s26"
  | "s2006s27"
  | "s2006s28"
  | "s2006s29"
  | "s2007s2"
  | "s2007s3"
  | "s2007s5"
  | "s2007s6"
  | "s2007s7"
  | "s2007s8"
  | "s2007s9"
  | "s2007s10"
  | "s2007s11"
  | "s2019s1"
  | "s2019s2"
  | "s2019s3"
  | "s2019s4"
  | "s2019s5"
  | "s2019s6"
  | "s2019s7"
  | "s2019s8"
  | "s2019s9"
  | "s2019s10"
  | "s2019s11"
  | "s2019s12"
  | "s2019s13"
  | "s2019s14"
  | "s2019s15"
  | "s2019s16"
  | "s2019s17"
  | "s2019s18"
  | "s2019s19"
  | "s2019s20"
  | "s2019s21"
  | "s2019s22"
  | "s2019s23"
  | "s2019s24"
  | "s2019s25"
  | "s2019s26"
  | "s2019s27"
  | "s2019s28"
  | "s2019s29"
  | "s2019s30"
  | "s2019s31"
  | "s2019s32"
  | "s2019s33"
  | "s2019s34"
  | "s2019s35"
  | "s2019s36"
  | "s2019s37"
  | "s2019s38"
  | "s2019s39"
  | "s2019s40"
  | "s2019s41"
  | "s2019s42"
  | "s2019s43"
  | "s2019s44"
  | "s2020s1"
  | "s2020s2"
  | "s2020s3"
  | "s2020s4"
  | "s2020s5"
  | "s2020s6"
  | "s2020s7"
  | "s2020s8"
  | "s2020s9"
  | "s2020s10"
  | "s2020s11"
  | "s2020s12"
  | "s2020s13"
  | "s2020s14"
  | "s2020s15"
  | "s2020s16"
  | "s2020s17"
  | "s2020s18"
  | "s2020s19"
  | "s2020s20"
  | "s2020s21"
  | "s2020s22"
  | "s2020s23"
  | "s2020s24"
  | "s2020s25"
  | "s2020s26"
  | "s2020s27"
  | "s2020s28"
  | "s2020s29"
  | "s2020s30"
  | "s2020s31"
  | "s2020s32"
  | "s2020s33"
  | "s2020s34"
  | "s2020s35"
  | "s2020s36"
  | "s2020s37"
  | "s2020s38"
  | "s2020s39"
  | "s2020s40"
  | "s2020s41"
  | "s2020s42"
  | "s2020s43"
  | "s2020s44"
  | "s2020s45"
  | "s2020s46"
  | "s2020s47"
  | "s2020s48"
  | "s2020s49"
  | "s2023s1"
  | "s2023s2"
  | "s2023s3"
  | "s2023s4"
  | "s2023s5"
  | "s2023s6"
  | "s2023s7"
  | "s2023s8"
  | "s2023s9"
  | "s2023s10"
  | "s2023s11"
  | "s2023s12"
  | "s2023s13"
  | "s2023s14"
  | "s2023s15"
  | "s2023s16"
  | "s2023s17"
  | "s2023s18"
  | "s2023s19"
  | "s2023s20"
  | "s2023s21"
  | "s2023s22"
  | "s2023s23"
  | "s2023s24"
  | "s2023s25"
  | "s2023s26"
  | "s2023s27"
  | "s2023s28"
  | "s2023s29"
  | "s2023s30"
  | "s2023s31"
  | "s2023s32"
  | "s2023s33"
  | "s2023s34"
  | "s2023s35"
  | "s2023s36"
  | "s2023s37"
  | "s2023s38"
  | "s2023s39"
  | "s2023s40"
  | "s2023s41"
  | "s2023s42"
  | "s2023s43"
  | "s2023s44"
  | "s2023s45"
  | "s2023s46"
  | "s2023s47"
  | "s2023s48"
  | "s2023s49"
  | "s2023s50"
  | "s2023s51"
  | "s2023s52"
  | "s2023s53"
  | "s2023s54"
  | "s2023s55"
  | "s2023s56"
  | "s2023s57"
  | "s2023s58"
  | "s2023s59"
  | "s2023s60"
  | "s2023s61"
  | "s2023s62"
  | "s2023s63"
  | "ariel"
  | "umbriel"
  | "titania"
  | "oberon"
  | "miranda"
  | "cordelia"
  | "ophelia"
  | "bianca"
  | "cressida"
  | "desdemona"
  | "juliet"
  | "portia"
  | "rosalind"
  | "belinda"
  | "puck"
  | "perdita"
  | "mab"
  | "cupid"
  | "s2025u1"
  | "francisco"
  | "trinculo"
  | "sycorax"
  | "prospero"
  | "setebos"
  | "ferdinand"
  | "margaret"
  | "caliban"
  | "stephano"
  | "s2023u1"
  | "triton"
  | "naiad"
  | "thalassa"
  | "despina"
  | "galatea"
  | "larissa"
  | "proteus"
  | "hippocamp"
  | "nereid"
  | "sao"
  | "s2002n5"
  | "laomedeia"
  | "psamathe"
  | "neso"
  | "s2021n1"
  | "halimede"
  | "charon"
  | "nix"
  | "hydra"
  | "kerberos"
  | "styx"
  | "dysnomia"
  | "hiiaka"
  | "namaka"
  | "weywot"
  | "vanth"
  | "actaea"
  | "haunu"
  | "halley"
  | "encke"
  | "tempel1"
  | "borrelly"
  | "churyumovGerasimenko"
  | "wild2"
  | "hartley2"
  | "haleBopp"
  | "hyakutake"
  | "sidingSpring"
  | "lovejoy";

export type BodyPositionM = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};
