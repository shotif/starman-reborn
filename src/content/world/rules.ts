import type { FactionId, LocationService, SystemId } from '../../data/types.ts';
import type { ManufacturerId, ShipClassId, Tier } from '../types.ts';
import type { StationOwner, StationType } from './types.ts';

/**
 * World rules (docs/PROCGEN.md §7): who holds which space, what kinds of station exist where,
 * how they are named. The generator (generate.ts) is a pure function of these rules, the observed
 * catalogue and WORLD_SEED; the guardrails live in validate.ts.
 */

/** Fixed seed of the static world: every player flies the same stations and jump lanes. */
export const WORLD_SEED = 0x57a2_0001;

// ---------------------------------------------------------------- territory

/**
 * Home systems of the lawful factions. Influence falls off with distance
 * (weight / (1 + (d / reach)²)); a system belongs to the strongest faction if its influence
 * passes `claimThreshold`, and its security grows with that influence.
 */
export const TERRITORY = {
  anchors: [
    { system: 'sol', owner: 'sta', weight: 1.3 },
    { system: 'barnard', owner: 'sta', weight: 0.45 },
    { system: 'alpha-centauri', owner: 'frontier', weight: 0.8 },
    { system: 'sirius', owner: 'frontier', weight: 0.6 },
    { system: 'epsilon-eridani', owner: 'frontier', weight: 0.7 },
  ] as const satisfies readonly { system: SystemId; owner: FactionId; weight: number }[],
  reachLy: 5,
  /** Chosen so that claimed space is never lawless (claimThreshold × securityScale ≥ lawlessBelow). */
  claimThreshold: 0.32,
  /** Security = clamp(influence × scale, min, max). */
  securityScale: 1.15,
  securityRange: [0.08, 1] as const,
  /** Below this, pirates operate openly: dens appear, patrols are rare. */
  lawlessBelow: 0.35,
};

// ---------------------------------------------------------------- jump network

export const NETWORK = {
  /** Every system gets at least this many links. */
  minLinks: 2,
  maxLinks: 5,
  /** Longest extra link added to reach `minLinks`, and the longest link of any kind (guardrail). */
  maxExtraLinkLy: 8.5,
  maxLinkLy: 9.5,
  /** Very short hops become links too, for loops. */
  shortcutLy: 3.2,
};

// ---------------------------------------------------------------- growth

/**
 * The world grows (docs/PROCGEN.md §7.7): systems the sky snapshot adds are placed after the frozen
 * core (content/world/core-seeds.json), which never changes. They get lanes of their own (a lane
 * always touches a new system, so no lane between two core systems is added), territory from the
 * same anchors, and stations named from their own pools.
 */
export const GROWTH = {
  /** New systems farther than this from Sol are the frontier: their lanes need a long-range jump drive. */
  frontierLy: 17.5,
  /** Longest lane into or across the frontier (the long-range drive's reach), and the longest extra lane. */
  maxLinkLy: 12,
  maxExtraLinkLy: 10,
  /** Unclaimed systems with a listed planet, or an F, G or K star, are settled by independent colonies
   * that keep a militia: their security is drawn from this range (at least), so farms, labs and free
   * ports can open there. */
  colonySecurity: [0.3, 0.42] as const,
  /** Chance of a raider den in a lawless new system: the frontier is thinner than the core's edge. */
  denChance: 0.4,
};

// ---------------------------------------------------------------- stations

export type AnchorKind = 'star' | 'planet' | 'giant' | 'small-planet';

export interface StationTypeRule {
  type: StationType;
  /** Name nouns ("Refinery", "Smelter"). */
  nouns: readonly string[];
  services: readonly LocationService[];
  /** What it orbits, in order of preference: its star, any confirmed planet, a giant planet or a small one. */
  anchor: readonly AnchorKind[];
  /** look.size range. */
  size: readonly [number, number];
  /** Choice weight and when it applies. */
  weight: number;
  /** Allowed security range. */
  security: readonly [number, number];
  /** Extra weight for systems with an F, G or K star, per confirmed planet, a white dwarf, or for claimed or unclaimed space. */
  bonus?: { sunlike?: number; perPlanet?: number; whiteDwarf?: number; claimed?: number; unclaimed?: number };
  maxPerSystem: number;
  /** Who runs it: the system's owner, always independents, or raiders. */
  owner: 'territory' | 'independent' | 'hollow-wake';
  /** Description template: {anchor} and {system} are filled from the catalogue. */
  describe: string;
}

