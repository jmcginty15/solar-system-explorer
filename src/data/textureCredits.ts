/**
 * Texture provenance grouped by source domain
 * (byte/hash matches + Google Lens reverse image search).
 */

export type TextureCreditGroup = {
  id: string;
  domain: string;
  url?: string;
  items: string[];
};

export const TEXTURE_CREDIT_GROUPS: TextureCreditGroup[] = [
  {
    id: "sss",
    domain: "solarsystemscope.com",
    url: "https://www.solarsystemscope.com/textures/",
    items: [
      "Earth (day, specular, bump)",
      "Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune",
      "Venus atmosphere",
      "Eris, Haumea, Makemake",
      "TRAPPIST-1 star (SSS Sun map)",
    ],
  },
  {
    id: "nasa-svs",
    domain: "svs.gsfc.nasa.gov",
    url: "https://svs.gsfc.nasa.gov/4851/",
    items: ["Sky / starfield (Deep Star Maps 2020)"],
  },
  {
    id: "x3dom",
    domain: "x3dom.org",
    url: "https://www.x3dom.org/x3dom/example/texture/solarSystem/",
    items: ["Sun"],
  },
  {
    id: "deviantart",
    domain: "deviantart.com",
    url: "https://www.deviantart.com/greaterhtrae/art/Ceres-map-2k-v2-1110771260",
    items: [
      "Ceres (greaterhtrae)",
      "Earth clouds (Universepulse / similar DA packs)",
      "TRAPPIST-1 planets (speculative DA maps; TRAPPIST-1h reuses Europa)",
    ],
  },
  {
    id: "stevealbers",
    domain: "stevealbers.net",
    url: "https://stevealbers.net/albers/sos/sos.html",
    items: [
      "Europa, Io, Enceladus, and other moon maps (Albers pack / redistributions)",
    ],
  },
  {
    id: "bjj",
    domain: "bjj.mmedia.is",
    url: "https://bjj.mmedia.is/planetary_maps.html",
    items: ["Europa, Io, Callisto (Björn Jónsson map lineage)"],
  },
  {
    id: "usgs-clem",
    domain: "usgs.gov / commons.wikimedia.org",
    url: "https://commons.wikimedia.org/wiki/File:Moonmap_from_clementine_data.png",
    items: ["Moon (Clementine)"],
  },
  {
    id: "nasa-jpl",
    domain: "nasa.gov / jpl.nasa.gov",
    url: "https://photojournal.jpl.nasa.gov/",
    items: [
      "Pluto (New Horizons)",
      "Titan, Phobos, and other spacecraft mosaics",
      "Planetary rings",
    ],
  },
];
