import astrometryFile from './generated/astrometry.json' with { type: 'json' };
import exoplanetFile from './generated/exoplanets.json' with { type: 'json' };
import { distance3 } from './coords.ts';
import { SOURCES } from './sources.ts';
import type {
  ConfirmedBody,
  FictionalLocation,
  SolarBody,
  SourceRef,
  StarSystemRecord,
  StellarComponent,
  SystemId,
  Verification,
} from './types.ts';

export interface AstrometryDataset {
  generatedBy: string;
  input: string;
  verification: Verification;
  retrieved: string | null;
  description: string;
  frame: 'ICRS';
  referenceEpoch: number;
  stars: StellarComponent[];
}

export interface ExoplanetDataset {
  generatedBy: string;
  input: string;
  verification: Verification;
  asOfDate: string;
  description: string;
  source: SourceRef;
  planets: ConfirmedBody[];
}

export const ASTROMETRY = astrometryFile as unknown as AstrometryDataset;
export const EXOPLANETS = exoplanetFile as unknown as ExoplanetDataset;

/** Solar System bodies shown in the information view. Names per NASA's planet reference. */
export const SOLAR_BODIES: readonly SolarBody[] = [
  { id: 'sun', name: 'Sun', kind: 'star', source: SOURCES.nasaPlanets },
  { id: 'mercury', name: 'Mercury', kind: 'terrestrial planet', order: 1, source: SOURCES.nasaPlanets },
  { id: 'venus', name: 'Venus', kind: 'terrestrial planet', order: 2, source: SOURCES.nasaPlanets },
  { id: 'earth', name: 'Earth', kind: 'terrestrial planet', order: 3, source: SOURCES.nasaPlanets },
  { id: 'mars', name: 'Mars', kind: 'terrestrial planet', order: 4, source: SOURCES.nasaPlanets },
  { id: 'jupiter', name: 'Jupiter', kind: 'gas giant', order: 5, source: SOURCES.nasaPlanets },
  { id: 'saturn', name: 'Saturn', kind: 'gas giant', order: 6, source: SOURCES.nasaPlanets },
  { id: 'uranus', name: 'Uranus', kind: 'ice giant', order: 7, source: SOURCES.nasaPlanets },
  { id: 'neptune', name: 'Neptune', kind: 'ice giant', order: 8, source: SOURCES.nasaPlanets },
  { id: 'moon', name: 'Moon', kind: 'moon', source: SOURCES.nasaMoon },
];

const LOCATIONS: readonly FictionalLocation[] = [
  {
    id: 'earth-port',
    name: 'Halcyon Ring',
    systemId: 'sol',
    kind: 'port',
    fictional: true,
    status: 'functional',
    factionId: 'sta',
    description:
      'A spun habitat ring in high Earth orbit and the busiest civilian port in Sol. Independent haulers pick up their first contracts here.',
    services: ['market', 'repair', 'equipment', 'contracts'],
    nearBodyId: 'earth',
  },
  {
    id: 'mars-depot',
    name: 'Deimos Depot',
    systemId: 'sol',
    kind: 'depot',
    fictional: true,
    status: 'functional',
    factionId: 'sta',
    description:
      'Customs and refit depot parked near Mars. Every interstellar departure from Sol is cleared here.',
    services: ['market', 'repair', 'equipment', 'contracts', 'jump-clearance'],
    nearBodyId: 'mars',
  },
  {
    id: 'luna-freeport',
    name: 'Luna Freeport',
    systemId: 'sol',
    kind: 'port',
    fictional: true,
    status: 'planned',
    factionId: 'sta',
    description: 'Planned lunar trade port. Not yet open to traffic.',
    services: [],
    nearBodyId: 'moon',
  },
  {
    id: 'ganymede-yards',
    name: 'Ganymede Yards',
    systemId: 'sol',
    kind: 'depot',
    fictional: true,
    status: 'planned',
    factionId: 'sta',
    description: 'Planned shipyard in the Jupiter system. Not yet open to traffic.',
    services: [],
    nearBodyId: 'jupiter',
  },
  {
    id: 'meridian-outpost',
    name: 'Meridian Outpost',
    systemId: 'alpha-centauri',
    kind: 'outpost',
    fictional: true,
    status: 'functional',
    factionId: 'frontier',
    description:
      'Frontier Cooperative research outpost holding station near Proxima Centauri b. It studies the planet from orbit and depends on supply runs from Sol.',
    services: ['market', 'repair', 'equipment', 'contracts'],
    nearBodyId: 'proxima-cen-b',
  },
  {
    id: 'toliman-survey',
    name: 'Toliman Survey Station',
    systemId: 'alpha-centauri',
    kind: 'platform',
    fictional: true,
    status: 'planned',
    factionId: 'frontier',
    description: 'Planned observatory between Alpha Centauri A and B. Not yet built.',
    services: [],
  },
  {
    id: 'barnard-relay',
    name: 'Barnard Transit Relay',
    systemId: 'barnard',
    kind: 'relay',
    fictional: true,
    status: 'functional',
    factionId: 'sta',
    description:
      'A small fuel and message relay on the northern route out of Sol, kept running by a skeleton Transit Authority crew.',
    services: ['market', 'repair', 'contracts'],
  },
  {
    id: 'sirius-platform',
    name: 'Horizon Platform',
    systemId: 'sirius',
    kind: 'platform',
    fictional: true,
    status: 'functional',
    factionId: 'frontier',
    description:
      'Orbital research platform observing the white dwarf Sirius B from behind heavy radiation shielding.',
    services: ['market', 'repair', 'equipment', 'contracts'],
  },
  {
    id: 'eridani-hub',
    name: 'Eridani Mining Hub',
    systemId: 'epsilon-eridani',
    kind: 'hub',
    fictional: true,
    status: 'functional',
    factionId: 'frontier',
    description:
      'Mining hub anchored in the inner debris belt, refining ice and metals for the frontier settlements.',
    services: ['market', 'repair', 'equipment', 'contracts'],
  },
];