const TRADE: LocationService[] = ['market', 'repair', 'contracts'];
const FULL: LocationService[] = ['market', 'repair', 'equipment', 'contracts'];

export const STATION_TYPES: readonly StationTypeRule[] = [
  {
    type: 'trade-port',
    nouns: ['Port', 'Exchange', 'Concourse'],
    services: FULL,
    anchor: ['planet', 'star'],
    size: [0.75, 1],
    weight: 2,
    security: [0.55, 1],
    bonus: { sunlike: 2, claimed: 1 },
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'A busy civilian port in orbit of {anchor}, where haulers from across the region trade.',
  },
  {
    type: 'customs-depot',
    nouns: ['Depot', 'Checkpoint', 'Tollgate'],
    services: FULL,
    anchor: ['star'],
    size: [0.5, 0.75],
    weight: 1,
    security: [0.6, 1],
    bonus: { claimed: 1 },
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'A customs and refit depot watching the lanes of {system}.',
  },
  {
    type: 'shipyard',
    nouns: ['Yards', 'Drydock', 'Slipway'],
    services: FULL,
    anchor: ['giant', 'planet', 'star'],
    size: [0.8, 1],
    weight: 0.6,
    security: [0.5, 1],
    bonus: { claimed: 1 },
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'Construction frames and drydocks in orbit of {anchor}, building hulls for the frontier.',
  },
  {
    type: 'mining-outpost',
    nouns: ['Mine', 'Diggings', 'Quarry'],
    services: TRADE,
    anchor: ['small-planet'],
    size: [0.25, 0.5],
    weight: 2,
    security: [0, 1],
    bonus: { perPlanet: 0.8, unclaimed: 1 },
    maxPerSystem: 2,
    owner: 'territory',
    describe: 'A rugged mining outpost working {anchor} for ore and ice.',
  },
  {
    type: 'refinery',
    nouns: ['Refinery', 'Smelter', 'Stillworks'],
    services: TRADE,
    anchor: ['star'],
    size: [0.45, 0.7],
    weight: 1.4,
    security: [0.15, 1],
    bonus: { perPlanet: 0.4 },
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'A refinery turning the ore and ice of {system} into metals and fuel.',
  },
  {
    type: 'factory',
    nouns: ['Works', 'Assembly', 'Fabrication'],
    services: FULL,
    anchor: ['star'],
    size: [0.5, 0.75],
    weight: 1.2,
    security: [0.45, 1],
    bonus: { claimed: 1 },
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'Fabrication blocks building machinery and electronics from refined metals.',
  },
  {
    type: 'agri-station',
    nouns: ['Gardens', 'Farmstead', 'Orchard'],
    services: TRADE,
    anchor: ['star'],
    size: [0.45, 0.75],
    weight: 1,
    security: [0.25, 1],
    bonus: { sunlike: 3 },
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'Greenhouse rings growing food in the light of {anchor}.',
  },
  {
    type: 'research-station',
    nouns: ['Observatory', 'Institute', 'Array'],
    services: FULL,
    anchor: ['planet', 'star'],
    size: [0.35, 0.6],
    weight: 1.2,
    security: [0.2, 1],
    bonus: { perPlanet: 0.6, whiteDwarf: 3 },
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'A research station studying {anchor} from orbit.',
  },
  {
    type: 'relay',
    nouns: ['Relay', 'Waypoint', 'Signal'],
    services: ['market', 'repair'],
    anchor: ['star'],
    size: [0.15, 0.3],
    weight: 1.1,
    security: [0, 1],
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'A small fuel and message relay on the lanes through {system}.',
  },
  {
    type: 'military-base',
    nouns: ['Garrison', 'Watch', 'Fort'],
    services: ['repair', 'equipment', 'contracts'],
    anchor: ['star'],
    size: [0.55, 0.85],
    weight: 0.8,
    security: [0.4, 0.8],
    bonus: { claimed: 1.5 },
    maxPerSystem: 1,
    owner: 'territory',
    describe: 'A patrol base holding the edge of claimed space at {system}.',
  },
  {
    type: 'freeport',
    nouns: ['Freeport', 'Bazaar', 'Haven'],
    services: FULL,
    anchor: ['star'],
    size: [0.45, 0.8],
    weight: 2,
    security: [0, 0.45],
    bonus: { unclaimed: 2 },
    maxPerSystem: 1,
    owner: 'independent',
    describe: 'An independent free port of patched modules and neon; few questions asked.',
  },
];

