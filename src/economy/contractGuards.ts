import { CONTRACTS, type ContractKind } from '../content/contracts/rules.ts';
import { COMMODITIES, PRICE_BAND } from '../content/economy/goods.ts';
import { beltGoods } from '../content/mining/rules.ts';
import { PASSENGERS } from '../content/passengers/rules.ts';
import { sightById } from '../content/passengers/sights.ts';
import { farStar } from './stellar.ts';
import { flaresBetween, flareStar } from './flares.ts';
import { orbitOf } from '../data/orbits.ts';
import { BINARIES } from '../content/stellar/binaries.ts';
import { ASTEROIDS } from '../content/stellar/asteroids.ts';
import { COMETS } from '../content/stellar/comets.ts';
import { asteroidOf } from '../data/asteroids.ts';
import { cometOf } from '../data/comets.ts';
import { boardDate, passingAsteroid, trackingJumps } from './asteroids.ts';
import { imagingJumps } from './comets.ts';
import { PYRE_HOLE_ID } from './pyrePhysics.ts';
import { isOutpostId } from '../content/outposts/sites.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, findBelt, getComponent, getLocation, getSystem, isFrontier, isInventedSystem, MAP_LINKS, PYRE_ID, WORLD } from '../data/systems.ts';
import { inViewFromGates, inViewFromStation } from '../world/sightseeing.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { shipModel } from '../content/catalog.ts';
import { RECOVERY_ITEMS } from '../content/contracts/rules.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { occupied } from './border.ts';
import { boardFor, CONTRACT_PREFIX, escortDanger, expectedTrip, followUpFor, postsClaims, routeFeeBetween } from './contracts.ts';
import { LAW } from '../content/law/rules.ts';
import { baseThreat, priceMultiplier, stationEventAt, stationEventById, systemEventAt } from './events.ts';
import { haulById, raidsOnWay } from './hauls.ts';
import { lawIn, scansOnDocking } from './law.ts';
import type { JobDef } from './jobs.ts';
import { marketTables } from './markets.ts';

/**
 * Contract guardrails (docs/PROCGEN.md §10.4): every board over many time slots posts sound
 * contracts: real destinations in reach, pay that beats the jump fees and repairs, deposits that
 * make stealing freight a loss, bounties and aces only where raiders roam, escorts only where there
 * is something to fear, surveys of confirmed planets, time limits that can be kept, and follow-ups
 * as sound as the contracts they follow.
 */

/** Pay must beat the fees there and back plus expected repairs by this factor. */
export const PAY_MARGIN = 1.2;
/** Expected repair bill per difficulty level. */
export const REPAIRS_PER_LEVEL = 40;
/** Largest reward any generated contract may pay. */
export const MAX_REWARD = 4_500;

type Report = (rule: string, subject: string, message: string) => void;

