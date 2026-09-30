/**
 * Builds the bundled astronomy dataset (src/data/generated/*.json) from a normalized input.
 *
 * Input priority:
 *   1. data/snapshot/astrometry-input.json + exoplanets-input.json  (written by fetch-astro-snapshot.ts)
 *   2. data/provisional/*.json  (stopgap transcriptions, flagged "provisional" in the game)
 * plus the extra systems extracted from the HYG and Open Exoplanet catalogues
 * (data/provisional/catalog-*.json, written by scripts/extract-catalogs.ts), always provisional,
 * for any star or planet the primary input does not already cover.
 *
 * The derived fields (epoch-propagated RA/Dec, distance, Cartesian light-year position) are computed
 * here in double precision so runtime code never has to redo astrometry.
 *
 * Usage: node scripts/build-dataset.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  equatorialToCartesian,
  parallaxErrorToLightYears,
  parallaxToLightYears,
  propagatePosition,
} from '../src/data/coords.ts';
import type { ConfirmedBody, SourceRef, StellarComponent, Verification } from '../src/data/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface StarInput {
  id: string;
  name: string;
  systemId: StellarComponent['systemId'];
  role: StellarComponent['role'];
  parentId?: string;
  catalogIds: StellarComponent['catalogIds'];
  spectralType: string;
  raDegrees: number;
  decDegrees: number;
  epoch: number;
  pmRaMasYr: number;
  pmDecMasYr: number;
  parallaxMas: number;
  /** Absent when the source gives no uncertainty (e.g. HYG). */
  parallaxErrorMas?: number;
  positionSource: SourceRef;
  parallaxSource: SourceRef;
  spectralTypeSource: SourceRef;
  positionNote?: string;
  colorHex: string;
}

interface AstrometryInput {
  kind: Verification;
  retrieved: string | null;
  description: string;
  targetEpoch: number;
  stars: StarInput[];
}

interface MeasuredInput {
  value: number;
  error?: number;
  qualifier?: string;
}

interface PlanetInput {
  archiveName: string;
  hostId: string;
  displayName?: string;
  discoveryYear?: number;
  discoveryMethod?: string;
  controversial: boolean;
  orbitalPeriodDays?: MeasuredInput;
  semiMajorAxisAu?: MeasuredInput;
  massEarth?: MeasuredInput;
  radiusEarth?: MeasuredInput;
  rowUpdate?: string;
  /** Per-planet source when it is not the NASA Exoplanet Archive. */
  source?: SourceRef;
}

