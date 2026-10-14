/** Vite-resolved texture URLs keyed by asset basename (matches server catalog JSON). */

import earthAtmosphereAlphaUrl from "../assets/planets/earth/earth-atmosphere-alpha.jpg";
import earthAtmosphereMapUrl from "../assets/planets/earth/earth-atmosphere.jpg";
import earthBumpMapUrl from "../assets/planets/earth/earth-bump-map.jpg";
import earthMapUrl from "../assets/planets/earth/earth-map.jpg";
import earthSpecMapUrl from "../assets/planets/earth/earth-spec-map.png";
import moonBumpMapUrl from "../assets/planets/earth/moon/moon-bump-map.jpg";
import moonMapUrl from "../assets/planets/earth/moon/moon-map.jpg";
import jupiterMapUrl from "../assets/planets/jupiter/jupiter-map.jpg";
import jupiterRingTextureUrl from "../assets/planets/jupiter/jupiter-ring-texture.png";
import callistoMapUrl from "../assets/planets/jupiter/callisto/callisto-map.jpg";
import europaMapUrl from "../assets/planets/jupiter/europa/europa-map.jpg";
import ganymedeBumpMapUrl from "../assets/planets/jupiter/ganymede/ganymede-bump-map.jpg";
import ganymedeMapUrl from "../assets/planets/jupiter/ganymede/ganymede-map.jpg";
import ioMapUrl from "../assets/planets/jupiter/io/io-map.jpg";
import marsBumpMapUrl from "../assets/planets/mars/mars-bump-map.jpg";
import marsMapUrl from "../assets/planets/mars/mars-map.jpg";
import deimosBumpMapUrl from "../assets/planets/mars/deimos/deimos-bump-map.jpg";
import deimosMapUrl from "../assets/planets/mars/deimos/deimos-map.jpg";
import phobosBumpMapUrl from "../assets/planets/mars/phobos/phobos-bump-map.jpg";
import phobosMapUrl from "../assets/planets/mars/phobos/phobos-map.jpg";
import mercuryBumpMapUrl from "../assets/planets/mercury/mercury-bump-map.jpg";
import mercuryMapUrl from "../assets/planets/mercury/mercury-map.jpg";
import neptuneMapUrl from "../assets/planets/neptune/neptune-map.jpg";
import neptuneRingTextureUrl from "../assets/planets/neptune/neptune-ring-texture.png";
import tritonMapUrl from "../assets/planets/neptune/triton/triton-map.jpg";
import saturnMapUrl from "../assets/planets/saturn/saturn-map.jpg";
import saturnRingTextureUrl from "../assets/planets/saturn/saturn-ring-texture.png";
import dioneMapUrl from "../assets/planets/saturn/dione/dione-map.jpg";
import enceladusMapUrl from "../assets/planets/saturn/enceladus/enceladus-map.jpg";
import iapetusMapUrl from "../assets/planets/saturn/iapetus/iapetus-map.jpg";
import mimasMapUrl from "../assets/planets/saturn/mimas/mimas-map.jpg";
import rheaMapUrl from "../assets/planets/saturn/rhea/rhea-map.jpg";
import tethysMapUrl from "../assets/planets/saturn/tethys/tethys-map.jpg";
import titanMapUrl from "../assets/planets/saturn/titan/titan-map.jpg";
import uranusMapUrl from "../assets/planets/uranus/uranus-map.jpg";
import uranusRingTextureUrl from "../assets/planets/uranus/uranus-ring-texture.png";
import arielMapUrl from "../assets/planets/uranus/ariel/ariel-map.jpg";
import oberonMapUrl from "../assets/planets/uranus/oberon/oberon-map.jpg";
import titaniaMapUrl from "../assets/planets/uranus/titania/titania-map.jpg";
import venusAtmosphereAlphaUrl from "../assets/planets/venus/venus-atmosphere-alpha.jpg";
import venusAtmosphereMapUrl from "../assets/planets/venus/venus-atmosphere.jpg";
import venusBumpMapUrl from "../assets/planets/venus/venus-bump-map.jpg";
import venusMapUrl from "../assets/planets/venus/venus-map.jpg";
import ceresMapUrl from "../assets/dwarfs/ceres/ceres-map.png";
import erisMapUrl from "../assets/dwarfs/eris/eris-map.jpg";
import haumeaMapUrl from "../assets/dwarfs/haumea/haumea-map.jpg";
import makemakeMapUrl from "../assets/dwarfs/makemake/makemake-map.jpg";
import plutoMapUrl from "../assets/dwarfs/pluto/pluto-map.jpg";
import sunMapUrl from "../assets/stars/sun/sun-map.jpg";
import sunSpecMapUrl from "../assets/stars/sun/sun-spec-map.jpg";
import trappist1MapUrl from "../assets/stars/trappist1/trappist1-map.jpg";
import trappist1bBumpMapUrl from "../assets/trappist1/b/trappist1b-bump-map.png";
import trappist1bMapUrl from "../assets/trappist1/b/trappist1b-map.png";
import trappist1cBumpMapUrl from "../assets/trappist1/c/trappist1c-bump-map.png";
import trappist1cMapUrl from "../assets/trappist1/c/trappist1c-map.png";
import trappist1dBumpMapUrl from "../assets/trappist1/d/trappist1d-bump-map.png";
import trappist1fBumpMapUrl from "../assets/trappist1/f/trappist1f-bump-map.png";
import trappist1fMapUrl from "../assets/trappist1/f/trappist1f-map.png";
import trappist1gMapUrl from "../assets/trappist1/g/trappist1g-map.png";
import trappist1hMapUrl from "../assets/trappist1/h/trappist1h-map.jpg";

