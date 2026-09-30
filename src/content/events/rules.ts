import type { CommodityCategory, CommodityId } from '../economy/goods.ts';

/**
 * World event rules (docs/PROCGEN.md §11): what can happen at stations and in systems, how often,
 * for how long and how strongly. The event engine (src/economy/events.ts) is a pure function of
 * these rules, the world, the market tables and the game clock.
 */

export type StationEventKind = 'shortage' | 'glut' | 'boom' | 'strike';
export type SystemEventKind = 'raid' | 'sweep';
export type EventKind = StationEventKind | SystemEventKind;

export const EVENTS = {
  /**
   * Every station has one time window after another; in each, at most one event, which starts and
   * ends inside the window (so a station never has two at once). Game-clock seconds.
   */
  stationWindow: 7_200,
  /** Chance per window of each kind of station event. */
  stationOdds: { shortage: 0.18, glut: 0.1, boom: 0.07, strike: 0.05 } satisfies Record<StationEventKind, number>,
  stationDuration: [1_800, 5_400] as const,
  systemWindow: 10_800,
  systemOdds: { raid: 0.22, sweep: 0.12 } satisfies Record<SystemEventKind, number>,
  systemDuration: [2_400, 6_000] as const,
  /**
   * Market effects: `price` multiplies the equilibrium price of the goods concerned and `stock`
   * their normal stock (which moves the price further through scarcity).
   */
  effects: {
    shortage: { price: [1.2, 1.4], stock: 0.6 },
    glut: { price: [0.7, 0.85], stock: 1.8 },
    boom: { price: [1.15, 1.3], stock: 0.8 },
    strike: { price: [1.2, 1.35], stock: 0.5 },
  } satisfies Record<StationEventKind, { price: readonly [number, number]; stock: number }>,
  /** Raids happen below this security (never in the hand-made core), sweeps where raider packs roam in claimed space. */
  raidBelowSecurity: 0.75,
  /** During a raid: one threat level more (at most 3), one more pack, half the traders, the first pack sooner. */
  raid: { extraPacks: 1, traderScale: 0.5, firstDelay: 20, intervalScale: 0.7 },
  /** During a sweep: no packs, one more patrol wing (at most two). */
  sweep: { extraWings: 1 },
  /** News reaches this many jumps, and reports events that ended this long ago. */
  newsJumps: 2,
  newsRecent: 1_800,
  /** A jump through the lanes takes this long on the game clock, per hop. */
  jumpSeconds: 120,
  /** The world answers (docs/PROCGEN.md §17): what the player does ends events early. */
  react: {
    /** A shortage ends once the player has sold the station this share of what it lacks. */
    relief: 0.6,
    /** Relieving a shortage pays this share of the goods' base value on top of the sales. */
    reliefBonus: 0.25,
    /** Standing with the station's (or system's) faction for relieving a shortage or breaking a raid. */
    standing: 3,
    /** A raid breaks after this many raiders are destroyed in its system, plus one per threat level. */
    raidKills: 3,
  },
};

/** Station booms: what a station is suddenly hungry for (`{place}` is the station's name). */
export const BOOMS: readonly { id: string; name: string; goods: readonly CommodityId[]; why: string }[] = [
  { id: 'construction', name: 'Construction boom', goods: ['machinery', 'metals', 'polymers', 'habitat-modules'], why: 'New ring sections are going up at {place}' },
  { id: 'festival', name: 'Founders’ festival', goods: ['fine-food', 'luxuries', 'consumer-goods', 'food'], why: '{place} is celebrating its founding' },
  { id: 'research', name: 'Research push', goods: ['electronics', 'helium-3', 'fabricators', 'research-samples'], why: '{place} has funded a new research programme' },
  { id: 'refit', name: 'Fleet refit', goods: ['ship-parts', 'deuterium', 'electronics', 'machinery'], why: 'A convoy is refitting in the docks at {place}' },
];

/** What might have caused a shortage of a kind of good (the wording only; the rules decide the facts). */
export const SHORTAGE_CAUSES: Record<CommodityCategory, readonly string[]> = {
  raw: ['A cracked storage tank', 'A burst of new construction'],
  fuel: ['A reactor refit', 'A rush of lane traffic'],
  refined: ['A delayed ore barge', 'A run of repair work'],
  food: ['A blight in the hydroponics bays', 'A spoiled shipment'],
  manufactured: ['A supply convoy lost to raiders', 'A rush order from the yards'],
  science: ['A visiting survey fleet', 'A new research programme'],
  luxury: ['A wedding season', 'A visiting delegation'],
  restricted: ['A security scare'],
  salvage: ['A recycling drive'],
  contraband: ['A crackdown on the smugglers'],
};

export const GLUT_CAUSES: readonly string[] = ['A bumper output', 'A cancelled order', 'A new production line'];
export const STRIKE_CAUSES: readonly string[] = ['over pay', 'over safety in the work bays', 'over long shifts'];
