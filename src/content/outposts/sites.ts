import type { OutpostRecord } from '../../app/state.ts';
import { BELTS, findBelt, getPlanet, getSystem, KIND_OF, WORLD, WORLD_SEEDS } from '../../data/systems.ts';
import type { FictionalLocation, SystemId } from '../../data/types.ts';
import { rng } from '../random.ts';
import { GIANT_EARTH_MASSES } from '../world/generate.ts';
import { STATION_TYPES, WORLD_SEED } from '../world/rules.ts';
import type { StationType } from '../world/types.ts';
import { OUTPOSTS } from './rules.ts';

/**
 * Where the player can found an outpost (docs/PROCGEN.md §22, §36): one site in orbit of each
 * confirmed planet of the generated systems (Sol and the four other hand-made systems keep their own
 * stations), with the kinds the world's rules allow there; and one in each cited belt, Sol's too,
 * always a refinery. A pure function of the catalogue and the world, the same for every player; the
 * sites are not stations until a save charters one.
 */

export interface OutpostSite {
  /** The site's id: the confirmed planet it orbits, or `belt.<belt id>`. */
  id: string;
  systemId: SystemId;
  /** In orbit of a confirmed planet: the planet, and where round it, clear of its surface (schematic units, as the world's stations). */
  planetId?: string;
  orbit?: { distance: number; angle: number; height: number };
  /** In a cited belt (§36.1): the belt, and where round its ring (degrees). */
  beltId?: string;
  ring?: { angle: number };
  /** What an outpost here can be. */
  kinds: readonly StationType[];
}

let sites: OutpostSite[] | null = null;

/** Every outpost site, system by system: the planets' first, then the belts'. */
export function outpostSites(): readonly OutpostSite[] {
  sites ??= [
    ...WORLD_SEEDS.filter((s) => !s.curated).flatMap((s) =>
      s.planets
        .filter((p) => getPlanet(p.id)?.status === 'confirmed')
        .flatMap((p): OutpostSite[] => {
          const kinds = kindsAt(s.id, (p.massEarth ?? 0) <= GIANT_EARTH_MASSES);
          if (!kinds.length) return [];
          const r = rng(WORLD_SEED, 'outpost-site', p.id);
          const [d0, d1] = OUTPOSTS.orbit.distance;
          const [h0, h1] = OUTPOSTS.orbit.height;
          return [{ id: p.id, planetId: p.id, systemId: s.id, orbit: { distance: Math.round(r.range(d0, d1)), angle: Math.round(r.range(0, 360)), height: Math.round(r.range(h0, h1)) }, kinds }];
        }),
    ),
    ...BELTS.map((b): OutpostSite => ({ id: beltSiteId(b.id), beltId: b.id, systemId: b.systemId, ring: { angle: beltAngle(b.id) }, kinds: OUTPOSTS.belts.kinds })),
  ];
  return sites;
}

/** A belt site's id. */
export const beltSiteId = (beltId: string): string => `belt.${beltId}`;

/** Where round its ring a belt's site lies: drawn from the belt's id, unless the rules set it (to keep it clear of a station). */
function beltAngle(beltId: string): number {
  const set = (OUTPOSTS.belts.angle as Partial<Record<string, number>>)[beltId];
  return set ?? Math.round(rng(WORLD_SEED, 'outpost-belt', beltId).range(0, 360));
}

/** The kinds the world's rules allow an outpost to be in a system: within each kind's security band; a mine only round a small planet. */
function kindsAt(systemId: SystemId, small: boolean): StationType[] {
  const security = WORLD.profiles.get(systemId)?.security ?? 1;
  return OUTPOSTS.kinds.filter((k) => {
    const rule = STATION_TYPES.find((t) => t.type === k);
    if (!rule || security < rule.security[0] || security > rule.security[1]) return false;
    return k !== 'mining-outpost' || small;
  });
}

export function outpostSite(siteId: string): OutpostSite | undefined {
  return outpostSites().find((s) => s.id === siteId);
}

/** Sites in one system. */
export function sitesIn(systemId: SystemId): OutpostSite[] {
  return outpostSites().filter((s) => s.systemId === systemId);
}

