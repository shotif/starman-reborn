import type { FactionId, SystemId } from '../../data/types.ts';
import { hashString, rng, type Rng } from '../random.ts';
import { MANUFACTURERS } from '../rules/manufacturers.ts';
import type { ManufacturerId } from '../types.ts';
import { distance, generateJumpNetwork, jumpsFrom } from './network.ts';
import {
  NAME_WORDS,
  OWNER_MAKERS,
  PIRATE_DEN,
  STATION_COUNT,
  STATION_SHOPS,
  STATION_TYPES,
  TERRITORY,
  WORLD_SEED,
  type AnchorKind,
  type StationTypeRule,
} from './rules.ts';
import type { GeneratedStation, StationOwner, StationShop, SystemProfile, SystemSeed, WorldResult } from './types.ts';

/**
 * The world generator (docs/PROCGEN.md §7): a pure function of the observed catalogue (seeds), the
 * world rules and a seed. Hand-authored systems keep their stations; every other system gets
 * stations attached to its real stars and planets, an owner, a security level and a line of fiction.
 */
export function generateWorld(seeds: readonly SystemSeed[], seed = WORLD_SEED): WorldResult {
  const links = generateJumpNetwork(seeds);
  const profiles = new Map<SystemId, SystemProfile>();
  for (const s of seeds) profiles.set(s.id, territoryOf(s, seeds));
  const jumps = jumpsFrom(links, 'sol');
  const names = new NamePicker(seed);
  // Nearest systems first, so names and ids are stable as the catalogue grows outward.
  const order = seeds
    .filter((s) => !s.curated)
    .sort((a, b) => distance(a.positionLy, [0, 0, 0]) - distance(b.positionLy, [0, 0, 0]) || (a.id < b.id ? -1 : 1));
  const views = new Map(order.map((s) => [s.id, viewOf(s, profiles.get(s.id)!)]));
  const bySystem = new Map<SystemId, GeneratedStation[]>();
  for (const s of order) bySystem.set(s.id, stationsFor(views.get(s.id)!, jumps.get(s.id) ?? 99, names, seed));

  // Every kind of station exists somewhere: a missing kind goes to the system that suits it best.
  for (const rule of STATION_TYPES) {
    if ([...bySystem.values()].some((list) => list.some((st) => st.type === rule.type))) continue;
    const best = order
      .map((s) => ({ v: views.get(s.id)!, list: bySystem.get(s.id)! }))
      .filter(({ v, list }) => list.filter((st) => st.dockable).length < STATION_COUNT.max && eligible(rule, v, []))
      .sort((a, b) => weightOf(rule, b.v) - weightOf(rule, a.v))[0];
    if (!best) continue; // the guardrails report the gap
    const r = rng(seed, 'coverage', rule.type);
    const open = best.list.filter((st) => st.dockable);
    const dens = best.list.filter((st) => !st.dockable);
    bySystem.set(best.v.s.id, [...open, placeStation(best.v, rule, names, r), ...dens]);
  }

  const stations: GeneratedStation[] = [];
  for (const s of order) {
    const own = bySystem.get(s.id)!;
    stations.push(...own);
    const p = profiles.get(s.id)!;
    profiles.set(s.id, { ...p, fiction: fictionFor(p, own) });
  }
  return { links, stations, profiles };
}

// ---------------------------------------------------------------- territory

function territoryOf(s: SystemSeed, seeds: readonly SystemSeed[]): SystemProfile {
  const pos = new Map(seeds.map((x) => [x.id, x.positionLy]));
  const influence = new Map<FactionId, number>();
  for (const a of TERRITORY.anchors) {
    const at = pos.get(a.system);
    if (!at) continue;
    const d = distance(at, s.positionLy);
    influence.set(a.owner, (influence.get(a.owner) ?? 0) + a.weight / (1 + (d / TERRITORY.reachLy) ** 2));
  }
  const top = [...influence].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
  const best: FactionId | null = top ? top[0] : null;
  const value = top ? top[1] : 0;
  const [lo, hi] = TERRITORY.securityRange;
  const security = Math.round(Math.min(hi, Math.max(lo, value * TERRITORY.securityScale)) * 100) / 100;
  const curatedOwner = s.curated?.owner;
  const owner: FactionId | null =
    curatedOwner !== undefined ? (curatedOwner === 'independent' ? null : curatedOwner) : value >= TERRITORY.claimThreshold ? best : null;
  return { id: s.id, owner, security, fiction: '' };
}

// ---------------------------------------------------------------- stations

/** "M5.5Ve" → 'M'; "dM6 e" → 'M'; "sdM4" → 'M'; "DA2" → 'D' (white dwarf). */
export function spectralClass(spect: string): string {
  const s = spect.trim().toUpperCase();
  if (/^D[ABCOQZX]/.test(s) || s === 'DG') return 'D';
  return s.replace(/^(SD|D)(?=[OBAFGKM])/, '')[0] ?? '?';
}

/** Planets above this mass (Earth masses) count as giants. */
export const GIANT_EARTH_MASSES = 30;

