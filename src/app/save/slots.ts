import { getLocation, getSystem } from '../../data/systems.ts';
import type { SystemId } from '../../data/types.ts';
import { formatCredits } from '../../ui/dom.ts';
import type { GameState } from '../state.ts';
import { migrateSave, SaveFormatError } from './migrate.ts';

/**
 * Manual save slots, kept beside the autosave (the running game's own save under `save:main`).
 * Each slot is one record: a small summary for the save list, and a full GameState snapshot that
 * is migrated only when the slot is loaded or exported.
 */
export const SLOT_COUNT = 3;

/** Storage key of a manual save slot (numbered from 1). */
export function slotKey(slot: number): string {
  return `save:slot:${slot}`;
}

/** Throws unless `slot` is one of the manual slots. */
export function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) throw new RangeError(`No save slot ${slot}`);
}

/** What a save list shows without migrating the save: where, how rich, how long played, when. */
export interface SaveSummary {
  credits: number;
  systemId: SystemId;
  /** Station docked at, or null in flight. */
  dockedAt: string | null;
  /** Game-clock seconds of play. */
  clock: number;
  /** ISO time the game was saved. */
  savedAt: string;
}

/** A slot as stored. */
export interface SlotRecord {
  summary: SaveSummary;
  state: GameState;
}

/** A slot as listed. */
export interface SaveSlot {
  slot: number;
  empty: boolean;
  /** Null when the slot is empty, or when neither its summary nor its game can be read (damaged). */
  summary: SaveSummary | null;
  /** The stored game as read, not yet migrated (see slotGame). */
  data: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The summary of a game, as a save list shows it. */
export function summarize(state: GameState): SaveSummary {
  return {
    credits: state.credits,
    systemId: state.location.systemId,
    dockedAt: state.location.dockedAt,
    clock: state.clock,
    savedAt: state.savedAt,
  };
}

/** A stored summary, or null when it is missing or damaged. */
function readSummary(raw: unknown): SaveSummary | null {
  if (!isRecord(raw)) return null;
  const { credits, systemId, dockedAt, clock, savedAt } = raw;
  if (typeof credits !== 'number' || !Number.isFinite(credits)) return null;
  if (typeof clock !== 'number' || !Number.isFinite(clock)) return null;
  if (typeof systemId !== 'string' || typeof savedAt !== 'string') return null;
  if (dockedAt !== null && typeof dockedAt !== 'string') return null;
  return { credits, systemId, dockedAt, clock, savedAt };
}

/**
 * Reads what storage holds for a slot. The stored summary is used as it is; only when it is
 * missing or damaged is the game itself migrated to work one out.
 */
export function readSlot(slot: number, raw: unknown): SaveSlot {
  if (raw === undefined || raw === null) return { slot, empty: true, summary: null, data: undefined };
  const data = isRecord(raw) ? raw.state : undefined;
  // A record without its game is damaged, whatever its summary says.
  let summary = isRecord(raw) && data !== undefined ? readSummary(raw.summary) : null;
  if (!summary && data !== undefined) {
    try {
      summary = summarize(migrateSave(structuredClone(data)));
    } catch {
      summary = null;
    }
  }
  return { slot, empty: false, summary, data };
}

/** The game in a listed slot, migrated to the current format. Throws SaveFormatError when empty or damaged. */
export function slotGame(slot: SaveSlot): GameState {
  if (slot.empty) throw new SaveFormatError(`Slot ${slot.slot} is empty.`);
  if (slot.data === undefined) throw new SaveFormatError('Save data is not recognisable.');
  // Migration hands back the stored object itself when it is current: keep the listing's copy intact.
  return migrateSave(structuredClone(slot.data));
}

// ---------------------------------------------------------------- how a summary reads

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sol · Halcyon Ring", or "Alpha Centauri · in flight"; unknown ids (a newer game's) show as they are. */
export function placeLabel(summary: Pick<SaveSummary, 'systemId' | 'dockedAt'>): string {
  let system: string = summary.systemId;
  try {
    system = getSystem(summary.systemId).displayName;
  } catch {
    // Keep the id.
  }
  if (summary.dockedAt === null) return `${system} · in flight`;
  let dock: string = summary.dockedAt;
  try {
    dock = getLocation(summary.dockedAt).name;
  } catch {
    // Keep the id.
  }
  return `${system} · ${dock}`;
}

/** Play time from the game clock: "under a minute", "12 min", "1 h 05 min". */
export function playTimeLabel(clock: number): string {
  const minutes = Math.floor(Math.max(0, clock) / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** When a game was saved, in local time: "30 Sep 2026, 18:31" (or "unknown" for a damaged date). */
export function savedAtLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
}

/** The summary as text: place, credits, play time and save time. */
export function describeSave(summary: SaveSummary): { place: string; credits: string; played: string; saved: string } {
  return {
    place: placeLabel(summary),
    credits: formatCredits(summary.credits),
    played: `${playTimeLabel(summary.clock)} played`,
    saved: savedAtLabel(summary.savedAt),
  };
}

/** One line for confirmations: "Sol · Halcyon Ring · 1,234 cr · saved 30 Sep 2026, 18:31". */
export function summaryLine(summary: SaveSummary): string {
  const t = describeSave(summary);
  return `${t.place} · ${t.credits} · saved ${t.saved}`;
}