export const TEXTURE_BY_KEY: Record<string, string> = {
  "earth-atmosphere-alpha.jpg": earthAtmosphereAlphaUrl,
  "earth-atmosphere.jpg": earthAtmosphereMapUrl,
  "earth-bump-map.jpg": earthBumpMapUrl,
  "earth-map.jpg": earthMapUrl,
  "earth-spec-map.png": earthSpecMapUrl,
  "jupiter-map.jpg": jupiterMapUrl,
  "jupiter-ring-texture.png": jupiterRingTextureUrl,
  "mars-bump-map.jpg": marsBumpMapUrl,
  "mars-map.jpg": marsMapUrl,
  "mercury-bump-map.jpg": mercuryBumpMapUrl,
  "mercury-map.jpg": mercuryMapUrl,
  "moon-bump-map.jpg": moonBumpMapUrl,
  "moon-map.jpg": moonMapUrl,
  "neptune-map.jpg": neptuneMapUrl,
  "neptune-ring-texture.png": neptuneRingTextureUrl,
  "phobos-bump-map.jpg": phobosBumpMapUrl,
  "phobos-map.jpg": phobosMapUrl,
  "deimos-bump-map.jpg": deimosBumpMapUrl,
  "deimos-map.jpg": deimosMapUrl,
  "io-map.jpg": ioMapUrl,
  "europa-map.jpg": europaMapUrl,
  "ganymede-bump-map.jpg": ganymedeBumpMapUrl,
  "ganymede-map.jpg": ganymedeMapUrl,
  "callisto-map.jpg": callistoMapUrl,
  "ceres-map.png": ceresMapUrl,
  "mimas-map.jpg": mimasMapUrl,
  "enceladus-map.jpg": enceladusMapUrl,
  "tethys-map.jpg": tethysMapUrl,
  "dione-map.jpg": dioneMapUrl,
  "rhea-map.jpg": rheaMapUrl,
  "titan-map.jpg": titanMapUrl,
  "iapetus-map.jpg": iapetusMapUrl,
  "triton-map.jpg": tritonMapUrl,
  "pluto-map.jpg": plutoMapUrl,
  "eris-map.jpg": erisMapUrl,
  "makemake-map.jpg": makemakeMapUrl,
  "haumea-map.jpg": haumeaMapUrl,
  "saturn-map.jpg": saturnMapUrl,
  "saturn-ring-texture.png": saturnRingTextureUrl,
  "sun-map.jpg": sunMapUrl,
  "sun-spec-map.jpg": sunSpecMapUrl,
  "trappist1-map.jpg": trappist1MapUrl,
  "trappist1b-map.png": trappist1bMapUrl,
  "trappist1b-bump-map.png": trappist1bBumpMapUrl,
  "trappist1c-map.png": trappist1cMapUrl,
  "trappist1c-bump-map.png": trappist1cBumpMapUrl,
  "trappist1d-bump-map.png": trappist1dBumpMapUrl,
  "trappist1f-map.png": trappist1fMapUrl,
  "trappist1f-bump-map.png": trappist1fBumpMapUrl,
  "trappist1g-map.png": trappist1gMapUrl,
  "trappist1h-map.jpg": trappist1hMapUrl,
  "uranus-map.jpg": uranusMapUrl,
  "uranus-ring-texture.png": uranusRingTextureUrl,
  "ariel-map.jpg": arielMapUrl,
  "oberon-map.jpg": oberonMapUrl,
  "titania-map.jpg": titaniaMapUrl,
  "venus-atmosphere-alpha.jpg": venusAtmosphereAlphaUrl,
  "venus-atmosphere.jpg": venusAtmosphereMapUrl,
  "venus-bump-map.jpg": venusBumpMapUrl,
  "venus-map.jpg": venusMapUrl,
};

export function resolveTextureKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const url = TEXTURE_BY_KEY[key];
  if (!url) {
    console.warn(`Unknown texture key "${key}"`);
    return undefined;
  }
  return url;
}