interface ExoplanetInput {
  kind: Verification;
  retrieved: string | null;
  description: string;
  source: SourceRef;
  planets: PlanetInput[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function pickInput(name: string): { path: string; kind: 'snapshot' | 'provisional' } {
  const snapshot = resolve(root, 'data/snapshot', name);
  if (existsSync(snapshot)) return { path: snapshot, kind: 'snapshot' };
  return { path: resolve(root, 'data/provisional', name), kind: 'provisional' };
}

/** Readable display names for archive designations. */
function displayNameFor(archiveName: string): string {
  return archiveName
    .replace(/^Proxima Cen /, 'Proxima Centauri ')
    .replace(/^eps Eri /, 'Epsilon Eridani ')
    .replace(/^Barnard's star /i, "Barnard's Star ")
    .replace(/^Barnard /, "Barnard's Star ");
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function measured(input: MeasuredInput | undefined, unit: string) {
  if (!input || !Number.isFinite(input.value)) return undefined;
  return {
    value: input.value,
    unit,
    ...(input.error !== undefined && Number.isFinite(input.error) ? { error: input.error } : {}),
    ...(input.qualifier ? { qualifier: input.qualifier } : {}),
  };
}

/** The catalogue extras (always provisional), when extracted. */
function extraInput<T>(name: string): { path: string; input: T } | null {
  const path = resolve(root, 'data/provisional', name);
  return existsSync(path) ? { path, input: readJson<T>(path) } : null;
}

function buildAstrometry() {
  const { path, kind } = pickInput('astrometry-input.json');
  const input = readJson<AstrometryInput>(path);
  const extra = extraInput<AstrometryInput>('catalog-astrometry-input.json');
  const known = new Set(input.stars.map((s) => s.id));
  const all = [
    ...input.stars.map((s) => ({ s, kind })),
    ...(extra?.input.stars ?? []).filter((s) => !known.has(s.id)).map((s) => ({ s, kind: 'provisional' as Verification })),
  ];
  const stars: StellarComponent[] = all.map(({ s, kind }) => {
    const pos = propagatePosition(
      s.raDegrees,
      s.decDegrees,
      s.pmRaMasYr,
      s.pmDecMasYr,
      s.epoch,
      input.targetEpoch,
    );
    const distanceLightYears = parallaxToLightYears(s.parallaxMas);
    return {
      id: s.id,
      name: s.name,
      systemId: s.systemId,
      role: s.role,
      ...(s.parentId ? { parentId: s.parentId } : {}),
      catalogIds: s.catalogIds,
      spectralType: s.spectralType,
      spectralTypeSource: s.spectralTypeSource,
      raDegrees: pos.raDeg,
      decDegrees: pos.decDeg,
      properMotion: { raMasYr: s.pmRaMasYr, decMasYr: s.pmDecMasYr },
      catalogEpoch: s.epoch,
      parallaxMas: s.parallaxMas,
      ...(s.parallaxErrorMas !== undefined
        ? { parallaxErrorMas: s.parallaxErrorMas, distanceErrorLightYears: parallaxErrorToLightYears(s.parallaxMas, s.parallaxErrorMas) }
        : {}),
      distanceLightYears,
      referenceEpoch: input.targetEpoch,
      frame: 'ICRS',
      astrometrySource: { ...s.positionSource, ...(input.retrieved ? { retrieved: input.retrieved } : {}) },
      parallaxSource: { ...s.parallaxSource, ...(input.retrieved ? { retrieved: input.retrieved } : {}) },
      ...(s.positionNote ? { positionNote: s.positionNote } : {}),
      verification: kind,
      positionLy: equatorialToCartesian(pos.raDeg, pos.decDeg, distanceLightYears),
      colorHex: s.colorHex,
    };
  });
  return {
    generatedBy: 'scripts/build-dataset.ts',
    input: [path, extra?.path].filter(Boolean).map((p) => p!.replace(root + '/', '')).join(' + '),
    verification: stars.some((s) => s.verification === 'provisional') ? ('provisional' as const) : kind,
    retrieved: input.retrieved,
    description: extra ? `${input.description} ${extra.input.description}` : input.description,
    frame: 'ICRS',
    referenceEpoch: input.targetEpoch,
    stars,
  };
}

function buildExoplanets() {
  const { path, kind: primaryKind } = pickInput('exoplanets-input.json');
  const input = readJson<ExoplanetInput>(path);
  const extra = extraInput<ExoplanetInput>('catalog-exoplanets-input.json');
  const known = new Set(input.planets.map((p) => p.archiveName));
  const all = [
    ...input.planets.map((p) => ({ p, kind: primaryKind, asOfDate: input.retrieved ?? 'pending snapshot' })),
    ...(extra?.input.planets ?? []).filter((p) => !known.has(p.archiveName)).map((p) => ({ p, kind: 'provisional' as Verification, asOfDate: 'pending snapshot' })),
  ];
  const planets: ConfirmedBody[] = all.map(({ p, kind, asOfDate }) => {
    const orbitalPeriodDays = measured(p.orbitalPeriodDays, 'days');
    const semiMajorAxisAu = measured(p.semiMajorAxisAu, 'AU');
    const massEarth = measured(p.massEarth, 'Earth masses');
    const radiusEarth = measured(p.radiusEarth, 'Earth radii');
    // Only a snapshot can say a value is unmeasured; provisional records simply lack the value.
    const unknowns = ['surface', 'atmosphere', 'habitability'];
    if (kind === 'snapshot' && !radiusEarth) unknowns.unshift('radius');
    if (kind === 'snapshot' && !massEarth) unknowns.unshift('mass');
    return {
      id: slug(p.archiveName),
      archiveName: p.archiveName,
      displayName: p.displayName ?? displayNameFor(p.archiveName),
      hostId: p.hostId,
      kind: 'planet',
      status: 'confirmed',
      controversial: p.controversial,
      sourceUrl: p.source?.url ?? `https://exoplanetarchive.ipac.caltech.edu/overview/${encodeURIComponent(p.archiveName)}`,
      ...(p.source && p.source.label !== 'NASA Exoplanet Archive' ? { sourceLabel: p.source.label } : {}),
      asOfDate,
      verification: kind,
      ...(p.discoveryYear ? { discoveryYear: p.discoveryYear } : {}),
      ...(p.discoveryMethod ? { discoveryMethod: p.discoveryMethod } : {}),
      ...(orbitalPeriodDays ? { orbitalPeriodDays } : {}),
      ...(semiMajorAxisAu ? { semiMajorAxisAu } : {}),
      ...(massEarth ? { massEarth } : {}),
      ...(radiusEarth ? { radiusEarth } : {}),
      unknowns,
    };
  });
  return {
    generatedBy: 'scripts/build-dataset.ts',
    input: [path, extra?.path].filter(Boolean).map((p) => p!.replace(root + '/', '')).join(' + '),
    verification: planets.some((p) => p.verification === 'provisional') ? ('provisional' as const) : primaryKind,
    asOfDate: input.retrieved ?? 'pending snapshot',
    description: extra ? `${input.description} ${extra.input.description}` : input.description,
    source: input.source,
    planets,
  };
}

const outDir = resolve(root, 'src/data/generated');
mkdirSync(outDir, { recursive: true });
const astrometry = buildAstrometry();
const exoplanets = buildExoplanets();
writeFileSync(resolve(outDir, 'astrometry.json'), JSON.stringify(astrometry, null, 2) + '\n');
writeFileSync(resolve(outDir, 'exoplanets.json'), JSON.stringify(exoplanets, null, 2) + '\n');
const catalogSystems = extraInput<{ systems: unknown[] }>('catalog-systems.json');
writeFileSync(
  resolve(outDir, 'catalog-systems.json'),
  JSON.stringify({ generatedBy: 'scripts/build-dataset.ts', systems: catalogSystems?.input.systems ?? [] }, null, 2) + '\n',
);

console.log(`astrometry: ${astrometry.stars.length} stars (${astrometry.verification}) from ${astrometry.input}`);
for (const s of astrometry.stars) {
  console.log(
    `  ${s.name.padEnd(18)} ${s.distanceLightYears.toFixed(3)} ly  ` +
      `(${s.positionLy.map((v) => v.toFixed(3)).join(', ')})`,
  );
}
console.log(`exoplanets: ${exoplanets.planets.length} planets (${exoplanets.verification}) from ${exoplanets.input}`);