interface CuratedSystem {
  id: SystemId;
  displayName: string;
  referenceComponentId: string | null;
  componentIds: string[];
  jumpLinks: SystemId[];
  summary: string;
  scienceFacts: StarSystemRecord['scienceFacts'];
  fiction: string;
}

const CURATED: readonly CuratedSystem[] = [
  {
    id: 'sol',
    displayName: 'Sol',
    referenceComponentId: null,
    componentIds: ['sun'],
    jumpLinks: ['alpha-centauri', 'barnard', 'sirius'],
    summary: 'The Sun and its eight planets: the Solar System.',
    scienceFacts: [
      {
        text: 'The Solar System has eight planets. Mercury, Venus, Earth and Mars are terrestrial planets; Jupiter and Saturn are gas giants; Uranus and Neptune are ice giants.',
        dataClass: 'observed',
        source: SOURCES.nasaPlanets,
      },
      {
        text: 'In flight, planet sizes, colours and orbital spacing are schematic, and planet positions do not match today’s sky.',
        dataClass: 'estimated',
        source: SOURCES.nasaPlanets,
      },
    ],
    fiction:
      'Home of the Sol Transit Authority. Earth’s Halcyon Ring is the busiest civilian port; Deimos Depot clears ships for interstellar departure.',
  },
  {
    id: 'alpha-centauri',
    displayName: 'Alpha Centauri',
    referenceComponentId: 'alpha-centauri-a',
    componentIds: ['alpha-centauri-a', 'alpha-centauri-b', 'proxima-centauri'],
    jumpLinks: ['sol', 'barnard'],
    summary: 'A triple star system: the Alpha Centauri A/B pair and the distant red dwarf Proxima Centauri.',
    scienceFacts: [
      {
        text: 'Alpha Centauri is a triple star system. Alpha Centauri A and B form a close binary pair; Proxima Centauri, a small red dwarf, is a more distant third member.',
        dataClass: 'observed',
        source: SOURCES.nasaAlphaCentauri,
      },
      {
        text: 'Proxima Centauri is the closest known star to the Sun.',
        dataClass: 'observed',
        source: SOURCES.nasaAlphaCentauri,
      },
      {
        text: 'The bundled NASA Exoplanet Archive snapshot lists no confirmed planets around Alpha Centauri A or B.',
        dataClass: 'observed',
        source: SOURCES.exoplanetArchive,
      },
      {
        text: 'Proxima Centauri b is a confirmed planet. Its surface, atmosphere and habitability have not been observed; the in-game globe is an artist’s impression.',
        dataClass: 'observed',
        source: SOURCES.nasaProximaB,
      },
    ],
    fiction:
      'First stop beyond Sol. The Frontier Cooperative’s Meridian Outpost studies Proxima b from orbit and depends on supply runs.',
  },
  {
    id: 'barnard',
    displayName: 'Barnard’s Star',
    referenceComponentId: 'barnards-star',
    componentIds: ['barnards-star'],
    jumpLinks: ['sol', 'alpha-centauri'],
    summary: 'A single red dwarf with small, close-in confirmed planets.',
    scienceFacts: [
      {
        text: 'Barnard’s Star is a single red dwarf about six light-years from the Sun.',
        dataClass: 'observed',
        source: SOURCES.nasaBarnard,
      },
      {
        text: 'Astronomers confirmed four small planets orbiting Barnard’s Star in 2025. All four circle the star in just a few days, far closer than Mercury is to the Sun.',
        dataClass: 'observed',
        source: SOURCES.nasaBarnard,
      },
    ],
    fiction: 'A quiet relay stop on the northern route, kept running by the Transit Authority.',
  },
  {
    id: 'sirius',
    displayName: 'Sirius',
    referenceComponentId: 'sirius-a',
    componentIds: ['sirius-a', 'sirius-b'],
    jumpLinks: ['sol', 'epsilon-eridani'],
    summary: 'A binary: the brilliant Sirius A and its white dwarf companion Sirius B.',
    scienceFacts: [
      {
        text: 'Sirius is the brightest star in Earth’s night sky. It is a binary system: Sirius A and a faint white dwarf companion, Sirius B.',
        dataClass: 'observed',
        source: SOURCES.nasaSirius,
      },
      {
        text: 'The bundled NASA Exoplanet Archive snapshot lists no confirmed planets around Sirius.',
        dataClass: 'observed',
        source: SOURCES.exoplanetArchive,
      },
    ],
    fiction: 'Horizon Platform observes the white dwarf from behind heavy radiation shielding.',
  },
  {
    id: 'epsilon-eridani',
    displayName: 'Epsilon Eridani',
    referenceComponentId: 'epsilon-eridani',
    componentIds: ['epsilon-eridani'],
    jumpLinks: ['sirius'],
    summary: 'A young orange dwarf with debris belts and a confirmed giant planet.',
    scienceFacts: [
      {
        text: 'Epsilon Eridani is a young star surrounded by belts of debris. Observations with NASA’s SOFIA observatory showed a layout of belts and a giant planet that resembles our own Solar System.',
        dataClass: 'observed',
        source: SOURCES.nasaEpsilonEridani,
      },
      {
        text: 'In flight, the debris belts are drawn schematically; individual asteroids are illustrative.',
        dataClass: 'estimated',
        source: SOURCES.nasaEpsilonEridani,
      },
    ],
    fiction: 'Miners work the inner debris belt from the Eridani Mining Hub.',
  },
];