/** What the station rules look at in one system. */
interface SystemView {
  s: SystemSeed;
  profile: SystemProfile;
  primary: SystemSeed['stars'][number];
  sunlike: boolean;
  whiteDwarf: SystemSeed['stars'][number] | undefined;
  giants: SystemSeed['planets'][number][];
  smalls: SystemSeed['planets'][number][];
}

function viewOf(s: SystemSeed, profile: SystemProfile): SystemView {
  const primary = s.stars[0]!;
  return {
    s,
    profile,
    primary,
    sunlike: ['F', 'G', 'K'].includes(spectralClass(primary.spectralType)),
    whiteDwarf: s.stars.find((x) => spectralClass(x.spectralType) === 'D'),
    giants: s.planets.filter((p) => (p.massEarth ?? 0) > GIANT_EARTH_MASSES),
    smalls: s.planets.filter((p) => (p.massEarth ?? 0) <= GIANT_EARTH_MASSES),
  };
}

/** Bodies a station of this kind may orbit here: the first preference that exists. */
function anchorOptions(rule: StationTypeRule, v: SystemView): string[] {
  const options: Record<AnchorKind, () => string[]> = {
    star: () => [(rule.bonus?.whiteDwarf && v.whiteDwarf ? v.whiteDwarf : v.primary).id],
    planet: () => v.s.planets.map((p) => p.id),
    giant: () => v.giants.map((p) => p.id),
    'small-planet': () => v.smalls.map((p) => p.id),
  };
  for (const kind of rule.anchor) {
    const ids = options[kind]();
    if (ids.length) return ids;
  }
  return [];
}

function eligible(rule: StationTypeRule, v: SystemView, chosen: readonly StationTypeRule[]): boolean {
  const sec = v.profile.security;
  return (
    sec >= rule.security[0] &&
    sec <= rule.security[1] &&
    chosen.filter((c) => c.type === rule.type).length < rule.maxPerSystem &&
    anchorOptions(rule, v).length > 0
  );
}

function weightOf(rule: StationTypeRule, v: SystemView): number {
  const b = rule.bonus ?? {};
  return (
    rule.weight +
    (v.sunlike ? (b.sunlike ?? 0) : 0) +
    v.s.planets.length * (b.perPlanet ?? 0) +
    (v.whiteDwarf ? (b.whiteDwarf ?? 0) : 0) +
    (v.profile.owner !== null ? (b.claimed ?? 0) : (b.unclaimed ?? 0))
  );
}

function stationsFor(v: SystemView, jumpsFromSol: number, names: NamePicker, seed: number): GeneratedStation[] {
  const r = rng(seed, 'stations', v.s.id);
  const count = Math.min(
    STATION_COUNT.max,
    STATION_COUNT.base +
      (v.s.planets.length >= STATION_COUNT.manyPlanets ? 1 : 0) +
      (v.sunlike ? 1 : 0) +
      (v.profile.security >= STATION_COUNT.secureAbove ? 1 : 0),
  );
  const chosen: StationTypeRule[] = [];
  const out: GeneratedStation[] = [];
  for (let i = 0; i < count; i++) {
    const candidates = STATION_TYPES.filter((t) => eligible(t, v, chosen));
    if (!candidates.length) break;
    const rule = weightedPick(
      r,
      candidates,
      candidates.map((t) => weightOf(t, v)),
    );
    chosen.push(rule);
    out.push(placeStation(v, rule, names, r));
  }

  // Raiders hide in lawless space, away from the core.
  if (v.profile.security < TERRITORY.lawlessBelow && jumpsFromSol >= PIRATE_DEN.minJumpsFromSol && r.next() < PIRATE_DEN.chance) {
    const rule: StationTypeRule = {
      type: PIRATE_DEN.type,
      nouns: PIRATE_DEN.nouns,
      services: [],
      anchor: ['star'],
      size: PIRATE_DEN.size,
      weight: 0,
      security: [0, 1],
      maxPerSystem: 1,
      owner: 'hollow-wake',
      describe: PIRATE_DEN.describe,
    };
    out.push(makeStation(v.s, rule, 'hollow-wake', v.primary.id, v.profile.security, names, r, false));
  }
  return out;
}

function placeStation(v: SystemView, rule: StationTypeRule, names: NamePicker, r: Rng): GeneratedStation {
  const anchorId = r.pick(anchorOptions(rule, v));
  const owner: StationOwner = rule.owner === 'territory' ? (v.profile.owner ?? 'independent') : rule.owner;
  return makeStation(v.s, rule, owner, anchorId, v.profile.security, names, r, true);
}

