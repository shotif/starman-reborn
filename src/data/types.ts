/**
 * Data model for the curated five-system region.
 *
 * Every value in this model is one of three classes, and the UI must label it:
 * - observed:  catalog or reference data with a source record (astrometry, planet status)
 * - estimated: artistic or schematic depiction where measurements are incomplete
 * - fictional: game content (stations, lanes, factions, jump links, prices)
 */

export type SystemId = 'sol' | 'alpha-centauri' | 'barnard' | 'sirius' | 'epsilon-eridani';

export const SYSTEM_IDS: readonly SystemId[] = [
  'sol',
  'alpha-centauri',
  'barnard',
  'sirius',
  'epsilon-eridani',
];

export type DataClass = 'observed' | 'estimated' | 'fictional';

export type Vec3Tuple = [number, number, number];

/** A citation for an observed value. */
export interface SourceRef {
  /** Short label shown in the UI, e.g. "Gaia DR3". */
  label: string;
  url: string;
  /** Record identifier inside the source, e.g. "Gaia DR3 5853498713190525696". */
  recordId?: string;
  /** ISO date (YYYY-MM-DD) the record was retrieved. */
  retrieved?: string;
  /** ADS bibcode of the underlying publication, when the value comes from literature. */
  bibcode?: string;
}

/**
 * How a record entered the bundled dataset.
 * - snapshot: machine-retrieved from the archive on `retrieved` by scripts/fetch-astro-snapshot.ts
 * - provisional: transcribed from the cited catalog without machine verification; shown with a
 *   "pending verification" note in the UI until a snapshot replaces it.
 */
export type Verification = 'snapshot' | 'provisional';

/** Astrometry for one star (a component of a stellar system). */
export interface StellarComponent {
  id: string;
  name: string;
  systemId: SystemId;
  role: 'primary' | 'companion';
  /** For companions: the component they are grouped with. */
  parentId?: string;
  catalogIds: {
    gaiaDr3?: string;
    hip?: string;
    simbad?: string;
  };
  /** Spectral type as given by the cited source. */
  spectralType: string;
  spectralTypeSource: SourceRef;
  /** ICRS right ascension at `referenceEpoch`, degrees. */
  raDegrees: number;
  /** ICRS declination at `referenceEpoch`, degrees. */
  decDegrees: number;
  /** Proper motion (mu_alpha* includes cos dec), milliarcseconds per year. */
  properMotion: { raMasYr: number; decMasYr: number };
  /** Julian year of the catalog position before propagation. */
  catalogEpoch: number;
  parallaxMas: number;
  parallaxErrorMas: number;
  distanceLightYears: number;
  /** One-sigma distance uncertainty propagated from the parallax error. */
  distanceErrorLightYears: number;
  /** Julian year of the position (all bundled positions are propagated to one epoch). */
  referenceEpoch: number;
  frame: 'ICRS';
  /** Source of the position. */
  astrometrySource: SourceRef;
  /** Source of the parallax (may differ, e.g. a dedicated study for a bright binary). */
  parallaxSource: SourceRef;
  /** Explains any special handling of this component's position. */
  positionNote?: string;
  verification: Verification;
  /** Equatorial Cartesian position in light-years, Sol at the origin (derived). */
  positionLy: Vec3Tuple;
  /** Display colour; an artistic choice inspired by the spectral type (estimated). */
  colorHex: string;
}

export interface MeasuredValue {
  value: number;
  unit: string;
  /** Plus/minus uncertainty when the source gives one. */
  error?: number;
  /** e.g. "minimum mass (M sin i)" */
  qualifier?: string;
}

/** A planet that the cited archive snapshot lists as confirmed. */
export interface ConfirmedBody {
  id: string;
  /** Name exactly as it appears in the archive, e.g. "Proxima Cen b". */
  archiveName: string;
  displayName: string;
  hostId: string;
  kind: 'planet';
  status: 'confirmed';
  /** NASA Exoplanet Archive controversy flag (pl_controv_flag). */
  controversial: boolean;
  sourceUrl: string;
  asOfDate: string;
  verification: Verification;
  discoveryYear?: number;
  discoveryMethod?: string;
  orbitalPeriodDays?: MeasuredValue;
  semiMajorAxisAu?: MeasuredValue;
  massEarth?: MeasuredValue;
  radiusEarth?: MeasuredValue;
  /** Properties with no measurement, shown as "Unknown" rather than invented. */
  unknowns: string[];
}

export type FactionId = 'sta' | 'frontier' | 'hollow-wake';

export type LocationService =
  | 'market'
  | 'repair'
  | 'equipment'
  | 'contracts'
  | 'jump-clearance';

export type LocationKind = 'port' | 'depot' | 'outpost' | 'relay' | 'platform' | 'hub';

/** A station or other game location. Always fictional. */
export interface FictionalLocation {
  id: string;
  name: string;
  systemId: SystemId;
  kind: LocationKind;
  fictional: true;
  status: 'functional' | 'planned';
  factionId?: FactionId;
  description: string;
  services: LocationService[];
  /** Real body this location orbits or sits near, when any. */
  nearBodyId?: string;
}

export interface ScienceFact {
  text: string;
  dataClass: Exclude<DataClass, 'fictional'>;
  source: SourceRef;
}

/** Solar System body for the information view (names per NASA's planet reference). */
export interface SolarBody {
  id: string;
  name: string;
  kind: 'star' | 'terrestrial planet' | 'gas giant' | 'ice giant' | 'moon';
  /** Order from the Sun (planets only). */
  order?: number;
  source: SourceRef;
}

export interface StarSystemRecord {
  id: SystemId;
  displayName: string;
  /** Primary catalog identifier of the system's reference component. */
  catalogId: string;
  raDegrees: number | null;
  decDegrees: number | null;
  distanceLightYears: number;
  referenceEpoch: number | null;
  positionSourceUrl: string | null;
  /** Equatorial Cartesian position of the reference component, light-years. */
  positionLy: Vec3Tuple;
  componentIds: string[];
  confirmedBodies: ConfirmedBody[];
  fictionalLocations: FictionalLocation[];
  /** Fictional jump links (gameplay). Distances are computed from positions. */
  jumpLinks: SystemId[];
  /** One-line observed summary. */
  summary: string;
  scienceFacts: ScienceFact[];
  /** Fictional setting blurb. */
  fiction: string;
}
