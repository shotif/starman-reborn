import { findGear, findShip } from '../../content/catalog.ts';
import { STARTER_SHIP_ID } from '../../content/rules/index.ts';
import { ALL_LOCATIONS } from '../../data/systems.ts';
import { KNOWN_SYSTEM_IDS, PYRE_LOCATIONS, SYSTEM_IDS } from '../../data/systems.ts';
import { codexEntries } from '../../economy/progress.ts';
import { skyTimeline } from '../../economy/stellar.ts';
import type { SystemId } from '../../data/types.ts';
import { clampShip, newShipState } from '../../economy/loadout.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../content/economy/goods.ts';
import { COMBAT } from '../../content/combat/rules.ts';
import { markById } from '../../economy/marks.ts';
import { FLEET } from '../../content/fleet/rules.ts';
import { OUTPOSTS } from '../../content/outposts/rules.ts';
import { ROSTER } from '../../content/rivals/rules.ts';
import { outpostId, outpostSite } from '../../content/outposts/sites.ts';
import { createNewGame, SAVE_VERSION, type CommodityId, type GameState, type OutpostRecord } from '../state.ts';

/**
 * Save format history:
 * - v1 (flight-and-dock milestone): flat record { version: 1, system, dockedAt, money, hull, shield,
 *   cargo, visited, seed, savedAt }. No jobs, reputation or market memory.
 * - v2 (economy milestone): GameState with a fixed courier: ship { hull, shield, shieldGenerator
 *   ('shield-mk1' | 'shield-mk2'), gun ('pulse-mk1' | 'pulse-mk2'), missiles, repairKits, cargo }.
 * - v3: ships and equipment from the catalogue (src/content): ship { model, fittings, hull,
 *   shield, ammo, repairKits, cargo }.
 * - v4: 21 goods instead of 3, and `markets` (stock the player's trades have moved at each
 *   station).
 * - v5: `contracts` (generated contracts the player accepted, as posted) and bounty progress in
 *   `jobs`.
 * - v6: contracts may be escorts, ace hunts or recoveries, urgent or follow-ups (offered follow-ups
 *   wait in `contracts` without a `jobs` entry); jobs may have failed, and carry escort and
 *   recovery progress. The data of a v5 save is valid v6.
 * - v7: `law` (fines owed to the lawful factions), smuggling and piracy contracts, two contraband
 *   goods; `codex`, `surveysSold`, `milestones`, and `stats.sales` / `stats.rewards` (the trade
 *   rating).
 * - v8: `story` (choices made in the faction arcs, beats already told) and `dens` (raider
 *   dens knocked out, and when); jobs may carry convoy and den assault progress; `stash` (salvaged
 *   equipment aboard) and `crew` (wingmen for hire); the ship's `decoys` and `systems` damage.
 * - v9: `priceWatch` and `rumours` (docs/PROCGEN.md §16); known markets may come from a rumour
 *   or the price watch, with per-good times.
 * - v10 (current): `world` (events ended early, what lingers in each system) and the law's
 *   `pending` crimes and `lastCrimeAt` (docs/PROCGEN.md §17); `fleet` (owned ships, haulers,
 *   storage and stakes, §18); contracts may be mining claims, whose jobs carry `mined` (§19);
 *   escorts across jumps carry `escortAt`, where their ships are (§10.2; absent in older v10
 *   saves, which means where they set off); a passenger contract carries its `party`, and its
 *   progress `seen` and `fright` (§23); a hauler may carry `sight`, a run the player saw safely
 *   past its raid (§18.6); `rivals` (standing with rival pilots) and the world log's `rivals`
 *   (rivals knocked out, claims bought back, §24); the world log's `sky` (when a far star's death
 *   begins, §25) and a job's `observed` (its observations), absent in older v10 saves. See
 *   GameState in src/app/state.ts.
 */
export interface SaveV1 {
  version: 1;
  savedAt: string;
  seed: number;
  system: SystemId;
  dockedAt: string | null;
  money: number;
  hull: number;
  shield: number;
  cargo: Record<string, number>;
  visited: SystemId[];
}

export class SaveFormatError extends Error {}

