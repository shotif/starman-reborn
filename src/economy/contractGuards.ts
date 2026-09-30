import { CONTRACTS, type ContractKind } from '../content/contracts/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, getSystem, WORLD } from '../data/systems.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { shipModel } from '../content/catalog.ts';
import { RECOVERY_ITEMS } from '../content/contracts/rules.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { occupied } from './border.ts';
import { boardFor, CONTRACT_PREFIX, expectedTrip, followUpFor, routeFeeBetween } from './contracts.ts';
import { LAW } from '../content/law/rules.ts';
import { baseThreat, priceMultiplier, stationEventAt, systemEventAt } from './events.ts';
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
        if (c.contract?.event) answering++;
        if (c.contract?.urgent) urgent++;
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
  for (const k of Object.keys(CONTRACTS.maxJumps) as ContractKind[]) if (!kinds.has(k)) report('coverage', k, 'no board ever posts this kind');
  if (!eventWork) report('coverage', 'events', 'no board ever posts work answering a world event');
  if (!urgent) report('coverage', 'urgent', 'no board ever posts an urgent job');
  if (!chains) report('coverage', 'chains', 'no delivery ever leads to a follow-up');
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
  const expected = kind === 'recovery' ? 2 : 1;
  if (!o || c.objectives.length !== expected) return report('objectives', c.id, `expected ${expected} objective(s)`);

  // Where it sends you, and what the trip costs.
  const target = o.kind === 'scan' || o.kind === 'bounty' || o.kind === 'recover' || o.kind === 'escort' || o.kind === 'piracy' ? o.systemId : 'locationId' in o ? getLocation(o.locationId).systemId : from;
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
      if (o.locationId !== c.giverLocationId) report('supply', c.id, 'supplies go to the station that posts the run');
      if (markets.get(c.giverLocationId)?.entries.get(o.commodity)?.role !== 'consume') report('supply', c.id, `${c.giverLocationId} does not want ${o.commodity}`);
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
      if (o.fromLocationId !== c.giverLocationId || o.systemId !== from || dest.systemId !== from) report('escort', c.id, 'escorts run between two stations of the posting station’s system');
      if (dest.dockable === false || dest.status !== 'functional' || dest.id === c.giverLocationId) report('escort', c.id, `${dest.id} is not another open station`);
      const threat = baseThreat(from);
      if (threat === null && (WORLD.profiles.get(from)?.security ?? 1) >= 0.75) report('escort', c.id, 'nothing to fear in secure space');
      if (o.level !== (threat ?? 1) || c.difficulty !== o.level) report('escort', c.id, 'ambush threat does not match the system');
      const fleets = Object.values(FLEETS).flatMap((f) => f.traders);
      if (!fleets.includes(o.model) || shipModel(o.model).name !== o.shipName) report('escort', c.id, 'escorted ship is not a hauler of the catalogue');
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
  }
  // Work answering an event answers one that is under way where it says.
  const eventId = c.contract?.event;
  if (eventId) {
    const station = stationEventAt(c.giverLocationId, clock);
    const raid = o.kind === 'bounty' ? systemEventAt(o.systemId, clock) : null;
    const good = o.kind === 'deliver' ? o.commodity : null;
    const answers =
      (kind === 'supply' && station?.id === eventId && (station.kind === 'shortage' || station.kind === 'boom') && !!good && station.goods.includes(good)) ||
      (kind === 'freight' && station?.id === eventId && station.kind === 'glut' && !!good && station.goods.includes(good)) ||
      (kind === 'bounty' && raid?.id === eventId && raid.kind === 'raid');
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