// ---------------------------------------------------------------- shops

/** Whose equipment a station's outfitter sells: one or two of its owner's makers, picked per station. */
export const OWNER_MAKERS: Record<StationOwner, readonly ManufacturerId[]> = {
  sta: ['halden', 'ares'],
  frontier: ['toliman', 'horizon', 'eridani'],
  // Free ports always carry Wake salvage plus one lawful maker's stock.
  independent: ['halden', 'ares', 'toliman', 'horizon', 'eridani'],
  'hollow-wake': ['wake'],
};

/**
 * Outfitter and shipyard by station type (stations that sell equipment). Other stations with
 * repairs sell consumables only. Class 4 and 5 still need standing with the owner (balance.ts).
 */
export const STATION_SHOPS: Partial<Record<StationType, { maxClass: Tier; ships: readonly ShipClassId[]; maxShipTier: Tier; makers: 1 | 2 }>> = {
  'trade-port': { maxClass: 3, ships: ['courier', 'freighter', 'light-fighter', 'surveyor'], maxShipTier: 2, makers: 2 },
  'customs-depot': { maxClass: 3, ships: [], maxShipTier: 1, makers: 1 },
  shipyard: { maxClass: 4, ships: ['courier', 'light-fighter', 'heavy-fighter', 'gunship', 'freighter', 'surveyor'], maxShipTier: 3, makers: 2 },
  factory: { maxClass: 3, ships: [], maxShipTier: 1, makers: 2 },
  'research-station': { maxClass: 2, ships: ['surveyor', 'courier'], maxShipTier: 2, makers: 1 },
  'military-base': { maxClass: 4, ships: ['light-fighter', 'heavy-fighter', 'gunship'], maxShipTier: 3, makers: 1 },
  freeport: { maxClass: 3, ships: ['courier', 'light-fighter', 'heavy-fighter', 'freighter'], maxShipTier: 2, makers: 1 },
};

/** Raider hideouts: added to lawless systems, far from the star, never dockable. */
export const PIRATE_DEN = {
  type: 'pirate-den' as const,
  nouns: ['Den', 'Nest', 'Roost'],
  size: [0.3, 0.55] as const,
  describe: 'A Hollow Wake hideout lurking in the outer dark of {system}.',
  /** Chance per lawless system, and never within this many jumps of Sol. */
  chance: 0.75,
  minJumpsFromSol: 2,
};

/** How many stations a generated system gets (before any pirate den). */
export const STATION_COUNT = {
  base: 1,
  /** +1 with two or more confirmed planets, +1 around an F, G or K star, +1 in well-patrolled space. */
  manyPlanets: 2,
  secureAbove: 0.55,
  max: 4,
};

// ---------------------------------------------------------------- names

/**
 * First words of station names by owner, so a name hints at who runs the place ("Covenant
 * Depot" is Transit Authority, "Briar Gardens" Frontier, "Magpie Freeport" independent).
 * Words must not repeat ship or equipment names or real places (validate.ts checks).
 */
