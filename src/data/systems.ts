import coreSeedsFile from '../content/world/core-seeds.json' with { type: 'json' };
import { generateWorld } from '../content/world/generate.ts';
import { GROWTH, WORLD_SEED } from '../content/world/rules.ts';
import type { GeneratedStation, StationType, SystemSeed, WorldResult } from '../content/world/types.ts';
import astrometryFile from './generated/astrometry.json' with { type: 'json' };
import beltsFile from './generated/belts.json' with { type: 'json' };
import catalogSystemsFile from './generated/catalog-systems.json' with { type: 'json' };
import exoplanetFile from './generated/exoplanets.json' with { type: 'json' };
import { distance3 } from './coords.ts';
import { SOURCES } from './sources.ts';
import type {
  BeltRecord,
  ConfirmedBody,
  FictionalLocation,
  LocationKind,
  ScienceFact,
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
        text: 'In flight, the planets sit in their real directions from the Sun on the game date, worked out from JPL’s approximate positions of the planets; their sizes, colours and spacing are schematic.',
        dataClass: 'estimated',
        source: SOURCES.jplApproxPositions,
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

// ---------------------------------------------------------------- catalogue systems and the generated world

interface CatalogSystemEntry {
  id: SystemId;
  displayName: string;
  referenceComponentId: string;
  componentIds: string[];
  /** How the system entered the game: the first catalogue (HYG), or the sky snapshot that added it. */
  addedBy?: string;
}

/** Systems extracted from the HYG and Open Exoplanet catalogues (scripts/extract-catalogs.ts), and those the sky snapshot added. */
const CATALOG_SYSTEMS = (catalogSystemsFile as unknown as { systems: CatalogSystemEntry[] }).systems;

/** Stars the sky snapshot found in the hand-made systems (appended to their components). */
const CURATED_ADDITIONS = (catalogSystemsFile as unknown as { additions?: Record<string, string[]> }).additions ?? {};

function seedFor(id: SystemId, name: string, componentIds: readonly string[], referenceId: string | null, curated: SystemSeed['curated']): SystemSeed {
  const ref = referenceId ? componentIndex.get(referenceId) : undefined;
  const hostIds = new Set(componentIds);
  const stars = componentIds.flatMap((cid) => {
    if (cid === 'sun') return [{ id: 'sun', name: 'Sun', spectralType: 'G2V', colorHex: '#fff4e0' }];
    const c = componentIndex.get(cid);
    return c ? [{ id: c.id, name: c.name, spectralType: c.spectralType, colorHex: c.colorHex }] : [];
  });
  const planets = EXOPLANETS.planets
    .filter((p) => hostIds.has(p.hostId))
    .map((p) => ({
      id: p.id,
      name: p.displayName,
      hostId: p.hostId,
      ...(p.massEarth ? { massEarth: p.massEarth.value } : {}),
      ...(p.semiMajorAxisAu ? { semiMajorAxisAu: p.semiMajorAxisAu.value } : {}),
    }));
  return { id, name, positionLy: ref ? ref.positionLy : [0, 0, 0], stars, planets, ...(curated ? { curated } : {}) };
}

/**
 * The frozen core (docs/PROCGEN.md §7.6): the 32 systems as the first catalogue gave them. The core
 * world is generated from these, never from the current dataset, so better astronomy never moves a
 * station, lane or owner.
 */
export const CORE_SEEDS: readonly SystemSeed[] = (coreSeedsFile as unknown as { systems: SystemSeed[] }).systems;

const CORE_IDS = new Set(CORE_SEEDS.map((s) => s.id));

/** Systems added since, from the verified dataset: the world grows around the core. */
export const GROWTH_SEEDS: readonly SystemSeed[] = CATALOG_SYSTEMS.filter((e) => !CORE_IDS.has(e.id)).map((e) =>
  seedFor(e.id, e.displayName, e.componentIds, e.referenceComponentId, undefined),
);

/** What the world generator is given, for the guardrails: every system's stars and planets. */
export const WORLD_SEEDS: readonly SystemSeed[] = [...CORE_SEEDS, ...GROWTH_SEEDS];

/** The generated world: jump lanes, stations, owners and security (src/content/world/). */
export const WORLD: WorldResult = generateWorld(CORE_SEEDS, WORLD_SEED, GROWTH_SEEDS);

const FRONTIER = new Set(GROWTH_SEEDS.filter((s) => Math.hypot(...s.positionLy) > GROWTH.frontierLy).map((s) => s.id));

/** Systems of the frontier (new systems beyond GROWTH.frontierLy): lanes to them need a long-range jump drive. */
export function isFrontier(systemId: SystemId): boolean {
  return FRONTIER.has(systemId);
}

/** True when a lane needs the long-range jump drive (either end is in the frontier). */
export function laneNeedsDrive(a: SystemId, b: SystemId): boolean {
  return FRONTIER.has(a) || FRONTIER.has(b);
}

/** Systems the sky snapshot added (not in the first catalogue). */
export function isNewSystem(systemId: SystemId): boolean {
  return !CORE_IDS.has(systemId);
}

const KIND_OF: Record<StationType, LocationKind> = {
  'trade-port': 'port',
  'customs-depot': 'depot',
  shipyard: 'depot',
  'mining-outpost': 'outpost',
  refinery: 'hub',
  factory: 'hub',
  'agri-station': 'platform',
  'research-station': 'platform',
  relay: 'relay',
  'military-base': 'depot',
  freeport: 'port',
  'pirate-den': 'outpost',
};

function toLocation(g: GeneratedStation): FictionalLocation {
  return {
    id: g.id,
    name: g.name,
    systemId: g.systemId,
    kind: KIND_OF[g.type],
    fictional: true,
    status: 'functional',
    ...(g.owner !== 'independent' ? { factionId: g.owner } : {}),
    description: g.description,
    services: [...g.services],
    nearBodyId: g.anchorId,
    stationType: g.type,
    look: g.look,
    ...(g.dockable ? {} : { dockable: false }),
  };
}

const ALL: readonly FictionalLocation[] = [...LOCATIONS, ...WORLD.stations.map(toLocation)];

function buildSystem(curated: CuratedSystem): StarSystemRecord {
  const c = { ...curated, componentIds: [...curated.componentIds, ...(CURATED_ADDITIONS[curated.id] ?? [])] };
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
    fictionalLocations: ALL.filter((l) => l.systemId === c.id),
    jumpLinks: [...(WORLD.links.get(c.id) ?? c.jumpLinks)],
    summary: c.summary,
    scienceFacts: c.scienceFacts,
    fiction: c.fiction,
  };
}