export function validateContracts(epochs = 40): Issue[] {
  const issues: Issue[] = [];
  const report: Report = (rule, subject, message) => issues.push({ rule, subject, message });
  const markets = marketTables();
  // Every open station with a board, and the raider dens (their boards are for pilots the Wake trusts).
  const givers = ALL_LOCATIONS.filter((l) => l.status === 'functional' && ((l.dockable !== false && l.services.includes('contracts')) || l.stationType === 'pirate-den'));
  const kinds = new Set<ContractKind>();
  let eventWork = 0;
  let urgent = 0;
  let chains = 0;
  const escorts = { local: 0, across: 0, convoy: 0 };
  let reliefEscorts = 0;
  for (const giver of givers) {
    let empty = 0;
    const jumps = jumpsFrom(WORLD.links, giver.systemId);
    for (let epoch = 0; epoch < epochs; epoch++) {
      const board = boardFor(giver.id, epoch);
      // A station the Wake holds on a border front posts nothing, by design (docs/PROCGEN.md §20).
      if (!board.length && !occupied(giver.id, epoch * CONTRACTS.epochSeconds)) empty++;
      const ids = new Set<string>();
      let answering = 0;
      for (const c of board) {
        const subject = c.id;
        if (ids.has(c.id)) report('ids', subject, 'duplicate id on a board');
        ids.add(c.id);
        if (!c.id.startsWith(`${CONTRACT_PREFIX}${giver.id}.${epoch}.`)) report('ids', subject, 'id does not name its station and time slot');
        const clock = epoch * CONTRACTS.epochSeconds;
        checkContract(c, giver.systemId, jumps, markets, report, clock);
        if (c.contract) kinds.add(c.contract.kind);
        // An escort for a haul (docs/PROCGEN.md §21.7) is posted beside the board's own event work.
        if (c.contract?.event && !c.contract.haul) answering++;
        if (c.contract?.haul) reliefEscorts++;
        if (c.contract?.urgent) urgent++;
        const o = c.objectives[0];
        if (o?.kind === 'escort') escorts[o.convoy ? 'convoy' : o.systemId === giver.systemId ? 'local' : 'across']++;
        // Follow-ups are offered where a parcel or haul ends, and must be as sound.
        const next = followUpFor(c, clock);
        if (next) {
          chains++;
          const at = getLocation(next.giverLocationId);
          if (next.contract?.chain?.step !== 2 || next.contract.chain.parent !== c.id) report('chain', next.id, 'follow-up does not name its step and parent');
          if (!next.id.startsWith(`${CONTRACT_PREFIX}${at.id}.f`)) report('ids', next.id, 'follow-up id does not name its station');
          checkContract(next, at.systemId, jumpsFrom(WORLD.links, at.systemId), markets, report, clock);
        }
      }
      if (answering > 1) report('events', giver.id, `${answering} contracts answer events in time slot ${epoch} (at most one)`);
      eventWork += answering;
    }
    if (empty > epochs * 0.1) report('boards', giver.id, `empty board in ${empty} of ${epochs} time slots`);
  }
  // Observations are posted only while a far star dies, in a save's own timeline (docs/PROCGEN.md §25): their tests check them.
  for (const k of Object.keys(CONTRACTS.maxJumps) as ContractKind[]) if (k !== 'observe' && !kinds.has(k)) report('coverage', k, 'no board ever posts this kind');
  if (!eventWork) report('coverage', 'events', 'no board ever posts work answering a world event');
  if (!urgent) report('coverage', 'urgent', 'no board ever posts an urgent job');
  if (!chains) report('coverage', 'chains', 'no delivery ever leads to a follow-up');
  for (const [k, n] of Object.entries(escorts)) if (!n) report('coverage', 'escorts', `no board ever posts a ${k === 'local' ? 'local escort' : k === 'across' ? 'escort across jumps' : 'convoy'}`);
  if (!reliefEscorts) report('coverage', 'escorts', 'no board ever posts an escort for relief or a shipment through a raid');
  return issues;
}

/**
 * An escort for a haul answers the haul's own event while it is posted (docs/PROCGEN.md §21.7): the
 * event begun by the end of the time slot, and the haul not yet set off.
 */
function escortsFor(haulId: string, eventId: string, clock: number): boolean {
  const h = haulById(haulId);
  const e = h ? stationEventById(h.relief ?? h.glut ?? '') : null;
  return !!h && !!e && e.id === eventId && e.start < clock + CONTRACTS.epochSeconds && h.depart > clock;
}

/** The guardrails' findings for one posted contract (as posted in the time slot of `clock`). */
export function contractIssues(c: JobDef, clock: number): Issue[] {
  const issues: Issue[] = [];
  const from = getLocation(c.giverLocationId).systemId;
  // Pyre's stations reach the world through its one lane (docs/PROCGEN.md §26).
  checkContract(c, from, jumpsFrom(isInventedSystem(from) ? MAP_LINKS : WORLD.links, from), marketTables(), (rule, subject, message) => issues.push({ rule, subject, message }), clock);
  return issues;
}

