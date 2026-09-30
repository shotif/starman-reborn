import type { SourceRef } from './types.ts';

/** Reference pages cited by science cards. */
export const SOURCES = {
  nasaAlphaCentauri: {
    label: 'NASA: Alpha Centauri, an exotic 3-star system',
    url: 'https://science.nasa.gov/exoplanets/other-stars-other-worlds/our-nearest-celestial-neighbor-an-exotic-3-star-system/',
  },
  nasaProximaB: {
    label: 'NASA exoplanet catalog: Proxima Centauri b',
    url: 'https://science.nasa.gov/exoplanet-catalog/proxima-centauri-b/',
  },
  nasaPlanets: {
    label: 'NASA: Planets of the Solar System',
    url: 'https://science.nasa.gov/solar-system/planets/',
  },
  nasaMoon: {
    label: "NASA: Earth's Moon",
    url: 'https://science.nasa.gov/moon/',
  },
  nasaBarnard: {
    label: "NASA: Four little planets around Barnard's Star",
    url: 'https://science.nasa.gov/universe/exoplanets/discovery-alert-four-little-planets-one-big-step/',
  },
  nasaSirius: {
    label: 'NASA/Hubble: Sirius A and Sirius B',
    url: 'https://science.nasa.gov/asset/hubble/an-artists-impression-of-sirius-a-and-sirius-b-annotated/',
  },
  nasaEpsilonEridani: {
    label: 'NASA: SOFIA observations of Epsilon Eridani',
    url: 'https://science.nasa.gov/universe/exoplanets/sofia-confirms-nearby-planetary-system-is-similar-to-our-own/',
  },
  exoplanetArchive: {
    label: 'NASA Exoplanet Archive',
    url: 'https://exoplanetarchive.ipac.caltech.edu/',
  },
  hyg: {
    label: 'HYG star database v4.0 (CC BY-SA 4.0)',
    url: 'https://github.com/astronexus/HYG-Database/tree/main/hyg/CURRENT',
  },
  openExoplanetCatalogue: {
    label: 'Open Exoplanet Catalogue',
    url: 'https://github.com/OpenExoplanetCatalogue/open_exoplanet_catalogue',
  },
  jplApproxPositions: {
    label: 'JPL: Approximate Positions of the Planets',
    url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html',
  },
  gaiaArchive: {
    label: 'ESA Gaia archive',
    url: 'https://gea.esac.esa.int/archive/',
  },
} as const satisfies Record<string, SourceRef>;