const CLASS_WORD: Record<string, string> = {
  O: 'blue star',
  B: 'blue-white star',
  A: 'white star',
  F: 'yellow-white star',
  G: 'yellow dwarf',
  K: 'orange dwarf',
  M: 'red dwarf',
  D: 'white dwarf',
};

/** "red dwarf" for "dM5.5e", "white dwarf" for "DA2" (from the catalogued spectral type). */
export function starKindWord(spectralType: string): string {
  const s = spectralType.trim().toUpperCase();
  const cls = /^D[ABCOQZX]/.test(s) || s === 'DG' ? 'D' : (s.replace(/^(SD|D)(?=[OBAFGKM])/, '')[0] ?? '');
  return CLASS_WORD[cls] ?? 'star';
}

const COUNT_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

/** Summary and science facts written only from catalogue fields (numbers and names come from the data). */
function describeCatalogSystem(e: CatalogSystemEntry, comps: readonly StellarComponent[], planets: readonly ConfirmedBody[]): { summary: string; facts: ScienceFact[] } {
  const ref = comps[0]!;
  const stars = comps.map((c) => `${c.name} (${c.spectralType === 'unknown' ? 'spectral type not catalogued' : c.spectralType})`);
  const kind =
    comps.length === 1
      ? `A single ${starKindWord(ref.spectralType)}`
      : `${comps.length === 2 ? 'A binary' : `A ${COUNT_WORD[comps.length] ?? comps.length}-star system`}: ${comps.map((c) => `${c.name}, a ${starKindWord(c.spectralType)}`).join('; ')}`;
  const confirmed = planets.filter((p) => p.status === 'confirmed');
  const others = planets.filter((p) => p.status !== 'confirmed');
  const planetText = confirmed.length
    ? ` with ${COUNT_WORD[confirmed.length] ?? confirmed.length} confirmed planet${confirmed.length === 1 ? '' : 's'}`
    : others.length
      ? ` with ${COUNT_WORD[others.length] ?? others.length} planet${others.length === 1 ? '' : 's'} not confirmed by the archives`
      : '';
  // Cite where the position really came from: Gaia DR3 or SIMBAD after the sky snapshot, HYG before it.
  const posRef = (c: StellarComponent): SourceRef => (c.verification === 'snapshot' ? c.astrometrySource : { ...SOURCES.hyg, ...(c.astrometrySource.recordId ? { recordId: c.astrometrySource.recordId } : {}) });
  const planetSource = planets.some((p) => p.verification === 'snapshot') ? SOURCES.exoplanetArchive : SOURCES.openExoplanetCatalogue;
  const facts: ScienceFact[] = [
    {
      text: `${e.displayName} lies about ${ref.distanceLightYears.toFixed(1)} light-years from the Sun.`,
      dataClass: 'observed',
      source: posRef(ref),
    },
    {
      text: `${comps.length === 1 ? 'Star' : 'Stars'}: ${stars.join(', ')}.`,
      dataClass: 'observed',
      source: ref.spectralTypeSource,
    },
    confirmed.length
      ? {
          text: `Confirmed planets: ${confirmed.map((p) => p.displayName).join(', ')}. Their surfaces have not been observed; the in-game globes are artist’s impressions.`,
          dataClass: 'observed',
          source: planetSource,
        }
      : {
          text: 'The archives list no confirmed planets here.',
          dataClass: 'observed',
          source: planetSource,
        },
    ...(others.length
      ? [
          {
            text: `Not confirmed, kept in this edition of the game: ${others.map((p) => `${p.displayName} (${p.status})`).join(', ')}.`,
            dataClass: 'observed' as const,
            source: planetSource,
          },
        ]
      : []),
    {
      text: 'In flight, distances inside the system are compressed and the stars and planets are drawn schematically.',
      dataClass: 'estimated',
      source: posRef(ref),
    },
  ];
  return { summary: `${kind}${planetText}.`, facts };
}

