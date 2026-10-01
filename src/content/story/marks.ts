import type { CommodityId } from '../economy/goods.ts';

/**
 * Lasting marks (docs/PROCGEN.md §14.7): what a story's ending changes at a station for good, once
 * its finale is done (or a choice ends its arc early). A mark moves the station's market like a
 * world event that never ends, and may put a standing run on its job board in every time slot.
 * Everything here is fiction. The marks a settled border front leaves are made from the fronts
 * themselves (economy/marks.ts).
 */

export interface LastingMark {
  id: string;
  /** The station it changes. */
  locationId: string;
  /** In the news within reach, for good. */
  headline: string;
  detail: string;
  /** Price and normal-stock multipliers on the goods concerned (as a world event's). */
  market: { goods: readonly CommodityId[]; price: number; stock: number };
  /** A haul the station posts in every time slot: its own produce to `to`, paid `premium` times the usual (none where it has no board, or nowhere to send it). */
  run?: { commodity: CommodityId; to: string; title: string; why: string; premium: number };
  /** Left when one of these border fronts is settled with this ending (economy/marks.ts), rather than by a story's finale. */
  front?: { ids: readonly string[]; ending: 'law' | 'wake' };
}

/** What a mark may do, so a story's ending changes a station without breaking its market. */
export const MARK_LIMITS = {
  price: [0.7, 1.2] as const,
  stock: [0.6, 2] as const,
  premium: [1, 1.5] as const,
};

