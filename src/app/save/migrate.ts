import { ALL_LOCATIONS } from '../../data/systems.ts';
import { SYSTEM_IDS, type SystemId } from '../../data/types.ts';
import { createNewGame, SAVE_VERSION, type CommodityId, type GameState } from '../state.ts';

/**
 * Save format history:
 * - v1 (flight-and-dock milestone): flat record { version: 1, system, dockedAt, money, hull, shield,
 *   cargo, visited, seed, savedAt }. No jobs, reputation or market memory.
 * - v2 (current): see GameState in src/app/state.ts.
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

const COMMODITY_IDS: readonly CommodityId[] = ['medical', 'fabricators', 'deuterium'];
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

/** Upgrades any known save version to the current GameState. Throws SaveFormatError when unusable. */
export function migrateSave(raw: unknown): GameState {
  if (!isRecord(raw) || typeof raw.version !== 'number') throw new SaveFormatError('Save data is not recognisable.');
  let data: unknown = raw;
  if (raw.version > SAVE_VERSION) {
    throw new SaveFormatError(`Save was made by a newer version (format ${raw.version}).`);
  }
  if (raw.version === 1) data = migrateV1(raw as unknown as SaveV1);
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
  for (const [id, qty] of Object.entries(s.ship.cargo)) {
    if (!COMMODITY_IDS.includes(id as CommodityId) || !Number.isInteger(qty) || (qty as number) < 0) fail('cargo entry');
  }
  if (!Array.isArray(s.visitedSystems) || !Array.isArray(s.discoveredBodies)) fail('lists');
  if (!isRecord(s.jobs) || !isRecord(s.reputation) || !isRecord(s.flags)) fail('records');
  if (s.location.flight) {
    const { position, quaternion } = s.location.flight;
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) fail('flight position');
    if (!Array.isArray(quaternion) || quaternion.length !== 4 || !quaternion.every(Number.isFinite)) fail('flight orientation');
  }
}