function buildCatalogSystem(e: CatalogSystemEntry): StarSystemRecord {
  const comps = e.componentIds.map((id) => componentIndex.get(id)).filter((c): c is StellarComponent => !!c);
  const ref = componentIndex.get(e.referenceComponentId);
  if (!ref || !comps.length) throw new Error(`System ${e.id} has no catalogued stars`);
  const hostIds = new Set(e.componentIds);
  const planets = EXOPLANETS.planets.filter((p) => hostIds.has(p.hostId));
  const { summary, facts } = describeCatalogSystem(e, comps, planets);
  return {
    id: e.id,
    displayName: e.displayName,
    catalogId: ref.catalogIds.hip ?? ref.catalogIds.gliese ?? ref.id,
    raDegrees: ref.raDegrees,
    decDegrees: ref.decDegrees,
    distanceLightYears: ref.distanceLightYears,
    referenceEpoch: ref.referenceEpoch,
    positionSourceUrl: ref.astrometrySource.url,
    positionLy: ref.positionLy,
    componentIds: e.componentIds,
    confirmedBodies: planets,
    fictionalLocations: ALL.filter((l) => l.systemId === e.id),
    jumpLinks: [...(WORLD.links.get(e.id) ?? [])],
    summary,
    scienceFacts: facts,
    fiction: WORLD.profiles.get(e.id)?.fiction ?? '',
  };
}

export const SYSTEMS: readonly StarSystemRecord[] = [...CURATED.map(buildSystem), ...CATALOG_SYSTEMS.map(buildCatalogSystem)];

/** Every system id, the curated five first. */
export const SYSTEM_IDS: readonly SystemId[] = SYSTEMS.map((s) => s.id);

const systemIndex = new Map<SystemId, StarSystemRecord>(SYSTEMS.map((s) => [s.id, s]));

export function hasSystem(id: string): boolean {
  return systemIndex.has(id);
}

export function getSystem(id: SystemId): StarSystemRecord {
  const s = systemIndex.get(id);
  if (!s) throw new Error(`Unknown system ${id}`);
  return s;
}

export function componentsOf(systemId: SystemId): StellarComponent[] {
  return ASTROMETRY.stars.filter((s) => s.systemId === systemId);
}

/** Every station and planned location: the hand-authored ones and the generated world's. */
export const ALL_LOCATIONS: readonly FictionalLocation[] = ALL;

const locationIndex = new Map(ALL.map((l) => [l.id, l]));

export function getLocation(id: string): FictionalLocation {
  const loc = locationIndex.get(id);
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

// ---------------------------------------------------------------- belts and debris discs

/**
 * Belts and debris discs a cited source reports (src/data/generated/belts.json, from the sky
 * snapshot): the Solar System's two from NASA, the others from papers SIMBAD links to the star. Only
 * belts of systems in the game, and only with a citation: no belt is ever invented.
 */
export const BELTS: readonly BeltRecord[] = (beltsFile as unknown as { belts: BeltRecord[] }).belts.filter((b) => systemIndex.has(b.systemId) && b.sources.length > 0);

const beltIndex = new Map<string, BeltRecord>(BELTS.map((b) => [b.id, b]));

/** The belts of a system (none for most). */
export function beltsOf(systemId: SystemId): BeltRecord[] {
  return BELTS.filter((b) => b.systemId === systemId);
}

export function getBelt(id: string): BeltRecord {
  const b = beltIndex.get(id);
  if (!b) throw new Error(`Unknown belt ${id}`);
  return b;
}

export function findBelt(id: string): BeltRecord | undefined {
  return beltIndex.get(id);
}

/** True when any bundled record is still a provisional transcription. */
export function hasProvisionalData(): boolean {
  return ASTROMETRY.verification === 'provisional' || EXOPLANETS.verification === 'provisional';
}