export const LASTING_MARKS: readonly LastingMark[] = [
  {
    // First Harvest sold at Doppler Freeport: machinery for new fields, and a second hauler.
    id: 'harvest.freeport',
    locationId: 'harrow-farmstead',
    headline: 'Harrow Farmstead farms for two harvests',
    detail:
      'Doppler Freeport paid for Harrow’s first harvest in machinery: new fields and a second hauler. Food is plentiful at Harrow now, and its board sends fine food to Doppler by contract.',
    market: { goods: ['food', 'fine-food'], price: 0.85, stock: 1.6 },
    run: {
      commodity: 'fine-food',
      to: 'doppler-freeport',
      title: 'Harvest run',
      why: 'Harrow’s new fields keep both its haulers busy, so the harvest goes to Doppler Freeport by contract.',
      premium: 1,
    },
  },
  {
    // First Harvest given to Squall Relay's crews, who answered Harrow's calls when nobody else did.
    id: 'harvest.relay',
    locationId: 'harrow-farmstead',
    headline: 'Harrow Farmstead keeps a share for the edge',
    detail:
      'Since its first harvest fed the crews at Squall Relay, Harrow keeps a share of every harvest for the relay and a store of medicine for the edge. Its board sends the relay’s share, and pays well for it.',
    market: { goods: ['medical'], price: 0.85, stock: 1.6 },
    run: {
      commodity: 'food',
      to: 'squall-relay',
      title: 'The relay’s share',
      why: 'Squall Relay’s crews answer Harrow’s calls first, and Harrow sends them a share of every harvest, topping up what the relay can pay.',
      premium: 1.25,
    },
  },

  // ---------------------------------------------------------------- Clean Manifests (the Authority)
  {
    // The story went to the Frontier press: Deimos customs works in the open.
    id: 'sta.press',
    locationId: 'mars-depot',
    headline: 'Open manifests at Deimos Depot',
    detail:
      'Since the Vail story broke, Deimos Depot’s customs publish every manifest, and the Cooperative’s haulers trade there again: food and water are plentiful, and its board sends machinery to Eridani Mining Hub by contract.',
    market: { goods: ['food', 'water'], price: 0.9, stock: 1.5 },
    run: {
      commodity: 'machinery',
      to: 'eridani-hub',
      title: 'Open manifests',
      why: 'With Deimos Depot’s manifests open to anyone, the Cooperative buys Authority machinery again, and Eridani Mining Hub takes it by contract.',
      premium: 1.15,
    },
  },
  {
    // The Authority cleaned house quietly: Castell runs its audit, and its supply lines run clean.
    id: 'sta.internal',
    locationId: 'earth-port',
    headline: 'Clean supply lines from Halcyon Ring',
    detail:
      'Rhea Castell runs the Authority’s internal audit now, and nothing seized goes missing: medicine and fabricators are plentiful at Halcyon Ring, and its board sends medicine to Barnard Transit Relay by contract.',
    market: { goods: ['medical', 'fabricators'], price: 0.9, stock: 1.4 },
    run: {
      commodity: 'medical',
      to: 'barnard-relay',
      title: 'Audited supply',
      why: 'The Authority supplies its relays on clean manifests now, and pays the pilots it trusts a little over the usual to carry them.',
      premium: 1.15,
    },
  },
  {
    // The evidence was sold back to Vail: what the Authority seizes still leaves by the back door.
    id: 'sta.bribe',
    locationId: 'mars-depot',
    headline: 'Deimos Depot’s back door',
    detail:
      'Oren Vail kept his desk at Deimos Depot, and what the Authority seizes still leaves by the back door: weapons are cheap and plentiful there, and the Hollow Wake knows it.',
    market: { goods: ['weapons'], price: 0.8, stock: 1.6 },
  },

  // ---------------------------------------------------------------- The Stonecrop Blight (the Cooperative)
  {
    // The Gardens were sealed, Ansari's way: Dawnfield makes the cure for every farm.
    id: 'frontier.seal',
    locationId: 'dawnfield-institute',
    headline: 'Dawnfield Institute makes the blight cure',
    detail:
      'Since the Stonecrop quarantine, Dr Pell Ansari’s fungicide is made at Dawnfield Institute for every farm in the Cooperative: medicine is plentiful there, and its board sends it to Horizon Platform by contract.',
    market: { goods: ['medical'], price: 0.85, stock: 1.6 },
    run: {
      commodity: 'medical',
      to: 'sirius-platform',
      title: 'Ansari’s cure',
      why: 'Dawnfield makes medicine by the crate since the blight, and sends what the Cooperative’s outposts need to Horizon Platform by contract.',
      premium: 1.1,
    },
  },
  {
    // The worst bays were burnt and reseeded, Brandt's way: the new bays grow more than the old.
    id: 'frontier.burn',
    locationId: 'stonecrop-gardens',
    headline: 'New bays at Stonecrop Gardens',
    detail:
      'Stonecrop Gardens reseeded its burnt bays from clean stock, and they grow more than the old ones did: food and fine food are plentiful there, and its board sends food to Meridian Outpost by contract.',
    market: { goods: ['food', 'fine-food'], price: 0.85, stock: 1.6 },
    run: {
      commodity: 'food',
      to: 'meridian-outpost',
      title: 'Clean-seed harvest',
      why: 'The new bays feed the Cooperative’s outposts: Stonecrop sends food to Meridian Outpost by contract, for Amara Quist’s relief stores.',
      premium: 1.1,
    },
  },

  // ---------------------------------------------------------------- Salt’s Crew (the Hollow Wake)
  {
    // Salt was told everything: no traitor aboard, the sweep broken, and the crews trade openly.
    id: 'wake.loyal',
    locationId: 'pinball-freeport',
    headline: 'Salt’s crews trade at Pinball Freeport',
    detail:
      'With the sweep broken and no traitor at Graveyard Nest, Salt’s crews sell their salvage at Pinball Freeport: it is cheap and plentiful there, and the freeport’s board sends it to Velvet Stillworks by contract.',
    market: { goods: ['salvage'], price: 0.8, stock: 1.6 },
    run: {
      commodity: 'salvage',
      to: 'velvet-stillworks',
      title: 'Nest salvage',
      why: 'Salt’s crews bring in more salvage than Pinball Freeport can store, so the freeport sends it on to Velvet Stillworks by contract.',
      premium: 1.1,
    },
  },
  {
    // Juno Fiske was warned and got away: a new life far from any Nest.
    id: 'wake.warn',
    locationId: 'sandbar-bazaar',
    headline: 'Juno Fiske’s yard at Sandbar Bazaar',
    detail:
      'Juno Fiske turned up at Sandbar Bazaar, a long way from any Nest, and strips wrecks for a living: salvage is cheap and plentiful there, and the bazaar’s board sends it to Moss Smelter by contract.',
    market: { goods: ['salvage'], price: 0.85, stock: 1.5 },
    run: {
      commodity: 'salvage',
      to: 'moss-smelter',
      title: 'Juno’s salvage',
      why: 'Juno Fiske strips more wrecks than Sandbar Bazaar can sell, and pays a little over the usual to have it hauled to Moss Smelter.',
      premium: 1.1,
    },
  },
  {
    // The Nest was sold to the Authority: it held, but its crews fly less, and the freeport next door feels it.
    id: 'wake.betray',
    locationId: 'pinball-freeport',
    headline: 'Pinball Freeport after the Nest was sold',
    detail:
      'The Authority raided Graveyard Nest with a list of its approaches and Salt’s name at the top. The Nest held, but its crews fly less, and Pinball Freeport feels it: salvage and weapons come in rarely, and cost more.',
    market: { goods: ['salvage', 'weapons'], price: 1.15, stock: 0.7 },
  },
];
