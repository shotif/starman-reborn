import { findGear, findShip } from '../../content/catalog.ts';
import { STARTER_SHIP_ID } from '../../content/rules/index.ts';
import { ALL_LOCATIONS } from '../../data/systems.ts';
import { SYSTEM_IDS } from '../../data/systems.ts';
import type { SystemId } from '../../data/types.ts';
import { clampShip, newShipState } from '../../economy/loadout.ts';
import { COMMODITY_IDS } from '../../content/economy/goods.ts';
import { createNewGame, SAVE_VERSION, type CommodityId, type GameState } from '../state.ts';

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
 * - v7 (current): `law` (fines owed to the lawful factions), smuggling and piracy contracts, and two
 *   contraband goods. See GameState in src/app/state.ts.
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

const LOCATION_IDS = new Set(ALL_LOCATIONS.filter((l) => l.status === 'functional').map((l) => l.id));

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
function migrateV5(old: Omit<GameState, 'version' | 'law'> & { version: 5 }): GameState {
  return migrateV6({ ...old, version: 6 });
}

/** v6 → v7: a clean record with the law. */
function migrateV6(old: Omit<GameState, 'version' | 'law'> & { version: 6 }): GameState {
  return { ...old, version: SAVE_VERSION, law: { fines: {} } };
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
  const state = data as GameState;
  assertValidState(state);
  return state;
}

/** Structural and range checks; throws SaveFormatError on anything that would break the game. */
export function assertValidState(s: GameState): void {
  const fail = (msg: string): never => {
    throw new SaveFormatError(`Save data is damaged: ${msg}`);
  };
  if (!isRecord(s) || s.version !== SAVE_VERSION) fail('wrong version');
  if (!SYSTEM_IDS.includes(s.location?.systemId)) fail('unknown system');
  if (s.location.dockedAt !== null && !LOCATION_IDS.has(s.location.dockedAt)) fail('unknown dock');
  if (!LOCATION_IDS.has(s.location.lastDockId)) fail('unknown respawn dock');
  if (!Number.isFinite(s.credits) || s.credits < 0) fail('credits');
  if (!isRecord(s.ship) || !Number.isFinite(s.ship.hull) || !Number.isFinite(s.ship.shield)) fail('ship');
  if (!isRecord(s.ship.cargo)) fail('cargo');
  const model = typeof s.ship.model === 'string' ? findShip(s.ship.model) : undefined;
  if (!model) fail('unknown ship model');
  if (!isRecord(s.ship.fittings) || !isRecord(s.ship.ammo)) fail('fittings');
  for (const [slotId, gearId] of Object.entries(s.ship.fittings)) {
    const slot = model!.slots.find((sl) => sl.id === slotId);
    const item = typeof gearId === 'string' ? findGear(gearId) : undefined;
    if (!slot || !item || item.slot !== slot.type || item.tier > slot.maxClass) fail(`fitting ${slotId}`);
  }
  for (const [slotId, rounds] of Object.entries(s.ship.ammo)) {
    if (!model!.slots.some((sl) => sl.id === slotId && sl.type === 'launcher') || !Number.isInteger(rounds) || (rounds as number) < 0) fail(`ammo ${slotId}`);
  }
  if (!Number.isInteger(s.ship.repairKits) || s.ship.repairKits < 0) fail('repair kits');
  for (const [id, qty] of Object.entries(s.ship.cargo)) {
    if (!COMMODITY_IDS.includes(id as CommodityId) || !Number.isInteger(qty) || (qty as number) < 0) fail('cargo entry');
  }
  if (!Array.isArray(s.visitedSystems) || !Array.isArray(s.discoveredBodies)) fail('lists');
  if (!isRecord(s.contracts)) fail('contracts');
  for (const [id, c] of Object.entries(s.contracts)) {
    if (!isRecord(c) || c.id !== id || !Array.isArray(c.objectives) || !c.objectives.length || !Number.isFinite(c.reward) || typeof c.title !== 'string') fail(`contract ${id}`);
  }
  if (!isRecord(s.law) || !isRecord(s.law.fines)) fail('law');
  for (const [f, fine] of Object.entries(s.law.fines)) if (!['sta', 'frontier', 'hollow-wake'].includes(f) || !Number.isFinite(fine) || (fine as number) < 0) fail(`fine ${f}`);
  if (!isRecord(s.markets)) fail('markets');
  for (const [id, m] of Object.entries(s.markets)) {
    if (!LOCATION_IDS.has(id) || !isRecord(m) || !Number.isFinite(m.t) || !isRecord(m.stock)) fail(`market ${id}`);
    for (const [c, qty] of Object.entries(m.stock)) if (!COMMODITY_IDS.includes(c as CommodityId) || !Number.isFinite(qty) || (qty as number) < 0) fail(`market ${id}`);
  }
  if (!isRecord(s.jobs) || !isRecord(s.reputation) || !isRecord(s.flags)) fail('records');
  if (s.location.flight) {
    const { position, quaternion } = s.location.flight;
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) fail('flight position');
    if (!Array.isArray(quaternion) || quaternion.length !== 4 || !quaternion.every(Number.isFinite)) fail('flight orientation');
  }
}
