import type { GameState } from '../app/state.ts';
import { shipModel } from '../content/catalog.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { COMMODITIES, COMMODITY_IDS } from '../content/economy/goods.ts';
import { HINT } from '../content/progress/rules.ts';
import { ALL_LOCATIONS, getLocation, getSystem } from '../data/systems.ts';
import { cargoCount } from './cargo.ts';
import { systemsQuote } from './combat.ts';
import { gearOffers, hasOutfitter, hasShipyard, repairQuote, shipOffers } from './equipment.ts';
import { FACTIONS } from './factions.ts';
import { contrabandIn, dockAccess, fineOwed, isLawful, LAWFUL, totalFines } from './law.ts';
import { fittedItem, hullMax, performanceOf, shipSlots } from './loadout.ts';
import { codexEntries } from './progress.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import { storyWaiting } from './story.ts';
import { routeOpportunities, bestKnownSale } from './trade.ts';

const place = (locationId: string) => `${getLocation(locationId).name} (${getSystem(getLocation(locationId).systemId).displayName})`;

/** Stations the player has docked at that would serve them in full (known shops). */
const knownDocks = (state: GameState) => state.visitedLocations.filter((id) => dockAccess(state, id) === 'full');

/** A badly damaged ship: where a mechanic is, and what it costs. */
function repairHint(state: GameState): string | null {
  const share = state.ship.hull / hullMax(state.ship);
  const s = state.ship.systems;
  const worst = (['engines', 'guns', 'shields'] as const).reduce((a, b) => (s[b] > s[a] ? b : a));
  const hull = share < HINT.repairBelow;
  const systems = s[worst] >= HINT.systemsFrom;
  if (!hull && !systems) return null;
  const what = [
    hull ? `your hull is at ${Math.round(share * 100)}%` : '',
    systems ? (worst === 'shields' ? 'your shield generator is damaged' : `your ${worst} are damaged`) : '',
  ].filter(Boolean).join(' and ');
  const here = state.location.systemId;
  const dock = ALL_LOCATIONS.find((l) => l.systemId === here && l.services.includes('repair') && dockAccess(state, l.id) !== 'refused');
  if (!dock) return `Repairs first: ${what}. Dock wherever there is a mechanic.`;
  const cost = repairQuote(state, dock.id).cost + systemsQuote(state, dock.id);
  return `Repairs first: ${what}. The mechanic at ${dock.name} charges about ${cost} cr.`;
}

/** A ship the player can afford at a shipyard they know, with a much bigger hold or a higher tier. */
function upgradeHint(state: GameState): string | null {
  const now = performanceOf(state.ship).cargo;
  const tier = shipModel(state.ship.model).tier;
  let best: { name: string; at: string; net: number; hold: number } | null = null;
  for (const id of knownDocks(state)) {
    if (!hasShipyard(id)) continue;
    for (const o of shipOffers(state, id)) {
      if (o.blocked || o.net > state.credits - HINT.reserve) continue;
      const hold = performanceOf({ model: o.model.id, fittings: o.model.stock }).cargo;
      if (hold < now * HINT.upgradeHold && o.model.tier <= tier) continue;
      if (!best || hold > best.hold || (hold === best.hold && o.net < best.net)) best = { name: o.model.name, at: id, net: o.net, hold };
    }
  }
  if (!best) return null;
  return `An upgrade you can afford: the ${best.name} at ${place(best.at)} costs ${best.net} cr after trading in your ship, with room for ${best.hold} units (yours: ${now}).`;
}

/** The long-range drive, once the player has travelled and before they reach the frontier: the cheapest they can afford at an outfitter they know. */
function driveHint(state: GameState): string | null {
  if (performanceOf(state.ship).jumpReach > 0 || state.stats.jumps < HINT.driveAfterJumps || state.milestones['frontier-first'] !== undefined) return null;
  const free = shipSlots(state.ship).filter((slot) => slot.type === 'utility' && !fittedItem(state.ship, slot.id));
  let best: { at: string; net: number } | null = null;
  for (const id of knownDocks(state)) {
    if (!hasOutfitter(id)) continue;
    for (const slot of free) {
      for (const o of gearOffers(state, id, slot.id)) {
        if (o.item.family !== 'jump-drive' || o.blocked || o.net > state.credits - HINT.reserve) continue;
        if (!best || o.net < best.net) best = { at: id, net: o.net };
      }
    }
  }
  return best ? `The frontier past 17.5 light-years needs a long-range jump drive: ${place(best.at)} sells one for ${best.net} cr.` : null;
}

/** A lawful faction a little short of Friendly, whose best work opens there. */
function standingHint(state: GameState): string | null {
  const friendly = CONTRACTS.gateStanding;
  for (const f of LAWFUL) {
    const v = state.reputation[f] ?? 0;
    if (v >= friendly || v < friendly - HINT.friendlyWithin) continue;
    return `${friendly - v} more standing with the ${FACTIONS[f].name} makes you Friendly: its boards then offer their hardest, best-paid work.`;
  }
  return null;
}

/**
 * What to do next (docs/PROCGEN.md §13): when no contract is under way after the opening, the HUD
 * suggests one concrete thing, from what the player already knows: settle a fine, get a badly
 * damaged ship repaired, sell what is in the hold, see someone with a story to tell (§14), buy a
 * ship or a long-range drive they can afford where they have seen one, catalogue a body here, earn
 * the standing that opens a faction's best work, run a known trade route, or look at a job board
 * nearby.
 */
export function whatNext(state: GameState): string | null {
  const here = state.location.systemId;
  // A pardon first: hunted pilots have little else they can do.
  const fines = totalFines(state);
  if (fines > 0) {
    const desk = ALL_LOCATIONS.find((l) => l.systemId === here && isLawful(l.factionId) && fineOwed(state, l.factionId as 'sta' | 'frontier') > 0);
    return desk ? `You owe ${fines} cr in fines: dock at ${desk.name} and pay at the customs desk (News) for a pardon.` : `You owe ${fines} cr in fines: pay them at any station of the faction you owe for a pardon.`;
  }
  // A ship falling apart before anything else.
  const repairs = repairHint(state);
  if (repairs) return repairs;
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
  // A better ship, or the drive for the frontier, that the player can afford where they have seen it.
  const upgrade = upgradeHint(state) ?? driveHint(state);
  if (upgrade) return upgrade;
  // A body here the codex lacks.
  const missing = codexEntries().find((e) => e.systemId === here && !state.codex.includes(e.id));
  if (missing) return `Catalogue ${missing.name} for the codex: select it and scan (${missing.kind === 'star' ? 'a star' : missing.kind === 'moon' ? 'a moon' : 'a planet'} of ${getSystem(here).displayName}).`;
  // A faction a step from Friendly.
  const standing = standingHint(state);
  if (standing) return standing;
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