function checkContract(c: JobDef, from: string, jumps: ReadonlyMap<string, number>, markets: ReturnType<typeof marketTables>, report: Report, clock: number): void {
  const kind = c.contract?.kind;
  if (!kind) return report('kind', c.id, 'generated contract without a kind');
  const text = `${c.title} ${c.briefing} ${c.difficultyNote} ${c.objectives.map((o) => o.text).join(' ')}`;
  if (!c.title.trim() || !c.briefing.trim() || /undefined|NaN|\{|\}/.test(text)) report('text', c.id, 'text missing or unfilled');
  if (!Number.isFinite(c.reward) || c.reward <= 0 || c.reward > MAX_REWARD) report('pay', c.id, `reward ${c.reward} out of range`);
  if (![1, 2, 3].includes(c.difficulty)) report('difficulty', c.id, `difficulty ${c.difficulty}`);
  const gated = !!c.requires?.minRep;
  if (gated !== (c.difficulty >= CONTRACTS.gatedDifficulty && c.factionId !== null)) report('standing', c.id, 'standing gate does not match the difficulty');
  const o = c.objectives[0];
  const expected = kind === 'recovery' || kind === 'claim' || kind === 'tour' || kind === 'observe' ? 2 : 1;
  if (!o || c.objectives.length !== expected) return report('objectives', c.id, `expected ${expected} objective(s)`);

  // Where it sends you, and what the trip costs.
  const target =
    o.kind === 'scan' || o.kind === 'sight' || o.kind === 'bounty' || o.kind === 'recover' || o.kind === 'escort' || o.kind === 'piracy' || o.kind === 'mine' || o.kind === 'rescue'
      ? o.systemId
      : o.kind === 'observe' && o.systemId
        ? o.systemId
        : 'locationId' in o
          ? getLocation(o.locationId).systemId
          : from;
  const j = jumps.get(target) ?? Infinity;
  if (j > CONTRACTS.maxJumps[kind]) report('reach', c.id, `${j} jumps (at most ${CONTRACTS.maxJumps[kind]})`);
  let tripFrom = from;
  let goodsCost = 0;
  switch (kind) {
    case 'parcel':
    case 'freight': {
      if (o.kind !== (kind === 'parcel' ? 'visit' : 'deliver')) return report('objectives', c.id, `unexpected objective ${o.kind}`);
      const dest = getLocation(o.locationId);
      if (dest.dockable === false || dest.status !== 'functional' || !dest.services.length) report('destination', c.id, `${dest.id} is not an open station`);
      if (kind === 'freight' && o.kind === 'deliver') {
        const cargo = c.contract!.cargo;
        if (!cargo || cargo.commodity !== o.commodity || cargo.qty !== o.qty) report('freight', c.id, 'cargo loaded differs from the cargo delivered');
        if (markets.get(c.giverLocationId)?.entries.get(o.commodity)?.role !== 'produce') report('freight', c.id, `${c.giverLocationId} does not make ${o.commodity}`);
        const e = markets.get(dest.id)?.entries.get(o.commodity);
        if (!e || e.role === 'produce') report('freight', c.id, `${dest.id} does not want ${o.commodity}`);
        const value = e ? o.qty * e.mid * (1 - e.spread / 2) * Math.max(1, priceMultiplier(dest.id, o.commodity, clock)) : 0;
        const deposit = c.contract!.deposit ?? 0;
        if (deposit < value) report('freight', c.id, `deposit ${deposit} is less than the cargo fetches at its destination (${Math.round(value)})`);
        if (o.qty * COMMODITIES[o.commodity].unitSize > CONTRACTS.cargoUnits[1] + 3) report('freight', c.id, 'more cargo than a contract asks for');
      }
      break;
    }
    case 'supply': {
      if (o.kind !== 'deliver') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      // Supplies go to the station that posts the run, or to one of the pilot's outposts in its news (docs/PROCGEN.md §39.3).
      const to = isOutpostId(o.locationId) && c.contract?.event ? o.locationId : c.giverLocationId;
      if (o.locationId !== to) report('supply', c.id, 'supplies go to the station that posts the run');
      if (markets.get(to)?.entries.get(o.commodity)?.role !== 'consume') report('supply', c.id, `${to} does not want ${o.commodity}`);
      const source = c.briefingPrices?.locationId;
      const e = source ? markets.get(source)?.entries.get(o.commodity) : undefined;
      if (!source || e?.role !== 'produce') return report('supply', c.id, 'no source that makes the goods');
      tripFrom = getLocation(source).systemId;
      goodsCost = o.qty * (c.briefingPrices?.prices[o.commodity]?.buy ?? 0);
      break;
    }
    case 'ace': {
      if (o.kind !== 'bounty' || !o.ace) return report('objectives', c.id, 'an ace hunt must name its ace');
      if ((baseThreat(o.systemId) ?? 0) < 2) report('ace', c.id, `aces fly only where packs are nasty, not in ${o.systemId}`);
      if (o.count !== 1 || o.level !== 3 || c.difficulty !== 3) report('ace', c.id, 'an ace is one target at the top difficulty');
      if (!o.ace.name.trim() || !shipModel(o.ace.model)) report('ace', c.id, 'ace without a name or ship');
      if (getLocation(o.locationId).systemId !== o.systemId) report('ace', c.id, 'marked spot is in another system');
      break;
    }
    case 'escort': {
      if (o.kind !== 'escort') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      const dest = getLocation(o.locationId);
      if (o.fromLocationId !== c.giverLocationId || dest.systemId !== o.systemId) report('escort', c.id, 'an escort sets off from the posting station for a station of its own system');
      if (dest.dockable === false || dest.status !== 'functional' || dest.id === c.giverLocationId) report('escort', c.id, `${dest.id} is not another open station`);
      // An escort for a haul of the timetable (docs/PROCGEN.md §21.7): its own ship and name, posted by its
      // sender until it sets off, through a raid on its way that sets the threat.
      if (o.haul || c.contract?.haul) {
        const h = o.haul ? haulById(o.haul) : null;
        if (!h || c.contract?.haul !== h.id || h.from !== c.giverLocationId || h.to !== o.locationId || h.model !== o.model || h.name !== o.shipName || c.contract.until !== h.depart) {
          report('escort', c.id, 'not the haul of the timetable it names');
          break;
        }
        const raids = raidsOnWay(h);
        if (!raids.length) report('escort', c.id, `no raid on the ${h.name}’s way`);
        else if (o.level !== raids[0]!.level || c.difficulty !== Math.min(3, o.level + (j >= 2 ? 1 : 0))) report('escort', c.id, 'threat does not match the worst raid on its way');
        if (o.convoy) report('escort', c.id, 'a haul of the timetable is one ship');
        break;
      }
      if (!escortDanger(o.systemId)) report('escort', c.id, `nothing to fear in ${o.systemId}`);
      const threat = baseThreat(o.systemId);
      if (o.level !== (threat ?? 1) || c.difficulty !== Math.min(3, o.level + (j >= 2 ? 1 : 0))) report('escort', c.id, 'ambush threat does not match the destination');
      const fleets = Object.values(FLEETS).flatMap((f) => f.traders);
      if (!fleets.includes(o.model)) report('escort', c.id, 'escorted ship is not a hauler of the catalogue');
      if (o.convoy) {
        const v = o.convoy;
        if (j === 0) report('escort', c.id, 'convoys run across jumps');
        if (v.names.length !== CONTRACTS.escort.convoy.ships || new Set(v.names).size !== v.names.length || v.need !== CONTRACTS.escort.convoy.need) report('escort', c.id, 'a convoy is three named ships, two of which must arrive');
        if (v.waves !== (o.level >= 3 ? 2 : 1)) report('escort', c.id, 'convoy waves do not match the threat');
      } else if (shipModel(o.model).name !== o.shipName) report('escort', c.id, 'escorted ship is not named for its hull');
      break;
    }
    case 'rescue': {
      if (o.kind !== 'rescue') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      const e = systemEventAt(o.systemId, clock);
      if (!isFrontier(o.systemId) || e?.kind !== 'stranded' || e.ship !== o.shipName) report('rescue', c.id, `no hauler called ${o.shipName} is stranded in ${o.systemId}`);
      const cargo = c.contract!.cargo;
      if (o.commodity !== CONTRACTS.rescue.commodity || !cargo || cargo.commodity !== o.commodity || cargo.qty !== o.qty) report('rescue', c.id, 'cargo loaded differs from the parts handed over');
      if ((c.contract!.deposit ?? 0) < o.qty * COMMODITIES[o.commodity].basePrice) report('rescue', c.id, 'deposit below what the parts are worth');
      if (o.guard !== baseThreat(o.systemId)) report('rescue', c.id, 'scavengers do not match the system');
      if (!Object.values(FLEETS).some((f) => f.traders.includes(o.model))) report('rescue', c.id, 'the stranded ship is not a hauler of the catalogue');
      break;
    }
    case 'smuggle': {
      if (o.kind !== 'deliver') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      const dest = getLocation(o.locationId);
      if (!LAW.contraband.includes(o.commodity)) report('smuggle', c.id, `${o.commodity} is not contraband`);
      if (markets.get(c.giverLocationId)?.entries.get(o.commodity)?.role !== 'produce') report('smuggle', c.id, `${c.giverLocationId} does not sell ${o.commodity}`);
      const e = markets.get(dest.id)?.entries.get(o.commodity);
      if (!e || e.role === 'produce') report('smuggle', c.id, `${dest.id} does not want ${o.commodity}`);
      if (!lawIn(dest.systemId)) report('smuggle', c.id, 'smuggling goes into claimed space');
      if (scansOnDocking(dest.id)) report('smuggle', c.id, `${dest.id} scans every ship that docks`);
      const cargo = c.contract!.cargo;
      if (!cargo || cargo.commodity !== o.commodity || cargo.qty !== o.qty) report('smuggle', c.id, 'cargo loaded differs from the cargo delivered');
      const value = e ? o.qty * e.mid * (1 - e.spread / 2) * Math.max(1, priceMultiplier(dest.id, o.commodity, clock)) : 0;
      if ((c.contract!.deposit ?? 0) < value) report('smuggle', c.id, 'deposit less than the cargo fetches');
      if (!(c.repReward['hollow-wake']! > 0) || Object.keys(c.repReward).some((f) => f !== 'hollow-wake')) report('smuggle', c.id, 'outlaw work earns standing with the Wake only');
      break;
    }
    case 'den': {
      if (o.kind !== 'assault') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      const den = getLocation(o.locationId);
      if (den.stationType !== 'pirate-den' || den.status !== 'functional' || den.systemId !== o.systemId) report('den', c.id, `${o.locationId} is not a raider den in ${o.systemId}`);
      const giver = getLocation(c.giverLocationId);
      if (giver.factionId !== 'sta' && giver.factionId !== 'frontier') report('den', c.id, 'only the law posts den assaults');
      if (c.difficulty !== 3) report('den', c.id, 'a den assault is top difficulty');
      if (!(c.repReward['hollow-wake']! < 0)) report('den', c.id, 'the Wake takes a den assault badly');
      break;
    }
    case 'piracy': {
      if (o.kind !== 'piracy') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      if (getLocation(c.giverLocationId).stationType !== 'pirate-den') report('piracy', c.id, 'only raider dens post piracy');
      if (o.faction !== lawIn(o.systemId)) report('piracy', c.id, 'target faction is not the system’s law');
      if (!trafficFor(o.systemId, 'high').plan.traders) report('piracy', c.id, `no haulers work ${o.systemId}`);
      if (o.count < 2 || o.count > 3) report('piracy', c.id, `count ${o.count}`);
      if (!(c.repReward['hollow-wake']! > 0) || Object.keys(c.repReward).some((f) => f !== 'hollow-wake')) report('piracy', c.id, 'outlaw work earns standing with the Wake only');
      break;
    }
    case 'claim': {
      // No belt without a citation, and a claim only on what the belt yields (docs/PROCGEN.md §19).
      const back = c.objectives[1];
      if (o.kind !== 'mine' || back?.kind !== 'deliver' || back.locationId !== c.giverLocationId) return report('objectives', c.id, 'a claim mines a load and brings it to the station that posts it');
      const belt = findBelt(o.beltId);
      if (!belt || belt.systemId !== o.systemId) return report('claim', c.id, `${o.beltId} is not a belt of ${o.systemId}`);
      if (!belt.sources.length) report('claim', c.id, `${belt.id} cites no source`);
      if (!(beltGoods(belt.kind) as string[]).includes(o.commodity)) report('claim', c.id, `${belt.id} yields no ${o.commodity}`);
      if (back.commodity !== o.commodity || back.qty !== o.qty) report('claim', c.id, 'the load delivered differs from the load mined');
      if (!postsClaims(getLocation(c.giverLocationId))) report('claim', c.id, `${c.giverLocationId} does not post claims`);
      const units = o.qty * COMMODITIES[o.commodity].unitSize;
      if (o.qty < 1 || units > CONTRACTS.claim.holdUnits[1]) report('claim', c.id, `${units} hold units`);
      // The claim pays more than the load could fetch in any market.
      if (c.reward <= o.qty * COMMODITIES[o.commodity].basePrice * PRICE_BAND[1]) report('claim', c.id, 'pays less than the load could fetch');
      break;
    }
    case 'recovery': {
      const back = c.objectives[1];
      if (o.kind !== 'recover' || back?.kind !== 'visit' || back.locationId !== c.giverLocationId) return report('objectives', c.id, 'a recovery finds the item and brings it back');
      if (getLocation(o.locationId).systemId !== o.systemId) report('recovery', c.id, 'wreck marked in another system');
      if (o.guard !== baseThreat(o.systemId)) report('recovery', c.id, 'guards do not match the system');
      if (!RECOVERY_ITEMS.some((x) => x.item === o.item)) report('recovery', c.id, `unknown item ${o.item}`);
      break;
    }
    case 'bounty': {
      if (o.kind !== 'bounty') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      // Raid work hunts the raid's packs; other bounties the system's usual ones.
      const packs = c.contract?.event ? trafficFor(o.systemId, 'high', clock).plan.packs : trafficFor(o.systemId, 'high').plan.packs;
      if (!packs) report('bounty', c.id, `no raiders roam ${o.systemId}`);
      else if (o.level !== packs.level || o.count !== packs.level + 1) report('bounty', c.id, 'pack size or threat does not match the system');
      if (getLocation(o.locationId).systemId !== o.systemId) report('bounty', c.id, 'marked spot is in another system');
      break;
    }
    case 'survey': {
      if (o.kind !== 'scan') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      if (!getSystem(o.systemId).confirmedBodies.some((p) => p.id === o.bodyId)) report('survey', c.id, `${o.bodyId} is not a confirmed planet of ${o.systemId}`);
      break;
    }
    // Passengers and sightseers (docs/PROCGEN.md §23): a party of the rules' size; a passage to an
    // open station, a tour out to a real sight of that system and back to the station that posted it.
    case 'passage':
    case 'tour': {
      const party = c.contract!.party ?? [];
      const [lo, hi] = PASSENGERS[kind].party;
      if (party.length < lo || party.length > hi || new Set(party).size !== party.length) report('party', c.id, `a party of ${party.length}`);
      if (kind === 'passage') {
        if (o.kind !== 'visit') return report('objectives', c.id, `unexpected objective ${o.kind}`);
        const dest = getLocation(o.locationId);
        if (dest.id === c.giverLocationId || dest.dockable === false || dest.status !== 'functional' || !dest.services.length) report('destination', c.id, `${dest.id} is not another open station`);
      } else {
        const back = c.objectives[1];
        if (o.kind !== 'sight' || back?.kind !== 'visit' || back.locationId !== c.giverLocationId) return report('objectives', c.id, 'a tour sees a sight, then comes back');
        const sight = sightById(o.sightId);
        if (!sight || sight.systemId !== o.systemId || sight.targetId !== o.targetId) report('tour', c.id, `${o.sightId} is not a sight of ${o.systemId}`);
        // A trip out: never to a sight in view from where the pilot jumps in or undocks.
        else if (inViewFromGates(sight) || inViewFromStation(sight, c.giverLocationId)) report('tour', c.id, `${o.sightId} is in view from a jump beacon or ${c.giverLocationId}`);
      }
      break;
    }
    // Observing a dying far star (docs/PROCGEN.md §25): from a research station, a star of the far
    // stars, a window that opens and closes, and back to the station with the readings.
    case 'observe': {
      const back = c.objectives[1];
      if (o.kind !== 'observe' || back?.kind !== 'visit' || back.locationId !== c.giverLocationId) return report('objectives', c.id, 'an observation, then back with the readings');
      if (getLocation(c.giverLocationId).stationType !== 'research-station') report('observe', c.id, 'posted by a station that is not a research station');
      if (!(farStar(o.star) || o.star === PYRE_ID || o.star === PYRE_HOLE_ID || flareStar(o.star) || orbitOf(o.star)?.secondary === o.star || cometOf(o.star) || asteroidOf(o.star)) || !(o.to > o.from))
        report('observe', c.id, `${o.star}: not a far star, Pyre, a flare star, a pair's secondary, a comet or an asteroid, or a window that never opens`);
      // A star read where it is is read in its own system; a comet or an asteroid in Sol.
      if (o.systemId !== undefined && o.systemId !== (cometOf(o.star) || asteroidOf(o.star) ? 'sol' : getComponent(o.star)?.systemId)) report('observe', c.id, `${o.star} is not read in its own system`);
      if (c.contract?.asteroid !== undefined) {
        // A near-Earth asteroid's tracking (docs/PROCGEN.md §47.5): a catalogued one, in Sol, within a day, for a research station within reach.
        if (!asteroidOf(o.star)?.neo || c.contract.asteroid !== o.star || o.systemId !== 'sol') report('observe', c.id, `${o.star}: tracking not of a catalogued near-Earth asteroid, read in Sol`);
        else if (o.to - o.from !== ASTEROIDS.track.window || o.from !== Math.floor(clock / CONTRACTS.epochSeconds) * CONTRACTS.epochSeconds) report('observe', c.id, 'tracking whose window is not the day from its posting');
        if (trackingJumps(c.giverLocationId) === null) report('observe', c.id, 'tracking posted by a station not within reach of Sol');
        // Near a pass of Earth, the one passing.
        const jd = boardDate(o.from);
        const passing = jd === null ? null : passingAsteroid(jd);
        if (passing && passing.asteroid.id !== o.star) report('observe', c.id, `${o.star} tracked while ${passing.asteroid.name} passes Earth`);
      } else if (c.contract?.comet !== undefined) {
        // A comet's imaging (docs/PROCGEN.md §45.5): a catalogued comet, in Sol, within a day, for a research station within reach.
        if (!cometOf(o.star) || c.contract.comet !== o.star || o.systemId !== 'sol') report('observe', c.id, `${o.star}: imaging not of a catalogued comet, read in Sol`);
        else if (o.to - o.from !== COMETS.image.window || o.from !== Math.floor(clock / CONTRACTS.epochSeconds) * CONTRACTS.epochSeconds) report('observe', c.id, 'imaging whose window is not the day from its posting');
        if (imagingJumps(c.giverLocationId) === null) report('observe', c.id, 'imaging posted by a station not within reach of Sol');
      } else if (c.contract?.pair !== undefined) {
        // A pair's measurement (docs/PROCGEN.md §44.5): its secondary, in its system, within a day.
        if (orbitOf(o.star)?.secondary !== o.star || c.contract.pair !== o.star || o.systemId === undefined) report('observe', c.id, `${o.star}: a measurement not of a catalogued pair's secondary, read in its system`);
        else if (o.to - o.from !== BINARIES.measure.window || o.from !== Math.floor(clock / CONTRACTS.epochSeconds) * CONTRACTS.epochSeconds) report('observe', c.id, 'a measurement whose window is not the day from its posting');
      } else if (flareStar(o.star) || o.systemId !== undefined || c.contract?.flare !== undefined) {
        // Flare watch (docs/PROCGEN.md §43.5): a flare star read in its own system, for a flare of its, while it flares.
        const f = c.contract?.flare ? flaresBetween(o.from, o.from).find((x) => x.id === c.contract!.flare) : undefined;
        if (!flareStar(o.star) || o.systemId === undefined) report('observe', c.id, `${o.star} is not a flare star read in its own system`);
        else if (!f || f.star !== o.star || f.start !== o.from || f.end !== o.to) report('observe', c.id, 'a window that is not its flare');
        else if (c.contract?.posted !== f.start || c.contract.until !== f.end || c.contract.posted > clock + CONTRACTS.epochSeconds || c.contract.until <= clock) report('observe', c.id, 'not on the board while its flare lasts');
      }
      if (o.firstLight !== undefined && (o.star !== PYRE_ID || !(o.firstLight > 0) || !((o.aheadLy ?? 0) > 0))) report('observe', c.id, 'first light wanted of a star that is not Pyre, or with no time or distance');
      if (o.baselineLy !== undefined && !(o.baselineLy > 0)) report('observe', c.id, 'a baseline that is not positive');
      break;
    }
  }
  // Work answering an event answers one that is under way where it says.
  const eventId = c.contract?.event;
  if (eventId) {
    // A supply run answers the event where it goes (one of the pilot's outposts, §39.3, or its own station).
    const station = stationEventAt(kind === 'supply' ? (c.destinationLocationId ?? c.giverLocationId) : c.giverLocationId, clock);
    const raid = o.kind === 'bounty' ? systemEventAt(o.systemId, clock) : null;
    const good = o.kind === 'deliver' ? o.commodity : null;
    const answers =
      (kind === 'supply' && station?.id === eventId && (station.kind === 'shortage' || station.kind === 'boom') && !!good && station.goods.includes(good)) ||
      (kind === 'freight' && station?.id === eventId && (station.kind === 'glut' || station.kind === 'harvest') && !!good && station.goods.includes(good)) ||
      (kind === 'survey' && station?.id === eventId && station.kind === 'survey' && o.kind === 'scan' && o.bodyId === station.bodyId) ||
      (kind === 'bounty' && raid?.id === eventId && raid.kind === 'raid') ||
      (kind === 'rescue' && o.kind === 'rescue' && systemEventAt(o.systemId, clock)?.id === eventId) ||
      (kind === 'escort' && o.kind === 'escort' && !!o.haul && escortsFor(o.haul, eventId, clock));
    if (!answers) report('events', c.id, `does not answer the event ${eventId} under way`);
  }
  // Urgent terms: only parcels and hauls, with a time limit that can be kept and a real bonus.
  const urgent = c.contract?.urgent;
  if (urgent) {
    if (kind !== 'parcel' && kind !== 'freight') report('urgent', c.id, `${kind} cannot be urgent`);
    const trip = expectedTrip(from, target);
    if (urgent.seconds < 2 * trip) report('urgent', c.id, `${urgent.seconds} s for a trip of about ${trip} s`);
    if (urgent.bonus <= 0 || urgent.bonus > c.reward) report('urgent', c.id, `bonus ${urgent.bonus}`);
  }
  // Pay beats the trip there and back and the expected repairs (supply runs on top of the goods).
  const trip = 2 * Math.max(routeFeeBetween(from, target), routeFeeBetween(from, tripFrom));
  const need = PAY_MARGIN * trip + REPAIRS_PER_LEVEL * c.difficulty + goodsCost;
  if (c.reward < need) report('pay', c.id, `pays ${c.reward}, the trip costs about ${Math.round(need)}`);
}
