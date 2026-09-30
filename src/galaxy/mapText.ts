/**
 * Text helpers shared by the map info card, the 2D map and the encyclopedia (pure, no DOM).
 */
import { distance3 } from '../data/coords.ts';
import { ASTROMETRY, getComponent } from '../data/systems.ts';
import type {
  ConfirmedBody,
  FactionId,
  LocationKind,
  LocationService,
  MeasuredValue,
  StellarComponent,
} from '../data/types.ts';
import { COINCIDENT_LY, groupName } from './mapData.ts';

/** Required map legend (product spec wording). */
export const MAP_LEGEND_TEXT =
  'Star positions and distances based on astronomical data; travel technology and local scale are fictional.';

export const AU_PER_LY = 63241.077;

/** Fictional faction names (game content). */
export const FACTION_NAMES: Record<FactionId, string> = {
  sta: 'Sol Transit Authority',
  frontier: 'Frontier Cooperative',
  'hollow-wake': 'Hollow Wake',
};

export const SERVICE_LABELS: Record<LocationService, string> = {
  market: 'Market',
  repair: 'Repair',
  equipment: 'Equipment',
  contracts: 'Contracts',
  'jump-clearance': 'Jump clearance',
};

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  port: 'Port',
  depot: 'Depot',
  outpost: 'Outpost',
  relay: 'Relay',
  platform: 'Platform',
  hub: 'Hub',
};

export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Julian epoch label, e.g. "J2016.0". */
export function formatEpoch(epoch: number): string {
  return `J${epoch.toFixed(1)}`;
}

/** Decimal places that show a value to the precision of its one-sigma error (2 to 4). */
export function digitsForError(error: number): number {
  if (!(error > 0)) return 2;
  return Math.min(4, Math.max(2, Math.ceil(-Math.log10(error))));
}

/** "4.344 ± 0.002 ly" */
export function formatDistanceWithError(distanceLy: number, errorLy: number | undefined): string {
  if (errorLy === undefined) return `${distanceLy.toFixed(2)} ly`;
  const d = digitsForError(errorLy);
  return `${distanceLy.toFixed(d)} ± ${errorLy.toFixed(d)} ly`;
}

/** "750.81 ± 0.38 mas" */
export function formatParallax(c: StellarComponent): string {
  if (c.parallaxErrorMas === undefined) return `${c.parallaxMas.toFixed(2)} mas`;
  const d = c.parallaxErrorMas < 0.1 ? 4 : 2;
  return `${c.parallaxMas.toFixed(d)} ± ${c.parallaxErrorMas.toFixed(d)} mas`;
}

/** Most specific catalog identifier: Gaia DR3, then HIP, then SIMBAD name. */
export function primaryCatalogId(c: StellarComponent): string {
  return c.catalogIds.gaiaDr3 ?? c.catalogIds.hip ?? c.catalogIds.simbad ?? c.id;
}

export function allCatalogIds(c: StellarComponent): string[] {
  const ids = [c.catalogIds.gaiaDr3, c.catalogIds.hip, c.catalogIds.simbad].filter((v): v is string => !!v);
  return [...new Set(ids)];
}

/** Descriptor from the spectral class (only the two the bundled facts rely on). */
export function stellarKind(spectralType: string): string | null {
  const c = spectralType.trim().charAt(0).toUpperCase();
  if (c === 'D') return 'white dwarf';
  if (c === 'M') return 'red dwarf';
  return null;
}

function roundAu(au: number): string {
  const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(au)) - 1));
  return (Math.round(au / magnitude) * magnitude).toLocaleString('en-US');
}

/**
 * Role of a star within its system, e.g. "Distant companion of the Alpha Centauri A/B pair".
 * Derived from the component hierarchy and positions in the bundled astrometry.
 */
export function roleNote(c: StellarComponent): string {
  const siblings = ASTROMETRY.stars.filter((s) => s.systemId === c.systemId);
  const kind = stellarKind(c.spectralType);
  if (c.role === 'primary') {
    if (siblings.length === 1) return kind ? `Single star (${kind}).` : 'Single star.';
    const close = siblings.filter((s) => s.parentId === c.id && distance3(s.positionLy, c.positionLy) < COINCIDENT_LY);
    if (close.length) return `Primary star; forms a close pair with ${close.map((s) => s.name).join(' and ')}.`;
    return 'Primary star.';
  }
  const parent = c.parentId ? getComponent(c.parentId) : undefined;
  if (!parent) return 'Companion star.';
  const sep = distance3(parent.positionLy, c.positionLy);
  const kindText = kind ? `${capitalize(kind)} companion` : 'Companion';
  if (sep < COINCIDENT_LY) {
    return kind ? `${kindText} of ${parent.name}.` : `Close binary companion of ${parent.name}.`;
  }
  const pairMates = siblings.filter(
    (s) => s.id !== c.id && s.parentId === parent.id && distance3(s.positionLy, parent.positionLy) < COINCIDENT_LY,
  );
  const of = pairMates.length ? `the ${groupName([parent.name, ...pairMates.map((s) => s.name)])} pair` : parent.name;
  return `Distant ${kind ? `${kind} ` : ''}companion of ${of}, about ${sep.toFixed(2)} ly (≈ ${roundAu(sep * AU_PER_LY)} AU) away.`;
}

export function formatMeasured(v: MeasuredValue): string {
  const digits = v.value >= 100 ? 1 : v.value >= 1 ? 2 : 4;
  const err = v.error !== undefined ? ` ± ${v.error.toFixed(digits)}` : '';
  const q = v.qualifier ? ` (${v.qualifier})` : '';
  return `${v.value.toFixed(digits)}${err} ${v.unit}${q}`;
}

/** Measured planet parameters present in the bundled record, as label/value pairs. */
export function planetMeasurements(p: ConfirmedBody): [string, string][] {
  const out: [string, string][] = [];
  if (p.orbitalPeriodDays) out.push(['Orbital period', formatMeasured(p.orbitalPeriodDays)]);
  if (p.semiMajorAxisAu) out.push(['Semi-major axis', formatMeasured(p.semiMajorAxisAu)]);
  if (p.massEarth) out.push(['Mass', formatMeasured(p.massEarth)]);
  if (p.radiusEarth) out.push(['Radius', formatMeasured(p.radiusEarth)]);
  return out;
}
