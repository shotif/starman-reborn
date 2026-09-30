import { CONTRACTS, type ContractKind } from '../content/contracts/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, getSystem, WORLD } from '../data/systems.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { boardFor, CONTRACT_PREFIX, routeFeeBetween } from './contracts.ts';
import type { JobDef } from './jobs.ts';
import { marketTables } from './markets.ts';

/**
 * Contract guardrails (docs/PROCGEN.md §10.3): every board over many time slots posts sound
 * contracts: real destinations in reach, pay that beats the jump fees and repairs, deposits that
 * make stealing freight a loss, bounties only where raiders roam, surveys of confirmed planets.
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
  const givers = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.dockable !== false && l.services.includes('contracts'));
  const kinds = new Set<ContractKind>();
  for (const giver of givers) {
    let empty = 0;
    const jumps = jumpsFrom(WORLD.links, giver.systemId);
    for (let epoch = 0; epoch < epochs; epoch++) {
      const board = boardFor(giver.id, epoch);
      if (!board.length) empty++;
      const ids = new Set<string>();
      for (const c of board) {
        const subject = c.id;
        if (ids.has(c.id)) report('ids', subject, 'duplicate id on a board');
        ids.add(c.id);
        if (!c.id.startsWith(`${CONTRACT_PREFIX}${giver.id}.${epoch}.`)) report('ids', subject, 'id does not name its station and time slot');
        checkContract(c, giver.systemId, jumps, markets, report);
        if (c.contract) kinds.add(c.contract.kind);
      }
    }
    if (empty > epochs * 0.1) report('boards', giver.id, `empty board in ${empty} of ${epochs} time slots`);
  }
  for (const k of Object.keys(CONTRACTS.maxJumps) as ContractKind[]) if (!kinds.has(k)) report('coverage', k, 'no board ever posts this kind');
  return issues;
}

function checkContract(c: JobDef, from: string, jumps: ReadonlyMap<string, number>, markets: ReturnType<typeof marketTables>, report: Report): void {
  const kind = c.contract?.kind;
  if (!kind) return report('kind', c.id, 'generated contract without a kind');
  const text = `${c.title} ${c.briefing} ${c.difficultyNote} ${c.objectives.map((o) => o.text).join(' ')}`;
  if (!c.title.trim() || !c.briefing.trim() || /undefined|NaN|\{|\}/.test(text)) report('text', c.id, 'text missing or unfilled');
  if (!Number.isFinite(c.reward) || c.reward <= 0 || c.reward > MAX_REWARD) report('pay', c.id, `reward ${c.reward} out of range`);
  if (![1, 2, 3].includes(c.difficulty)) report('difficulty', c.id, `difficulty ${c.difficulty}`);
  const gated = !!c.requires?.minRep;
  if (gated !== (c.difficulty >= CONTRACTS.gatedDifficulty && c.factionId !== null)) report('standing', c.id, 'standing gate does not match the difficulty');
  const o = c.objectives[0];
  if (!o || c.objectives.length !== 1) return report('objectives', c.id, 'expected one objective');

  // Where it sends you, and what the trip costs.
  const target = o.kind === 'scan' || o.kind === 'bounty' ? o.systemId : 'locationId' in o ? getLocation(o.locationId).systemId : from;
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
        const value = e ? o.qty * e.mid * (1 - e.spread / 2) : 0;
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
    case 'bounty': {
      if (o.kind !== 'bounty') return report('objectives', c.id, `unexpected objective ${o.kind}`);
      const packs = trafficFor(o.systemId, 'high').plan.packs;
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
  // Pay beats the trip there and back and the expected repairs (supply runs on top of the goods).
  const trip = 2 * Math.max(routeFeeBetween(from, target), routeFeeBetween(from, tripFrom));
  const need = PAY_MARGIN * trip + REPAIRS_PER_LEVEL * c.difficulty + goodsCost;
  if (c.reward < need) report('pay', c.id, `pays ${c.reward}, the trip costs about ${Math.round(need)}`);
}