function weightedPick<T>(r: Rng, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r.next() * total;
  for (let i = 0; i < items.length; i++) {
    x -= weights[i]!;
    if (x < 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function makeStation(
  s: SystemSeed,
  rule: StationTypeRule,
  owner: StationOwner,
  anchorId: string,
  security: number,
  names: NamePicker,
  r: Rng,
  dockable: boolean,
): GeneratedStation {
  const noun = r.pick(rule.nouns);
  const name = `${names.pick(owner, s.name)} ${noun}`;
  const id = slug(name);
  const star = s.stars[0]!;
  const planet = s.planets.find((p) => p.id === anchorId);
  const anchorName = planet?.name ?? s.stars.find((x) => x.id === anchorId)?.name ?? star.name;
  const onStar = !planet;
  const far = rule.type === 'pirate-den';
  const orbit = {
    distance: Math.round(
      far ? r.range(16_000, 22_000) : onStar ? r.range(6_500, 13_000) : (planet!.massEarth ?? 0) > GIANT_EARTH_MASSES ? r.range(4_500, 6_500) : r.range(1_400, 2_400),
    ),
    angle: Math.round(r.range(0, 360)),
    height: Math.round(r.range(-700, 700)),
  };
  const [lo, hi] = rule.size;
  const wear = Math.min(1, Math.max(0, 0.12 + (1 - security) * 0.6 + r.range(-0.12, 0.12) + (owner === 'hollow-wake' ? 0.25 : 0)));
  // Its own stream, so shop rules never shift names or orbits.
  const shop = dockable ? shopFor(rule, owner, rng(hashString(id), 'shop')) : undefined;
  return {
    id,
    name,
    systemId: s.id,
    type: rule.type,
    owner,
    anchorId,
    orbit,
    services: rule.services,
    dockable,
    look: {
      type: rule.type,
      owner,
      seed: hashString(id) % 100_000,
      starColor: s.stars.find((x) => x.id === anchorId)?.colorHex ?? star.colorHex,
      size: Math.round((lo + r.next() * (hi - lo)) * 100) / 100,
      wear: Math.round(wear * 100) / 100,
    },
    description: rule.describe.replace('{anchor}', anchorName).replace('{system}', s.name),
    ...(shop ? { shop } : {}),
  };
}

/**
 * Outfitter stock: stations that sell equipment carry one or two of their owner's makers (a
 * shipyard always includes one that builds what it sells); others with repairs sell consumables.
 */
function shopFor(rule: StationTypeRule, owner: StationOwner, r: Rng): StationShop | undefined {
  const spec = STATION_SHOPS[rule.type];
  if (spec && rule.services.includes('equipment')) {
    const builds = (m: ManufacturerId) =>
      spec.ships.filter((c) => (MANUFACTURERS.find((x) => x.id === m)?.ships[c] ?? []).some((t) => t <= spec.maxShipTier));
    const pool = r.shuffle(OWNER_MAKERS[owner]);
    if (spec.ships.length) pool.sort((a, b) => Number(builds(b).length > 0) - Number(builds(a).length > 0));
    const makers: ManufacturerId[] = owner === 'independent' ? ['wake', pool[0]!] : pool.slice(0, spec.makers);
    const shipyard = spec.ships.filter((c) => makers.some((m) => builds(m).includes(c)));
    return { makers, maxClass: spec.maxClass, shipyard, maxShipTier: spec.maxShipTier };
  }
  if (rule.services.includes('repair')) return { makers: [], maxClass: 1, shipyard: [], maxShipTier: 1 };
  return undefined;
}

/** Unique first words per owner, drawn from each owner's pool in a seeded order. */
class NamePicker {
  private readonly pools = new Map<StationOwner, string[]>();
  private readonly used = new Set<string>();

  constructor(seed: number) {
    for (const [owner, words] of Object.entries(NAME_WORDS) as [StationOwner, readonly string[]][]) {
      this.pools.set(owner, rng(seed, 'station-names', owner).shuffle(words));
    }
  }

  pick(owner: StationOwner, fallback: string): string {
    const pool = this.pools.get(owner) ?? [];
    const word = pool.shift();
    if (word && !this.used.has(word)) {
      this.used.add(word);
      return word;
    }
    // Pool exhausted: name it after its system (the guardrails report it).
    return fallback;
  }
}

// ---------------------------------------------------------------- fiction

const OWNER_LINE: Record<FactionId, { core: string; border: string }> = {
  sta: {
    core: 'Transit Authority space; patrols keep the lanes quiet.',
    border: 'Transit Authority border space; patrols are thin and raiders test them.',
  },
  frontier: {
    core: 'Frontier Cooperative space, settled by miners, farmers and researchers.',
    border: 'Frontier Cooperative border settlements; the militia is stretched thin.',
  },
  'hollow-wake': { core: 'Hollow Wake territory.', border: 'Hollow Wake territory.' },
};

/** Security at or above which claimed space counts as its owner's core. */
const CORE_SECURITY = 0.6;

function fictionFor(p: SystemProfile, stations: readonly GeneratedStation[]): string {
  const owner = p.owner
    ? OWNER_LINE[p.owner][p.security >= CORE_SECURITY ? 'core' : 'border']
    : p.security < TERRITORY.lawlessBelow
      ? 'Unclaimed and lawless: Hollow Wake raiders prey on traffic here.'
      : 'Unclaimed space between the territories; patrols are rare.';
  const open = stations.filter((s) => s.dockable).map((s) => s.name);
  const list = open.length ? `${open.length === 1 ? 'Station' : 'Stations'}: ${open.join(', ')}.` : 'No open station yet.';
  return `${owner} ${list}`;
}
