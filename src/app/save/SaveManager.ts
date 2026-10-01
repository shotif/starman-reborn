import { SETTINGS_KEY } from '../settings.ts';
import type { GameState } from '../state.ts';
import type { SaveBackend } from './backend.ts';
import { migrateSave, SaveFormatError } from './migrate.ts';
import { assertSlot, readSlot, SLOT_COUNT, slotGame, slotKey, summarize, type SaveSlot, type SlotRecord } from './slots.ts';

/** The autosave: the running game's own save (it keeps this key from before there were slots). */
export const SAVE_KEY = 'save:main';
export const BACKUP_KEY = 'save:backup';
export { SETTINGS_KEY };

export interface LoadResult {
  state: GameState | null;
  /** Set when the main save was unreadable and the backup (or nothing) was used. */
  warning?: string;
}

/**
 * Serialises saves so writes never interleave, keeps the previous save as a backup in the same
 * atomic transaction, and migrates older formats on load. Beside the autosave it keeps the manual
 * save slots (src/app/save/slots.ts), written through the same queue.
 */
export class SaveManager {
  readonly backend: SaveBackend;
  private queue: Promise<void> = Promise.resolve();
  private pending: GameState | null = null;
  lastSavedAt: string | null = null;
  lastError: string | null = null;

  constructor(backend: SaveBackend) {
    this.backend = backend;
  }

  async load(): Promise<LoadResult> {
    const main = await this.backend.get(SAVE_KEY).catch(() => undefined);
    if (main === undefined) return { state: null };
    try {
      return { state: migrateSave(main) };
    } catch (err) {
      const reason = err instanceof SaveFormatError ? err.message : 'Save data could not be read.';
      const backup = await this.backend.get(BACKUP_KEY).catch(() => undefined);
      if (backup !== undefined) {
        try {
          return { state: migrateSave(backup), warning: `${reason} Restored the previous save.` };
        } catch {
          // Both unusable.
        }
      }
      return { state: null, warning: `${reason} Starting fresh is required.` };
    }
  }

  async hasSave(): Promise<boolean> {
    return (await this.load()).state !== null;
  }

  /**
   * Queues an atomic save of a snapshot of `state`. Multiple calls while a write is in flight
   * coalesce into one write of the latest snapshot.
   */
  save(state: GameState): Promise<void> {
    const snapshot = structuredClone(state);
    snapshot.savedAt = new Date().toISOString();
    const alreadyQueued = this.pending !== null;
    this.pending = snapshot;
    if (alreadyQueued) return this.queue;
    this.queue = this.queue.then(async () => {
      const next = this.pending;
      this.pending = null;
      if (!next) return;
      try {
        await this.backend.write({ [SAVE_KEY]: next }, { key: BACKUP_KEY, from: SAVE_KEY });
        this.lastSavedAt = next.savedAt;
        this.lastError = null;
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
      }
    });
    return this.queue;
  }

  /** Resolves when every queued write has finished. */
  flush(): Promise<void> {
    return this.queue;
  }

  /** Runs a storage operation after every write queued before it; its failure reaches the caller only. */
  private enqueue(op: () => Promise<void>): Promise<void> {
    const run = this.queue.then(op);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ---------------------------------------------------------------- manual slots

  /** Lists the manual slots with their stored summaries (the games are not migrated). */
  async listSlots(): Promise<SaveSlot[]> {
    await this.flush();
    const slots: SaveSlot[] = [];
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      slots.push(readSlot(slot, await this.backend.get(slotKey(slot)).catch(() => undefined)));
    }
    return slots;
  }

  /**
   * Stores a snapshot of `state` in a slot, replacing what was there. The snapshot is stamped with
   * the current time unless `keepSavedAt` (an imported game keeps the time it was saved).
   */
  saveToSlot(slot: number, state: GameState, opts: { keepSavedAt?: boolean } = {}): Promise<void> {
    assertSlot(slot);
    const snapshot = structuredClone(state);
    if (!opts.keepSavedAt || typeof snapshot.savedAt !== 'string' || Number.isNaN(Date.parse(snapshot.savedAt))) {
      snapshot.savedAt = new Date().toISOString();
    }
    const record: SlotRecord = { summary: summarize(snapshot), state: snapshot };
    return this.enqueue(() => this.backend.write({ [slotKey(slot)]: record }));
  }

  /** The game in a slot, migrated to the current format. Throws SaveFormatError when empty or damaged. */
  async loadSlot(slot: number): Promise<GameState> {
    assertSlot(slot);
    await this.flush();
    return slotGame(readSlot(slot, await this.backend.get(slotKey(slot))));
  }

  deleteSlot(slot: number): Promise<void> {
    assertSlot(slot);
    return this.enqueue(() => this.backend.remove([slotKey(slot)]));
  }

  /** Deletes the autosave and its backup; the manual slots and settings are kept. */
  async reset(): Promise<void> {
    await this.flush();
    this.pending = null;
    await this.backend.remove([SAVE_KEY, BACKUP_KEY]);
  }

  async loadSettings(): Promise<unknown> {
    return this.backend.get(SETTINGS_KEY).catch(() => undefined);
  }

  async saveSettings(settings: unknown): Promise<void> {
    await this.backend.write({ [SETTINGS_KEY]: structuredClone(settings) }).catch(() => undefined);
  }
}