const componentIndex = new Map<string, StellarComponent>(ASTROMETRY.stars.map((s) => [s.id, s]));

export function getComponent(id: string): StellarComponent | undefined {
  return componentIndex.get(id);
}

function buildSystem(c: CuratedSystem): StarSystemRecord {
  const ref = c.referenceComponentId ? componentIndex.get(c.referenceComponentId) : undefined;
  if (c.referenceComponentId && !ref) {
    throw new Error(`System ${c.id} references missing component ${c.referenceComponentId}`);
  }
  const hostIds = new Set(c.componentIds);
  return {
    id: c.id,
    displayName: c.displayName,
    catalogId: ref
      ? (ref.catalogIds.gaiaDr3 ?? ref.catalogIds.hip ?? ref.catalogIds.simbad ?? ref.id)
      : 'Sun',
    raDegrees: ref ? ref.raDegrees : null,
    decDegrees: ref ? ref.decDegrees : null,
    distanceLightYears: ref ? ref.distanceLightYears : 0,
    referenceEpoch: ref ? ref.referenceEpoch : null,
    positionSourceUrl: ref ? ref.astrometrySource.url : null,
    positionLy: ref ? ref.positionLy : [0, 0, 0],
    componentIds: c.componentIds,
    confirmedBodies: EXOPLANETS.planets.filter((p) => hostIds.has(p.hostId)),
    fictionalLocations: LOCATIONS.filter((l) => l.systemId === c.id),
    jumpLinks: c.jumpLinks,
    summary: c.summary,
    scienceFacts: c.scienceFacts,
    fiction: c.fiction,
  };
}

export const SYSTEMS: readonly StarSystemRecord[] = CURATED.map(buildSystem);

const systemIndex = new Map<SystemId, StarSystemRecord>(SYSTEMS.map((s) => [s.id, s]));

export function getSystem(id: SystemId): StarSystemRecord {
  const s = systemIndex.get(id);
  if (!s) throw new Error(`Unknown system ${id}`);
  return s;
}

export function componentsOf(systemId: SystemId): StellarComponent[] {
  return ASTROMETRY.stars.filter((s) => s.systemId === systemId);
}

export const ALL_LOCATIONS: readonly FictionalLocation[] = LOCATIONS;

export function getLocation(id: string): FictionalLocation {
  const loc = LOCATIONS.find((l) => l.id === id);
  if (!loc) throw new Error(`Unknown location ${id}`);
  return loc;
}

export function getPlanet(id: string): ConfirmedBody | undefined {
  return EXOPLANETS.planets.find((p) => p.id === id);
}

/** Straight-line distance between two systems' reference positions, light-years. */
export function systemDistance(a: SystemId, b: SystemId): number {
  return distance3(getSystem(a).positionLy, getSystem(b).positionLy);
}

/** True when any bundled record is still a provisional transcription. */
export function hasProvisionalData(): boolean {
  return ASTROMETRY.verification === 'provisional' || EXOPLANETS.verification === 'provisional';
}