/** The station id of an outpost at a site. */
export const outpostId = (siteId: string): string => `outpost.${siteId}`;

/** The site of an outpost's station id (undefined for any other station). */
export function siteOfStation(locationId: string): OutpostSite | undefined {
  return isOutpostId(locationId) ? outpostSite(locationId.slice('outpost.'.length)) : undefined;
}

/** True for the id of a player's outpost. */
export const isOutpostId = (id: string): boolean => id.startsWith('outpost.');

/** The names offered for an outpost of a kind at a site: three of the name words, with the noun of its kind. */
export function outpostNames(siteId: string, kind: StationType): string[] {
  const r = rng(WORLD_SEED, 'outpost-name', siteId, kind);
  const nouns = STATION_TYPES.find((t) => t.type === kind)?.nouns ?? ['Outpost'];
  const words = [...OUTPOSTS.nameWords];
  const out: string[] = [];
  for (let i = 0; i < 3 && words.length; i++) {
    const w = words.splice(Math.floor(r.next() * words.length), 1)[0]!;
    out.push(`${w} ${r.pick(nouns)}`);
  }
  return out;
}

const KIND_WORD: Record<StationType, string> = {
  'trade-port': 'trade port',
  'customs-depot': 'customs depot',
  shipyard: 'shipyard',
  'mining-outpost': 'mine',
  refinery: 'refinery',
  factory: 'factory',
  'agri-station': 'farm',
  'research-station': 'research station',
  relay: 'relay',
  'military-base': 'military base',
  freeport: 'free port',
  'pirate-den': 'den',
};

/** What a kind of station is called in a sentence ("a farm", "a free port"). */
export const kindWord = (kind: StationType): string => KIND_WORD[kind];

/** Where a site is, in words: "Kepler-1 b" or "the debris disc of Tau Ceti". */
export function sitePlace(site: OutpostSite): string {
  if (site.planetId) return getPlanet(site.planetId)?.displayName ?? site.planetId;
  return findBelt(site.beltId!)?.name ?? site.id;
}

/**
 * The player's outpost as a station (the save's own, docs/PROCGEN.md §22, §36): being built (its
 * frame going up: docking only, a shipyard's frames to look at), then open with the services of the
 * stages done. Independent: the player runs it, and no faction's standing touches it.
 */
export function outpostLocation(o: OutpostRecord): FictionalLocation | null {
  const site = outpostSite(o.site);
  if (!site) return null;
  const planet = site.planetId ? getPlanet(site.planetId) : undefined;
  const belt = site.beltId ? findBelt(site.beltId) : undefined;
  if (!planet && !belt) return null;
  const done = o.stage > 0 ? OUTPOSTS.stages[Math.min(o.stage, OUTPOSTS.stages.length) - 1]! : null;
  const hostId = planet?.hostId ?? belt!.hostId;
  const star = WORLD_SEEDS.find((s) => s.id === site.systemId)?.stars.find((x) => x.id === hostId);
  const system = getSystem(site.systemId).displayName;
  const at = planet ? `in orbit of ${planet.displayName}` : `in the ${belt!.name}`;
  return {
    id: outpostId(o.site),
    name: o.name,
    systemId: site.systemId,
    kind: KIND_OF[o.kind],
    fictional: true,
    status: 'functional',
    description: done
      ? `Your ${kindWord(o.kind)} ${at}: a ${done.name.toLowerCase()} you built, run by your people.`
      : `Your ${kindWord(o.kind)}, its frame going up ${at} (${system}): it opens when the materials are in.`,
    services: done ? [...done.services] : [],
    ...(planet ? { nearBodyId: planet.id } : {}),
    stationType: o.kind,
    look: {
      type: done ? o.kind : OUTPOSTS.building.look,
      owner: 'independent',
      seed: rng(WORLD_SEED, 'outpost-look', o.site).int(0, 1_000_000),
      starColor: star?.colorHex ?? '#ffffff',
      size: done ? done.size : OUTPOSTS.building.size,
      wear: OUTPOSTS.wear,
    },
  };
}
