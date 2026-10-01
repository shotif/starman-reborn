import type { CommodityId } from '../economy/goods.ts';

/**
 * Lasting marks (docs/PROCGEN.md §14.7): what a story's ending changes at a station for good, once
 * its finale is done. A mark moves the station's market like a world event that never ends, and
 * puts a standing run on its job board in every time slot. Everything here is fiction. The marks a
 * settled border front leaves are made from the fronts themselves (economy/marks.ts).
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
];