/** The shared world's stations, and Pyre's two (docs/PROCGEN.md §26). */
const SHARED_IDS: ReadonlySet<string> = new Set([...ALL_LOCATIONS.filter((l) => l.status === 'functional').map((l) => l.id), ...PYRE_LOCATIONS.map((l) => l.id)]);
/** Stations a save may name: the shared world's, and its own outpost once it is valid (set as a save is checked). */
let LOCATION_IDS: ReadonlySet<string> = SHARED_IDS;

/** The player's outpost (docs/PROCGEN.md §22): a real site, a kind it allows, its stage and deliveries in range. */
function assertValidOutpost(o: OutpostRecord, fail: (msg: string) => never): void {
  const site = isRecord(o) && typeof o.site === 'string' ? outpostSite(o.site) : undefined;
  if (
    !site ||
    !site.kinds.includes(o.kind) ||
    typeof o.name !== 'string' ||
    !o.name.trim() ||
    o.name.length > 40 ||
    !Number.isInteger(o.stage) ||
    o.stage < 0 ||
    o.stage > OUTPOSTS.stages.length ||
    !isRecord(o.delivered) ||
    !Object.entries(o.delivered).every(([c, q]) => COMMODITY_IDS.includes(c as CommodityId) && Number.isFinite(q) && (q as number) >= 0) ||
    !Number.isFinite(o.founded) ||
    !Number.isFinite(o.since) ||
    !Number.isFinite(o.earned)
  ) {
    fail('outpost');
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function migrateV1(old: SaveV1): GameState {
  const state = createNewGame(Number.isFinite(old.seed) ? old.seed : 1, new Date(old.savedAt || Date.now()));
  state.savedAt = old.savedAt;
  state.location.systemId = old.system;
  state.location.dockedAt = old.dockedAt;
  state.location.lastDockId = old.dockedAt ?? (old.system === 'sol' ? 'earth-port' : state.location.lastDockId);
  state.credits = old.money;
  state.ship.hull = old.hull;
  state.ship.shield = old.shield;
  state.ship.cargo = {};
  for (const id of COMMODITY_IDS) {
    const qty = old.cargo?.[id];
    if (typeof qty === 'number' && qty > 0) state.ship.cargo[id] = Math.floor(qty);
  }
  state.visitedSystems = [...new Set<SystemId>(['sol', ...(old.visited ?? [])])];
  // v1 predates jump clearance; a v1 pilot who had already left Sol keeps the ability to jump.
  if (state.visitedSystems.length > 1) state.flags.clearance = true;
  return state;
}

/** The v2 ship record. */
export interface ShipV2 {
  hull: number;
  shield: number;
  shieldGenerator: 'shield-mk1' | 'shield-mk2';
  gun: 'pulse-mk1' | 'pulse-mk2';
  missiles: number;
  repairKits: number;
  cargo: GameState['ship']['cargo'];
}

/**
 * v2 → v3: the fixed courier becomes the Halden courier Mk I from the catalogue. Upgrades map to
 * the catalogue items closest in strength: the Mk II pulse cannon to two class 2 Kestrels, the
 * Mk II shield to a class 3 Aegis. Missiles become seekers in the launcher.
 */
function migrateV2(old: Omit<GameState, 'version' | 'ship'> & { version: 2; ship: ShipV2 }): GameState {
  const v2 = old.ship;
  const ship = newShipState(STARTER_SHIP_ID);
  if (v2.gun === 'pulse-mk2') {
    for (const slot of Object.keys(ship.fittings)) if (slot.startsWith('gun-')) ship.fittings[slot] = 'gear.pulse.2.halden';
  }
  if (v2.shieldGenerator === 'shield-mk2') ship.fittings.shield = 'gear.shield-balanced.3.halden';
  ship.hull = Number.isFinite(v2.hull) ? v2.hull : ship.hull;
  ship.shield = Number.isFinite(v2.shield) ? v2.shield : 0;
  ship.ammo = { 'launcher-1': Number.isFinite(v2.missiles) ? Math.floor(v2.missiles) : 0 };
  ship.repairKits = Number.isFinite(v2.repairKits) ? Math.max(0, Math.floor(v2.repairKits)) : 0;
  ship.cargo = v2.cargo ?? {};
  clampShip(ship);
  return migrateV3({ ...old, version: 3, ship });
}

/** v3 → v4: markets start untouched (the three v3 goods keep their ids). */
function migrateV3(old: Omit<GameState, 'version' | 'markets' | 'contracts'> & { version: 3 }): GameState {
  return migrateV4({ ...old, version: 4, markets: {} });
}

/** v4 → v5: no generated contracts accepted yet. */
function migrateV4(old: Omit<GameState, 'version' | 'contracts'> & { version: 4 }): GameState {
  return migrateV5({ ...old, version: 5, contracts: {} });
}

/** v5 → v6: nothing to change (v6 only adds kinds of contract and progress). */
function migrateV5(old: Parameters<typeof migrateV6>[0] extends infer T ? Omit<T, 'version'> & { version: 5 } : never): GameState {
  return migrateV6({ ...old, version: 6 });
}

/**
 * v6 → v7: a clean record with the law; the codex starts from the planets already scanned; no
 * milestones yet (they are awarded on the next check), no survey sold, the trade record at zero.
 */
function migrateV6(
  old: Omit<GameState, 'version' | 'law' | 'codex' | 'surveysSold' | 'milestones' | 'stats' | 'story' | 'dens'> & { version: 6; stats: Omit<GameState['stats'], 'sales' | 'rewards'> },
): GameState {
  const known = new Set(codexEntries().map((e) => e.id));
  return migrateV7({
    ...old,
    version: 7,
    law: { fines: {}, pending: [], lastCrimeAt: {} },
    codex: old.discoveredBodies.filter((id) => known.has(id)),
    surveysSold: [],
    milestones: {},
    stats: { ...old.stats, sales: 0, rewards: 0 },
  });
}

/**
 * v7 → v8: no story choices made and no den knocked out yet; nothing in the stash and nobody on the
 * wing; the ship gets its starting decoys and intact systems.
 */
function migrateV7(
  old: Omit<GameState, 'version' | 'story' | 'dens' | 'stash' | 'crew' | 'ship'> & { version: 7; ship: Omit<GameState['ship'], 'decoys' | 'systems'> & Partial<Pick<GameState['ship'], 'decoys' | 'systems'>> },
): GameState {
  const ship = { ...old.ship, decoys: old.ship.decoys ?? COMBAT.decoys.starting, systems: old.ship.systems ?? { engines: 0, guns: 0, shields: 0 } };
  return migrateV8({ ...old, ship, version: 8, story: { choices: {}, seen: [] }, dens: {}, stash: [], crew: [] });
}

/** v8 → v9: no prices watched and nothing heard in the bars yet. */
function migrateV8(old: Omit<GameState, 'version' | 'priceWatch' | 'rumours' | 'world' | 'law'> & { version: 8; law: { fines: GameState['law']['fines'] } }): GameState {
  return migrateV9({ ...old, version: 9, priceWatch: [], rumours: [] });
}

/**
 * v9 → v10: fines on record stay on record (every crime so far is known everywhere, and counts as
 * committed now for lapsing); no event ended early and nothing left adrift yet.
 */
function migrateV9(old: Omit<GameState, 'version' | 'world' | 'law' | 'fleet'> & { version: 9; law: { fines: GameState['law']['fines'] } }): GameState {
  const lastCrimeAt: GameState['law']['lastCrimeAt'] = {};
  for (const [f, fine] of Object.entries(old.law.fines)) if ((fine ?? 0) > 0) lastCrimeAt[f as keyof typeof lastCrimeAt] = old.clock;
  return {
    ...old,
    version: SAVE_VERSION,
    law: { fines: { ...old.law.fines }, pending: [], lastCrimeAt },
    world: { relief: {}, raidKills: {}, ended: {}, lingering: {}, border: {} },
    fleet: { ships: [], storage: {}, stakes: [], reports: [] },
  };
}

/** Upgrades any known save version to the current GameState. Throws SaveFormatError when unusable. */
export function migrateSave(raw: unknown): GameState {
  if (!isRecord(raw) || typeof raw.version !== 'number') throw new SaveFormatError('Save data is not recognisable.');
  let data: unknown = raw;
  if (raw.version > SAVE_VERSION) {
    throw new SaveFormatError(`Save was made by a newer version (format ${raw.version}).`);
  }
  if (raw.version === 1) data = migrateV1(raw as unknown as SaveV1);
  else if (raw.version === 2) {
    if (!isRecord(raw.ship)) throw new SaveFormatError('Save data is damaged: ship');
    data = migrateV2(raw as unknown as Parameters<typeof migrateV2>[0]);
  } else if (raw.version === 3) data = migrateV3(raw as unknown as Parameters<typeof migrateV3>[0]);
  else if (raw.version === 4) data = migrateV4(raw as unknown as Parameters<typeof migrateV4>[0]);
  else if (raw.version === 5) data = migrateV5(raw as unknown as Parameters<typeof migrateV5>[0]);
  else if (raw.version === 6) data = migrateV6(raw as unknown as Parameters<typeof migrateV6>[0]);
  else if (raw.version === 7) data = migrateV7(raw as unknown as Parameters<typeof migrateV7>[0]);
  else if (raw.version === 8) data = migrateV8(raw as unknown as Parameters<typeof migrateV8>[0]);
  else if (raw.version === 9) data = migrateV9(raw as unknown as Parameters<typeof migrateV9>[0]);
  const state = data as GameState;
  assertValidState(state);
  return state;
}

/** A cargo record: known goods in whole, non-negative quantities. */
function validCargo(cargo: unknown): cargo is Record<string, number> {
  return isRecord(cargo) && Object.entries(cargo).every(([c, q]) => COMMODITY_IDS.includes(c as CommodityId) && Number.isInteger(q) && (q as number) >= 0);
}

/** Checks one ship (the one flown, or one the player owns): the model, its fittings, racks, systems and hold. */
function assertValidShip(ship: GameState['ship'], fail: (msg: string) => never, what = 'ship'): void {
  if (!isRecord(ship) || !Number.isFinite(ship.hull) || !Number.isFinite(ship.shield)) fail(what);
  if (!isRecord(ship.cargo)) fail(`${what} cargo`);
  const model = typeof ship.model === 'string' ? findShip(ship.model) : undefined;
  if (!model) fail(`unknown ${what} model`);
  if (!isRecord(ship.fittings) || !isRecord(ship.ammo)) fail(`${what} fittings`);
  for (const [slotId, gearId] of Object.entries(ship.fittings)) {
    const slot = model!.slots.find((sl) => sl.id === slotId);
    const item = typeof gearId === 'string' ? findGear(gearId) : undefined;
    if (!slot || !item || item.slot !== slot.type || item.tier > slot.maxClass) fail(`${what} fitting ${slotId}`);
  }
  for (const [slotId, rounds] of Object.entries(ship.ammo)) {
    if (!model!.slots.some((sl) => sl.id === slotId && sl.type === 'launcher') || !Number.isInteger(rounds) || (rounds as number) < 0) fail(`${what} ammo ${slotId}`);
  }
  if (!Number.isInteger(ship.repairKits) || ship.repairKits < 0) fail(`${what} repair kits`);
  if (!validCargo(ship.cargo)) fail(`${what} cargo entry`);
  if (!Number.isInteger(ship.decoys) || ship.decoys < 0 || ship.decoys > COMBAT.decoys.max) fail(`${what} decoys`);
  const sys = ship.systems;
  if (!isRecord(sys) || !(['engines', 'guns', 'shields'] as const).every((k) => Number.isFinite(sys[k]) && sys[k] >= 0 && sys[k] <= 1)) fail(`${what} systems`);
}

/** The fleet (docs/PROCGEN.md §18): owned ships and their captains, storage, stakes and reports. */
function assertValidFleet(fl: GameState['fleet'], fail: (msg: string) => never): void {
  if (!isRecord(fl) || !Array.isArray(fl.ships) || !isRecord(fl.storage) || !Array.isArray(fl.stakes) || !Array.isArray(fl.reports)) fail('fleet');
  if (fl.ships.length > FLEET.hangar.max) fail('fleet: too many ships');
  const ids = new Set<string>();
  for (const o of fl.ships) {
    if (!isRecord(o) || typeof o.id !== 'string' || ids.has(o.id) || !LOCATION_IDS.has(o.locationId)) fail('fleet ship');
    ids.add(o.id);
    assertValidShip(o.ship, fail, `fleet ship ${o.id}`);
    const h = o.hauler;
    if (h === undefined) continue;
    const time = (t: unknown) => Number.isFinite(t);
    if (
      !isRecord(h) ||
      typeof h.captain !== 'string' ||
      !isRecord(h.route) ||
      h.route.from !== o.locationId ||
      !LOCATION_IDS.has(h.route.to) ||
      h.route.to === h.route.from ||
      !COMMODITY_IDS.includes(h.route.commodity) ||
      typeof h.insured !== 'boolean' ||
      typeof h.recalled !== 'boolean' ||
      !['home', 'out', 'back'].includes(h.leg) ||
      ![null, 'unprofitable', 'credits'].includes(h.waiting) ||
      !Number.isInteger(h.waits) ||
      h.waits < 0 ||
      !time(h.hired) ||
      !time(h.since) ||
      !Number.isFinite(h.cost) ||
      h.cost < 0 ||
      !Number.isInteger(h.runs) ||
      h.runs < 0 ||
      !Number.isFinite(h.earned) ||
      (h.sight !== undefined && (!isRecord(h.sight) || !Number.isInteger(h.sight.run) || h.sight.run < 0 || !SYSTEM_IDS.includes(h.sight.systemId) || !time(h.sight.at)))
    ) {
      fail('hauler');
    }
  }
  for (const [id, cargo] of Object.entries(fl.storage)) {
    if (!LOCATION_IDS.has(id) || !validCargo(cargo)) fail('storage');
    let used = 0;
    for (const [c, q] of Object.entries(cargo)) used += (q ?? 0) * COMMODITIES[c as CommodityId].unitSize;
    if (used > FLEET.storage.capacity) fail('storage');
  }
  const stakes = new Set<string>();
  for (const k of fl.stakes) {
    if (
      !isRecord(k) ||
      !LOCATION_IDS.has(k.locationId) ||
      stakes.has(k.locationId) ||
      !Number.isInteger(k.percent) ||
      k.percent < 1 ||
      k.percent > FLEET.stakes.maxPercent ||
      !Number.isFinite(k.paid) ||
      k.paid < 0 ||
      !Number.isFinite(k.since) ||
      !Number.isFinite(k.earned)
    ) {
      fail('stakes');
    }
    stakes.add(k.locationId);
  }
  if (stakes.size > FLEET.stakes.maxStations) fail('stakes');
  const kinds = ['run', 'raid', 'lost', 'wait', 'home'];
  if (!fl.reports.every((r) => isRecord(r) && Number.isFinite(r.at) && kinds.includes(r.kind) && typeof r.text === 'string' && Number.isFinite(r.amount) && (r.shipId === undefined || typeof r.shipId === 'string'))) fail('fleet reports');
}

/** Structural and range checks; throws SaveFormatError on anything that would break the game. */
export function assertValidState(s: GameState): void {
  const fail = (msg: string): never => {
    throw new SaveFormatError(`Save data is damaged: ${msg}`);
  };
  if (!isRecord(s) || s.version !== SAVE_VERSION) fail('wrong version');
  // The save's own outpost first: once valid, its id is a station the rest of the save may name.
  const own = isRecord(s.world) ? s.world.outpost : undefined;
  LOCATION_IDS = SHARED_IDS;
  if (own !== undefined) {
    assertValidOutpost(own, fail);
    LOCATION_IDS = new Set([...SHARED_IDS, outpostId(own.site)]);
  }
  // The real systems, or Pyre, the invented star (docs/PROCGEN.md §26).
  if (!KNOWN_SYSTEM_IDS.includes(s.location?.systemId)) fail('unknown system');
  if (s.location.dockedAt !== null && !LOCATION_IDS.has(s.location.dockedAt)) fail('unknown dock');
  if (!LOCATION_IDS.has(s.location.lastDockId)) fail('unknown respawn dock');
  if (!Number.isFinite(s.credits) || s.credits < 0) fail('credits');
  assertValidShip(s.ship, fail);
  if (!Array.isArray(s.visitedSystems) || !Array.isArray(s.discoveredBodies)) fail('lists');
  if (!isRecord(s.contracts)) fail('contracts');
  for (const [id, c] of Object.entries(s.contracts)) {
    if (!isRecord(c) || c.id !== id || !Array.isArray(c.objectives) || !c.objectives.length || !Number.isFinite(c.reward) || typeof c.title !== 'string') fail(`contract ${id}`);
    const party = c.contract?.party;
    if (party !== undefined && (!Array.isArray(party) || !party.length || !party.every((n) => typeof n === 'string' && n.length > 0))) fail(`contract ${id}`);
  }
  if (!isRecord(s.law) || !isRecord(s.law.fines) || !Array.isArray(s.law.pending) || !isRecord(s.law.lastCrimeAt)) fail('law');
  for (const c of s.law.pending) {
    if (!isRecord(c) || !['sta', 'frontier', 'hollow-wake'].includes(c.faction) || !Number.isFinite(c.amount) || c.amount < 0 || !SYSTEM_IDS.includes(c.systemId) || !Number.isFinite(c.at)) fail('law');
  }
  assertValidFleet(s.fleet, fail);
  const w = s.world;
  if (!isRecord(w) || !isRecord(w.relief) || !isRecord(w.raidKills) || !isRecord(w.ended) || !isRecord(w.lingering) || !isRecord(w.border)) fail('world');
  for (const b of Object.values(w.border)) {
    if (!isRecord(b) || !Array.isArray(b.deeds) || !b.deeds.every((d) => Array.isArray(d) && d.length === 2 && d.every(Number.isFinite))) fail('border');
    if (b.ending !== undefined && !['law', 'wake', 'truce'].includes(b.ending)) fail('border');
  }
  if (w.marks !== undefined && (!isRecord(w.marks) || !Object.entries(w.marks).every(([id, t]) => !!markById(id) && Number.isFinite(t)))) fail('world');
  if (w.hauls !== undefined) {
    if (!isRecord(w.hauls)) fail('world');
    for (const r of Object.values(w.hauls)) {
      if (!isRecord(r) || !Number.isFinite(r.at) || !['safe', 'lost', 'escort', 'arrived'].includes(r.fate) || !SYSTEM_IDS.includes(r.systemId) || (r.by !== undefined && !['raiders', 'player'].includes(r.by))) fail('world');
    }
  }
  if (w.sky !== undefined && !(isRecord(w.sky) && Number.isFinite(w.sky.from) && w.sky.from >= 0)) fail('world');
  // Pyre's warning (docs/PROCGEN.md §26) comes after Antares has gone out.
  if (w.sky?.edge !== undefined && !(Number.isFinite(w.sky.edge) && w.sky.edge >= skyTimeline(w.sky.from).bhGone)) fail('world');
  if (w.rivals !== undefined) {
    if (!isRecord(w.rivals) || !isRecord(w.rivals.down) || !isRecord(w.rivals.bought)) fail('world');
    for (const [id, d] of Object.entries(w.rivals.down)) if (!ROSTER.some((r) => r.id === id) || !isRecord(d) || !Number.isFinite(d.at) || !SYSTEM_IDS.includes(d.systemId)) fail('world');
    for (const t of Object.values(w.rivals.bought)) if (!Number.isFinite(t)) fail('world');
  }
  for (const [sys, l] of Object.entries(w.lingering)) {
    if (!KNOWN_SYSTEM_IDS.includes(sys) || !isRecord(l) || !Number.isFinite(l.at) || !Array.isArray(l.packs) || !Array.isArray(l.pods)) fail('world');
    const v3 = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
    if (!l.packs.every((p) => isRecord(p) && [1, 2, 3].includes(p.level) && Number.isInteger(p.count) && p.count > 0 && v3(p.position))) fail('world');
    if (!l.pods.every((p) => isRecord(p) && v3(p.position) && Number.isFinite(p.value) && (!p.cargo || COMMODITY_IDS.includes(p.cargo.commodity)) && (!p.gear || !!findGear(p.gear)))) fail('world');
  }
  for (const [f, fine] of Object.entries(s.law.fines)) if (!['sta', 'frontier', 'hollow-wake'].includes(f) || !Number.isFinite(fine) || (fine as number) < 0) fail(`fine ${f}`);
  if (!Array.isArray(s.codex) || !s.codex.every((id) => typeof id === 'string')) fail('codex');
  if (!Array.isArray(s.surveysSold) || !s.surveysSold.every((id) => SYSTEM_IDS.includes(id))) fail('surveys');
  if (!isRecord(s.milestones) || !Object.values(s.milestones).every((t) => Number.isFinite(t))) fail('milestones');
  if (!Number.isFinite(s.stats?.sales) || !Number.isFinite(s.stats?.rewards)) fail('stats');
  if (!isRecord(s.story) || !isRecord(s.story.choices) || !Array.isArray(s.story.seen)) fail('story');
  if (!Object.values(s.story.choices).every((v) => typeof v === 'string') || !s.story.seen.every((v) => typeof v === 'string')) fail('story');
  if (!isRecord(s.dens) || !Object.entries(s.dens).every(([id, t]) => LOCATION_IDS.has(id) && Number.isFinite(t))) fail('dens');
  if (!Array.isArray(s.stash) || s.stash.length > COMBAT.loot.stash || !s.stash.every((id) => typeof id === 'string' && !!findGear(id))) fail('stash');
  if (!Array.isArray(s.crew) || s.crew.length > COMBAT.wingmen.max) fail('crew');
  for (const w of s.crew) {
    if (!isRecord(w) || typeof w.id !== 'string' || typeof w.name !== 'string' || !findShip(w.model) || !Number.isFinite(w.fee) || w.fee < 0 || (w.skill !== 'steady' && w.skill !== 'sharp')) fail('crew');
  }
  if (!Array.isArray(s.priceWatch) || !s.priceWatch.every((w) => isRecord(w) && LOCATION_IDS.has(w.locationId) && COMMODITY_IDS.includes(w.commodity))) fail('price watch');
  const kinds = ['price', 'event', 'den', 'ace', 'wreck', 'story', 'front'];
  if (!Array.isArray(s.rumours) || !s.rumours.every((r) => isRecord(r) && typeof r.key === 'string' && typeof r.text === 'string' && kinds.includes(r.kind) && Number.isFinite(r.at))) fail('rumours');
  if (!isRecord(s.knownMarkets)) fail('known markets');
  for (const [id, m] of Object.entries(s.knownMarkets)) {
    if (!LOCATION_IDS.has(id) || !isRecord(m) || !Number.isFinite(m.observedAt) || !isRecord(m.prices) || !['visited', 'briefing', 'rumour', 'watch'].includes(m.source)) fail(`known market ${id}`);
    if (m.goodsAt !== undefined && (!isRecord(m.goodsAt) || !Object.values(m.goodsAt).every((g) => isRecord(g) && Number.isFinite(g.t)))) fail(`known market ${id}`);
  }
  if (!isRecord(s.markets)) fail('markets');
  for (const [id, m] of Object.entries(s.markets)) {
    if (!LOCATION_IDS.has(id) || !isRecord(m) || !Number.isFinite(m.t) || !isRecord(m.stock)) fail(`market ${id}`);
    for (const [c, qty] of Object.entries(m.stock)) if (!COMMODITY_IDS.includes(c as CommodityId) || !Number.isFinite(qty) || (qty as number) < 0) fail(`market ${id}`);
  }
  if (!isRecord(s.jobs) || !isRecord(s.reputation) || !isRecord(s.flags)) fail('records');
  // Standing with rival pilots (§24): only the six, within ±100.
  if (s.rivals !== undefined) {
    if (!isRecord(s.rivals)) fail('rivals');
    for (const [id, r] of Object.entries(s.rivals)) {
      const ok = ROSTER.some((x) => x.id === id) && isRecord(r) && Number.isFinite(r.standing) && Math.abs(r.standing) <= 100 && (r.round === undefined || Number.isInteger(r.round)) && (r.shot === undefined || Number.isFinite(r.shot));
      if (!ok) fail(`rival ${id}`);
    }
  }
  // Escorts across jumps remember the system their ships are in.
  for (const [id, p] of Object.entries(s.jobs)) {
    if (!isRecord(p) || (p.escortAt !== undefined && !SYSTEM_IDS.includes(p.escortAt))) fail(`job ${id}`);
    // Passengers and sightseers (docs/PROCGEN.md §23): a tour's sight seen, and a fare's fright within 0–1.
    if ((p.seen !== undefined && typeof p.seen !== 'boolean') || (p.fright !== undefined && !(Number.isFinite(p.fright) && p.fright >= 0 && p.fright <= 1))) fail(`job ${id}`);
    // Observations of a dying far star (§25): when, and from a system of the map.
    if (p.observed !== undefined && !(Array.isArray(p.observed) && p.observed.every((x) => isRecord(x) && Number.isFinite(x.at) && KNOWN_SYSTEM_IDS.includes(x.systemId)))) fail(`job ${id}`);
  }
  if (s.location.flight) {
    const { position, quaternion } = s.location.flight;
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) fail('flight position');
    if (!Array.isArray(quaternion) || quaternion.length !== 4 || !quaternion.every(Number.isFinite)) fail('flight orientation');
  }
}