export const NAME_WORDS: Record<StationOwner, readonly string[]> = {
  sta: [
    'Anchor', 'Beacon', 'Charter', 'Compass', 'Concord', 'Covenant', 'Harbour', 'Keystone', 'Mainstay', 'Northgate', 'Sentinel', 'Steward',
    'Tiller', 'Vanguard', 'Warden', 'Bearing', 'Signet', 'Pennant', 'Plumbline', 'Lodestone', 'Standard', 'Crownpoint', 'Holdfast', 'Midway',
    'Accord', 'Bastion', 'Capstone', 'Cornerstone', 'Custodian', 'Fairway', 'Heading', 'Helm', 'Ledger', 'Mandate', 'Marshal', 'Muster',
    'Provost', 'Quorum', 'Regent', 'Sextant', 'Tribune', 'Trustee', 'Waymark', 'Wayfarer',
  ],
  frontier: [
    'Amberfield', 'Briar', 'Clover', 'Dawnfield', 'Fernhollow', 'Goldmoss', 'Hearthstone', 'Honeycomb', 'Moss', 'Oakridge', 'Prairie', 'Ridgeway',
    'Saltmarsh', 'Thistle', 'Wildrye', 'Heather', 'Bramble', 'Kelp', 'Lichen', 'Sorrel', 'Tamarack', 'Willowbend', 'Marigold', 'Cottongrass',
    'Barley', 'Bluebell', 'Buttercup', 'Dogwood', 'Elderflower', 'Foxglove', 'Hazel', 'Larkspur', 'Meadowlark', 'Millstone', 'Nettle', 'Pinecone',
    'Rushwater', 'Sagebrush', 'Sheaf', 'Stonecrop', 'Sweetwater', 'Wheatear', 'Wickerwork', 'Yarrow', 'Bracken', 'Chamomile', 'Gorse', 'Sunflower',
  ],
  independent: [
    'Brass', 'Carnival', 'Cobalt', 'Fortune', 'Jackpot', 'Lucky', 'Magpie', 'Neon', 'Paradox', 'Rumour', 'Sixpence', 'Tinker',
    'Velvet', 'Wildcard', 'Copperjack', 'Hustle', 'Kaleidoscope', 'Loophole', 'Mongrel', 'Patchwork', 'Quicksilver', 'Ragtag', 'Sundry', 'Whistle',
    'Bijou', 'Cheapjack', 'Curio', 'Dazzle', 'Doubloon', 'Fiddler', 'Flotsam', 'Gewgaw', 'Hazard', 'Jamboree', 'Knickknack', 'Lucre',
    'Marquee', 'Medley', 'Moonshine', 'Oddment', 'Pinball', 'Razzle', 'Scallywag', 'Shindig', 'Trinket', 'Vagabond', 'Wanderlust', 'Zigzag',
  ],
  'hollow-wake': [
    'Ashfall', 'Blackwater', 'Carrion', 'Gallows', 'Graveyard', 'Hollowpoint', 'Murk', 'Rustheap', 'Soot', 'Wrack', 'Bonepile', 'Deadlight',
    'Gloom', 'Mire', 'Scrapheap', 'Vulture', 'Blight', 'Charnel', 'Cutthroat', 'Dregs', 'Gibbet', 'Grimhold', 'Hulkyard', 'Maw',
    'Nightshade', 'Ossuary', 'Ratline', 'Razorback', 'Sepulchre', 'Shipbreaker', 'Slag', 'Sump', 'Wormwood',
  ],
};

/**
 * First words for the stations of systems the world grows into (§7.7): a separate pool, so the
 * core's names never shift. Independents get the most (the frontier is theirs): shore birds, sky and
 * weather. When a pool runs out, a station is named after its system ("Luhman 16 Relay").
 */
