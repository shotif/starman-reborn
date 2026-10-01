import type { OutpostRecord } from '../../app/state.ts';
import { getPlanet, getSystem, KIND_OF, WORLD, WORLD_SEEDS } from '../../data/systems.ts';
import type { FictionalLocation, SystemId } from '../../data/types.ts';
import { rng } from '../random.ts';
import { GIANT_EARTH_MASSES } from '../world/generate.ts';
import { STATION_TYPES, WORLD_SEED } from '../world/rules.ts';
import type { StationType } from '../world/types.ts';
import { OUTPOSTS } from './rules.ts';

/**
 * Where the player can found an outpost (docs/PROCGEN.md §22): one site in orbit of each confirmed
 * planet of the generated systems (Sol and the four other hand-made systems keep their own
 * stations), with the kinds the world's rules allow there. A pure function of the catalogue and the
 * world, the same for every player; the sites are not stations until a save charters one.
 */

export interface OutpostSite {
  /** The confirmed planet it orbits (also the site's id). */
  planetId: string;
  systemId: SystemId;
  /** Around the planet, clear of its surface (schematic units, as the world's stations). */
  orbit: { distance: number; angle: number; height: number };
  /** What an outpost here can be. */
  kinds: readonly StationType[];
}

let sites: OutpostSite[] | null = null;

/** Every outpost site, system by system. */
export function outpostSites(): readonly OutpostSite[] {
  sites ??= WORLD_SEEDS.filter((s) => !s.curated).flatMap((s) =>
    s.planets
      .filter((p) => getPlanet(p.id)?.status === 'confirmed')
      .flatMap((p) => {
        const kinds = kindsAt(s.id, (p.massEarth ?? 0) <= GIANT_EARTH_MASSES);
        if (!kinds.length) return [];
        const r = rng(WORLD_SEED, 'outpost-site', p.id);
        const [d0, d1] = OUTPOSTS.orbit.distance;
        const [h0, h1] = OUTPOSTS.orbit.height;
        return [{ planetId: p.id, systemId: s.id, orbit: { distance: Math.round(r.range(d0, d1)), angle: Math.round(r.range(0, 360)), height: Math.round(r.range(h0, h1)) }, kinds }];
      }),
  );
  return sites;
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

export function outpostSite(planetId: string): OutpostSite | undefined {
  return outpostSites().find((s) => s.planetId === planetId);
}

/** Sites in one system. */
export function sitesIn(systemId: SystemId): OutpostSite[] {
  return outpostSites().filter((s) => s.systemId === systemId);
}

/** The station id of an outpost at a site. */
export const outpostId = (planetId: string): string => `outpost.${planetId}`;

/** True for the id of a player's outpost. */
export const isOutpostId = (id: string): boolean => id.startsWith('outpost.');

/** The names offered for an outpost of a kind at a site: three of the name words, with the noun of its kind. */
export function outpostNames(planetId: string, kind: StationType): string[] {
  const r = rng(WORLD_SEED, 'outpost-name', planetId, kind);
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

/**
 * The player's outpost as a station (the save's own, docs/PROCGEN.md §22): being built (its frame
 * going up: docking only, a shipyard's frames to look at), then open with the services of the
 * stages done. Independent: the player runs it, and no faction's standing touches it.
 */
export function outpostLocation(o: OutpostRecord): FictionalLocation | null {
  const site = outpostSite(o.site);
  const planet = getPlanet(o.site);
  if (!site || !planet) return null;
  const done = o.stage > 0 ? OUTPOSTS.stages[Math.min(o.stage, OUTPOSTS.stages.length) - 1]! : null;
  const star = WORLD_SEEDS.find((s) => s.id === site.systemId)?.stars.find((x) => x.id === planet.hostId);
  const where = `${planet.displayName} (${getSystem(site.systemId).displayName})`;
  return {
    id: outpostId(o.site),
    name: o.name,
    systemId: site.systemId,
    kind: KIND_OF[o.kind],
    fictional: true,
    status: 'functional',
    description: done
      ? `Your ${kindWord(o.kind)} in orbit of ${planet.displayName}: a ${done.name.toLowerCase()} you built, run by your people.`
      : `Your ${kindWord(o.kind)}, its frame going up in orbit of ${where}: it opens when the materials are in.`,
    services: done ? [...done.services] : [],
    nearBodyId: o.site,
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
