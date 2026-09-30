import type { GameState } from '../app/state.ts';
import { COMMODITIES, COMMODITY_IDS } from '../content/economy/goods.ts';
import { ALL_LOCATIONS, getLocation, getSystem } from '../data/systems.ts';
import { cargoCount } from './cargo.ts';
import { contrabandIn, dockAccess, fineOwed, isLawful, totalFines } from './law.ts';
import { codexEntries } from './progress.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import { storyWaiting } from './story.ts';
import { routeOpportunities, bestKnownSale } from './trade.ts';

/**
 * What to do next (docs/PROCGEN.md §13): when no contract is under way after the opening, the HUD
 * suggests one concrete thing, from what the player already knows: settle a fine, sell what is in
 * the hold, see someone with a story to tell (§14), catalogue a body here, run a known trade route,
 * or look at a job board nearby.
 */
export function whatNext(state: GameState): string | null {
  const here = state.location.systemId;
  // A pardon first: hunted pilots have little else they can do.
  const fines = totalFines(state);
  if (fines > 0) {
    const desk = ALL_LOCATIONS.find((l) => l.systemId === here && isLawful(l.factionId) && fineOwed(state, l.factionId as 'sta' | 'frontier') > 0);
    return desk ? `You owe ${fines} cr in fines: dock at ${desk.name} and pay at the customs desk (News) for a pardon.` : `You owe ${fines} cr in fines: pay them at any station of the faction you owe for a pardon.`;
  }
  // Goods in the hold that fetch more where you have seen them sold.
  for (const c of COMMODITY_IDS) {
    const have = cargoCount(state.ship.cargo, c);
    if (!have || contrabandIn({ [c]: have }).length) continue;
    const best = bestKnownSale(state, c);
    if (best) return `Sell your ${have} ${COMMODITIES[c].name.toLowerCase()} at ${getLocation(best.locationId).name} (${getSystem(getLocation(best.locationId).systemId).displayName}): ${best.price} cr each is the best price you know.`;
  }
  // Someone with a story mission waiting.
  const story = storyWaiting(state);
  if (story) {
    const loc = getLocation(story.job.giverLocationId);
    return `${CHARACTERS[story.job.story!.speaker].name} at ${loc.name} (${getSystem(loc.systemId).displayName}) has work for you: “${story.arc.title}”.`;
  }
  // A body here the codex lacks.
  const missing = codexEntries().find((e) => e.systemId === here && !state.codex.includes(e.id));
  if (missing) return `Catalogue ${missing.name} for the codex: select it and scan (${missing.kind === 'star' ? 'a star' : missing.kind === 'moon' ? 'a moon' : 'a planet'} of ${getSystem(here).displayName}).`;
  // A trade route from the last dock, from prices you know.
  const from = state.location.lastDockId;
  const route = routeOpportunities(state, from, () => 0).find((r) => r.profitPerItem > 0);
  if (route) {
    return `Trade idea: buy ${COMMODITIES[route.commodity].name.toLowerCase()} at ${getLocation(from).name} and sell at ${getLocation(route.destinationId).name} for about +${route.profitPerItem} cr a unit.`;
  }
  // A job board nearby.
  const board = ALL_LOCATIONS.find((l) => l.systemId === here && l.services.includes('contracts') && dockAccess(state, l.id) === 'full');
  if (board) return `Dock at ${board.name}: its job board may have work for your ship.`;
  return null;
}
