import { equatorialToCartesian, parallaxToLightYears } from './coords.ts';
import type { AstrometryDataset, ExoplanetDataset } from './systems.ts';
import type { SourceRef, StarSystemRecord, SystemId } from './types.ts';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ValidationInput {
  systems: readonly StarSystemRecord[];
  astrometry: AstrometryDataset;
  exoplanets: ExoplanetDataset;
}

/**
 * Broad, familiar distance bands (light-years) used as a sanity check against gross data errors
 * such as a parallax typed in the wrong unit. They are not a source of truth.
 */
const FAMILIAR_DISTANCE_BANDS: Record<string, [number, number]> = {
  'alpha-centauri-a': [4.2, 4.45],
  'alpha-centauri-b': [4.2, 4.45],
  'proxima-centauri': [4.2, 4.45],
  'barnards-star': [5.8, 6.1],
  'sirius-a': [8.4, 8.8],
  'sirius-b': [8.4, 8.8],
  'epsilon-eridani': [10.3, 10.7],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isHttpsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Breadth-first reachability over the (fictional) jump graph. */
export function reachableSystems(systems: readonly StarSystemRecord[], start: SystemId): Set<SystemId> {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const seen = new Set<SystemId>([start]);
  const queue: SystemId[] = [start];
  while (queue.length) {
    const current = byId.get(queue.shift()!);
    if (!current) continue;
    for (const next of current.jumpLinks) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

export function validateDataset({ systems, astrometry, exoplanets }: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message });

  // Unique identifiers across every record type.
  const ids = new Map<string, string>();
  const claim = (id: string, what: string) => {
    const prior = ids.get(id);
    if (prior) error('duplicate-id', `"${id}" is used by both ${prior} and ${what}`);
    else ids.set(id, what);
  };
  for (const s of systems) claim(`system:${s.id}`, `system ${s.id}`);
  for (const c of astrometry.stars) claim(c.id, `component ${c.name}`);
  for (const p of exoplanets.planets) claim(p.id, `planet ${p.archiveName}`);
  for (const s of systems) for (const l of s.fictionalLocations) claim(l.id, `location ${l.name}`);

  const checkSource = (src: SourceRef, where: string) => {
    if (!src.label?.trim()) error('source-label', `${where}: source label is empty`);
    if (!isHttpsUrl(src.url)) error('source-url', `${where}: source URL is not a valid https URL (${src.url})`);
    if (astrometry.verification === 'snapshot' && src.retrieved && !ISO_DATE.test(src.retrieved)) {
      error('source-date', `${where}: retrieved date "${src.retrieved}" is not YYYY-MM-DD`);
    }
  };

  // Astrometry: ranges, derived-value consistency, one frame and epoch.
  const componentById = new Map(astrometry.stars.map((c) => [c.id, c]));
  const epochs = new Set(astrometry.stars.map((c) => c.referenceEpoch));
  if (epochs.size > 1) error('epoch-mix', `components use several epochs: ${[...epochs].join(', ')}`);
  if (astrometry.verification === 'snapshot' && !(astrometry.retrieved && ISO_DATE.test(astrometry.retrieved))) {
    error('snapshot-date', 'astrometry snapshot has no valid retrieved date');
  }
  for (const c of astrometry.stars) {
    const where = `component ${c.id}`;
    if (c.frame !== 'ICRS') error('frame', `${where}: frame ${c.frame} is not ICRS`);
    if (!(c.raDegrees >= 0 && c.raDegrees < 360)) error('ra-range', `${where}: RA ${c.raDegrees} out of [0, 360)`);
    if (!(c.decDegrees >= -90 && c.decDegrees <= 90)) error('dec-range', `${where}: Dec ${c.decDegrees} out of [-90, 90]`);
    if (!(c.parallaxMas > 0)) error('parallax', `${where}: parallax must be positive`);
    if (c.parallaxErrorMas !== undefined && !(c.parallaxErrorMas >= 0)) error('parallax-error', `${where}: parallax error must be non-negative`);
    if (!(c.distanceLightYears > 0)) error('distance', `${where}: distance must be positive`);
    else if (c.parallaxMas > 0) {
      const expected = parallaxToLightYears(c.parallaxMas);
      if (Math.abs(expected - c.distanceLightYears) > 1e-9) {
        error('distance-mismatch', `${where}: distance ${c.distanceLightYears} does not match parallax (${expected})`);
      }
      const [x, y, z] = equatorialToCartesian(c.raDegrees, c.decDegrees, c.distanceLightYears);
      const dp = Math.hypot(x - c.positionLy[0], y - c.positionLy[1], z - c.positionLy[2]);
      if (dp > 1e-9) error('position-mismatch', `${where}: Cartesian position disagrees with RA/Dec/distance by ${dp} ly`);
    }
    const band = FAMILIAR_DISTANCE_BANDS[c.id];
    if (band && (c.distanceLightYears < band[0] || c.distanceLightYears > band[1])) {
      warn('distance-band', `${where}: ${c.distanceLightYears.toFixed(3)} ly is outside the familiar ${band[0]}–${band[1]} ly band`);
    }
    if (!c.catalogIds.gaiaDr3 && !c.catalogIds.hip && !c.catalogIds.simbad && !c.catalogIds.gliese) {
      error('catalog-id', `${where}: no catalog identifier`);
    }
    checkSource(c.astrometrySource, `${where} astrometry`);
    checkSource(c.parallaxSource, `${where} parallax`);
    checkSource(c.spectralTypeSource, `${where} spectral type`);
    if (c.role === 'companion') {
      const parent = c.parentId ? componentById.get(c.parentId) : undefined;
      if (!parent) error('companion-parent', `${where}: companion parent "${c.parentId}" not found`);
      else if (parent.systemId !== c.systemId) error('companion-system', `${where}: parent is in another system`);
      else if (parent.id === c.id) error('companion-self', `${where}: component is its own parent`);
    } else if (c.parentId) {
      error('primary-parent', `${where}: primary component must not have a parent`);
    }
  }

  // Systems: component membership, one primary each, source URLs.
  const systemIds = new Set(systems.map((s) => s.id));
  for (const s of systems) {
    const where = `system ${s.id}`;
    if (s.id === 'sol') {
      if (s.positionLy.some((v) => v !== 0)) error('sol-origin', 'Sol must be at the origin');
    } else {
      const members = astrometry.stars.filter((c) => c.systemId === s.id);
      const primaries = members.filter((c) => c.role === 'primary');
      if (primaries.length !== 1) error('primary-count', `${where}: expected 1 primary, found ${primaries.length}`);
      for (const id of s.componentIds) {
        if (!componentById.has(id)) error('component-missing', `${where}: component ${id} missing from astrometry`);
      }
      for (const m of members) {
        if (!s.componentIds.includes(m.id)) error('component-unlisted', `${where}: component ${m.id} not listed`);
      }
      if (s.raDegrees === null || s.decDegrees === null || s.referenceEpoch === null) {
        error('system-position', `${where}: missing RA/Dec/epoch`);
      }
      if (!isHttpsUrl(s.positionSourceUrl)) error('source-url', `${where}: position source URL invalid`);
    }
    for (const f of s.scienceFacts) checkSource(f.source, `${where} fact`);
    const docks = s.fictionalLocations.filter((l) => l.status === 'functional' && l.services.length > 0);
    if (docks.length === 0) error('no-dock', `${where}: needs at least one functional dock or relay`);
    for (const l of s.fictionalLocations) {
      if (l.fictional !== true) error('location-fiction-flag', `location ${l.id} must carry fictional: true`);
    }
    // Jump links: valid, not self, symmetric.
    for (const to of s.jumpLinks) {
      if (!systemIds.has(to)) error('jump-target', `${where}: jump link to unknown system ${to}`);
      else if (to === s.id) error('jump-self', `${where}: jump link to itself`);
      else if (!systems.find((o) => o.id === to)!.jumpLinks.includes(s.id)) {
        error('jump-asymmetric', `${where}: link to ${to} is not mirrored`);
      }
    }
  }
  const reachable = reachableSystems(systems, 'sol');
  for (const s of systems) {
    if (!reachable.has(s.id)) error('unreachable', `system ${s.id} is not reachable from Sol`);
  }

  // Planets: status, host, dates, source.
  if (exoplanets.verification === 'snapshot' && !ISO_DATE.test(exoplanets.asOfDate)) {
    error('planet-date', `exoplanet snapshot asOfDate "${exoplanets.asOfDate}" is not YYYY-MM-DD`);
  }
  for (const p of exoplanets.planets) {
    const where = `planet ${p.archiveName}`;
    if (p.status !== 'confirmed') error('planet-status', `${where}: only confirmed planets may be bundled`);
    if (!componentById.has(p.hostId)) error('planet-host', `${where}: host ${p.hostId} not found`);
    if (!isHttpsUrl(p.sourceUrl)) error('source-url', `${where}: source URL invalid`);
    if (p.verification === 'snapshot' && !ISO_DATE.test(p.asOfDate)) {
      error('planet-date', `${where}: asOfDate must be YYYY-MM-DD`);
    }
    if (p.controversial) warn('planet-controversial', `${where}: archive flags this planet as controversial`);
  }

  if (astrometry.verification === 'provisional') {
    warn('provisional-astrometry', 'astrometry is provisional: run `npm run data:snapshot` when the archives are reachable');
  }
  if (exoplanets.verification === 'provisional') {
    warn('provisional-exoplanets', 'exoplanet list is provisional: run `npm run data:snapshot` when the archives are reachable');
  }
  return issues;
}
