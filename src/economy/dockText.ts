import type { GameState } from '../app/state.ts';
import { pyreWelcome } from './doomed.ts';
import { getLocation } from '../data/systems.ts';
import { standingTier } from './factions.ts';
import { occupied } from './border.ts';
import { dockAccess, wakeFriendly } from './law.ts';
import { rankGreeting } from './ranks.ts';

/**
 * Dock welcome lines (fiction). They change with the player's standing so reputation has a
 * visible effect alongside price and repair discounts and contract availability.
 */
const WELCOME: Record<string, { neutral: string; friendly: string }> = {
  'earth-port': {
    neutral: 'Halcyon Ring traffic control: berth assigned. Market, outfitter and contract board are open.',
    friendly:
      'Halcyon Ring: welcome back, pilot. The Transit Authority has flagged your record — hull repairs are discounted for you.',
  },
  'mars-depot': {
    neutral: 'Deimos Depot customs: state your cargo and destination. Interstellar departure clearance is issued here.',
    friendly:
      'Deimos Depot: that raider had been hitting our lane for weeks. Good shooting. Repairs are on the Authority’s discount list for you.',
  },
  'meridian-outpost': {
    neutral: 'Meridian Outpost: you’re a welcome sight out here. Please tell us you brought supplies.',
    friendly: 'Meridian Outpost: Meridian remembers who came through for us, pilot. Co-op prices for you, always.',
  },
  'barnard-relay': {
    neutral: 'Barnard Transit Relay: three crew, one kettle, plenty of fuel. Make yourself at home.',
    friendly: 'Barnard Transit Relay: the Authority speaks well of you. Kettle’s on.',
  },
  'sirius-platform': {
    neutral: 'Horizon Platform: keep your radiation shutters closed on approach. Visitors welcome in the observation ring.',
    friendly: 'Horizon Platform: the Cooperative vouches for you. The survey office has work for trusted pilots.',
  },
  'eridani-hub': {
    neutral: 'Eridani Mining Hub: mind the conveyor arms. Ore’s cheap and the fuel’s cheaper.',
    friendly: 'Eridani Mining Hub: the belt crews know your name now. Co-op rates on everything.',
  },
};

export function welcomeText(state: GameState, locationId: string): { text: string; improved: boolean } {
  const base = baseWelcome(state, locationId);
  // A ranked pilot is greeted by rank (docs/PROCGEN.md §32.5), but not at a station the Wake holds.
  const greet = occupied(locationId, state.clock, state.world.border) ? null : rankGreeting(state, locationId);
  return greet ? { ...base, text: `${base.text} ${greet}` } : base;
}

function baseWelcome(state: GameState, locationId: string): { text: string; improved: boolean } {
  const loc = getLocation(locationId);
  // The law and the Wake greet you in their own way (docs/PROCGEN.md §12).
  if (loc.stationType === 'pirate-den') return { text: `${loc.name}: the Wake knows your ship. Keep your guns cold in here and your mouth shut out there.`, improved: false };
  // A station the Wake took on a border front (docs/PROCGEN.md §20).
  if (occupied(locationId, state.clock, state.world.border)) {
    return wakeFriendly(state)
      ? { text: `${loc.name}: the Hollow Wake holds this station now. Friends of the Wake come and go as they like.`, improved: false }
      : { text: `${loc.name}, held by the Hollow Wake: an emergency berth and repairs for a lawful pilot, and nothing else.`, improved: false };
  }
  if (dockAccess(state, locationId) === 'emergency') {
    return { text: `${loc.name} traffic control: you are flagged. Emergency berth only: repairs, and the customs desk if you mean to settle up.`, improved: false };
  }
  // Pyre's stations (docs/PROCGEN.md §26), as its story stands.
  const pyre = pyreWelcome(locationId, state.clock, state.world.sky?.edge ?? null);
  if (pyre) return { text: pyre, improved: false };
  const lines = WELCOME[locationId];
  if (!lines) return { text: `${getLocation(locationId).name}: docking complete.`, improved: false };
  const faction = getLocation(locationId).factionId;
  const tier = faction ? standingTier(state.reputation[faction] ?? 0) : 'neutral';
  const improved = tier === 'friendly' || tier === 'trusted';
  return { text: improved ? lines.friendly : lines.neutral, improved };
}