export const GROWTH_NAME_WORDS: Record<StationOwner, readonly string[]> = {
  sta: [
    'Outrider', 'Picket', 'Sentry', 'Watchtower', 'Vigil', 'Garrison', 
    'Convoy', 'Courier', 'Dispatch', 'Semaphore', 'Heliograph', 'Registry', 'Magistrate', 'Chancellor', 'Envoy', 'Consul', 'Legate', 'Herald',
    'Surveyor', 'Pilotage', 'Lamplighter', 'Harbourmaster', 'Tollgate', 'Crossing', 'Gatehouse', 'Checkpoint', 'Watchfire', 'Roundhouse', 'Boundary',
  ],
  frontier: [
    'Orchard', 'Vineyard', 'Harvest', 'Haystack', 'Furrow', 'Paddock', 'Pasture', 'Meadowsweet', 'Clearwater', 'Springwell', 'Ploughshare', 'Seedbank',
    'Rootstock', 'Sapling', 'Saffron', 'Cardamom', 'Rosehip', 'Blackthorn', 'Birch', 
    'Hornbeam', 'Sycamore', 'Chestnut', 'Walnut', 'Almond', 'Apricot', 'Quince', 'Damson', 'Bilberry', 'Cloudberry', 'Lingonberry', 'Samphire',
    'Marram', 'Cattail', 'Watercress', 'Rosemary', 'Lavender', 'Primrose', 'Cowslip', 'Oxlip', 'Beechnut', 'Hayloft', 'Cornflower', 'Poppyfield', 'Dewpond',
  ],
  independent: [
    'Farhaven', 'Cairn', 'Driftwood', 'Harrow', 'Sable', 'Hollyhock', 'Firefly',
    'Glimmer', 'Homestead', 'Waypoint', 'Lastlight', 'Farthing', 'Rambler', 'Tumbleweed', 'Longshot', 'Goodwill', 'Serendipity', 'Solace', 'Respite',
    'Freehold', 'Landfall', 'Starfall', 'Skylark', 'Swallow', 'Sparrow', 'Wren', 'Plover', 'Curlew', 'Heron', 'Egret', 'Osprey',
    'Puffin', 'Jackdaw', 'Starling', 'Linnet', 'Siskin',
    'Bunting', 'Pipit', 'Dunlin', 'Sanderling', 'Whimbrel', 'Godwit', 'Avocet', 'Lapwing', 'Dotterel', 'Redshank', 'Greenshank', 'Turnstone',
    'Oystercatcher', 'Cobblestone', 'Hopscotch', 'Lamplight', 'Moonrise', 'Daybreak', 'Evensong', 'Twilight', 
    'Redshift', 'Doppler', 'Nimbus', 'Cirrus', 'Stratus', 'Cumulus', 'Zephyr', 'Mistral', 'Sirocco', 'Monsoon', 'Chinook', 'Squall',
    'Drizzle', 'Thunderhead', 'Rainbow', 'Moonbow', 'Sundog', 'Afterglow', 'Starlit', 'Lodestar', 'Polestar', 'Sunward', 'Outbound', 'Homebound',
    'Tinderbox', 'Kettle', 'Teapot', 'Lanyard', 'Bollard', 'Capstan', 'Windlass', 'Gangway', 'Porthole', 'Hammock', 'Lighthouse', 
    'Seawall', 'Jetty', 'Slipway', 'Mooring', 'Tideline', 'Saltpan', 'Sandbar', 'Shingle', 'Rockpool', 'Seaglass', 'Cowrie', 'Conch',
    'Flintlock', 'Tinsmith', 'Candlewick', 'Paperkite', 'Hobnail', 'Stovepipe', 'Rushlight', 'Wagonwheel', 'Crossroads', 'Signpost', 'Milepost', 'Hitching',
  ],
  'hollow-wake': [
    'Cutlass', 'Scuttle', 'Plunder', 'Marauder', 'Corsair', 'Buccaneer', 'Freebooter', 'Brigand', 'Reaver', 'Crossbones', 'Deadweight', 'Keelhaul',
    'Bilge', 'Barnacle', 'Jetsam', 'Maelstrom', 'Whirlpool', 'Darkwater', 'Coldiron', 'Rustbucket', 'Scrapyard', 'Junkheap',
    'Tombstone', 'Cenotaph', 'Barrow', 'Crypt', 'Deadfall', 'Gutter', 'Cinderblock', 'Shiv', 'Rotgut', 'Ransom', 'Blackflag', 'Lowtide', 'Sinkhole',
  ],
};
