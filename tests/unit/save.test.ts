import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { dockAt, performJump, routeFee, undock } from '../../src/app/rules.ts';
import { IndexedDbBackend, MemoryBackend } from '../../src/app/save/backend.ts';
import { migrateSave, SaveFormatError, type SaveV1 } from '../../src/app/save/migrate.ts';
import { BACKUP_KEY, SAVE_KEY, SaveManager } from '../../src/app/save/SaveManager.ts';
import { defaultSettings, sanitizeSettings } from '../../src/app/settings.ts';
import { createNewGame, SAVE_VERSION } from '../../src/app/state.ts';
import { SYSTEMS } from '../../src/data/systems.ts';
import { acceptJob, LIFELINE_ID } from '../../src/economy/jobs.ts';
import { buyCommodity } from '../../src/economy/trade.ts';
import { findRoute } from '../../src/galaxy/routing.ts';

const v1Save: SaveV1 = {
  version: 1,
  savedAt: '2026-09-20T10:00:00.000Z',
  seed: 42,
  system: 'sol',
  dockedAt: 'mars-depot',
  money: 1234,
  hull: 77,
  shield: 30,
  cargo: { medical: 5, deuterium: 2, bogus: 9 },
  visited: ['sol'],
};

describe('save migration', () => {
  it('upgrades a v1 save to the current format with sensible defaults', () => {
    const s = migrateSave(v1Save);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.credits).toBe(1234);
    expect(s.ship.hull).toBe(77);
    expect(s.ship.cargo).toEqual({ medical: 5, deuterium: 2 });
    expect(s.location).toMatchObject({ systemId: 'sol', dockedAt: 'mars-depot', lastDockId: 'mars-depot' });
    expect(s.jobs).toEqual({});
    expect(s.reputation.sta).toBe(0);
    expect(s.seed).toBe(42);
  });

  it('keeps jump ability for v1 pilots who had already left Sol', () => {
    const s = migrateSave({ ...v1Save, system: 'barnard', dockedAt: 'barnard-relay', visited: ['sol', 'barnard'] });
    expect(s.flags.clearance).toBe(true);
    expect(s.visitedSystems).toEqual(['sol', 'barnard']);
  });

  it('accepts the current version unchanged and rejects future or damaged saves', () => {
    const current = createNewGame(5);
    expect(migrateSave(structuredClone(current))).toEqual(current);
    expect(() => migrateSave({ ...current, version: 99 })).toThrow(SaveFormatError);
    expect(() => migrateSave({ ...current, credits: -5 })).toThrow(SaveFormatError);
    expect(() => migrateSave({ ...current, location: { ...current.location, systemId: 'vega' } })).toThrow(
      SaveFormatError,
    );
    expect(() => migrateSave('garbage')).toThrow(SaveFormatError);
  });
});

describe('SaveManager', () => {
  it('round-trips through IndexedDB and keeps the previous save as a backup', async () => {
    const backend = new IndexedDbBackend(new IDBFactory());
    const saves = new SaveManager(backend);
    expect((await saves.load()).state).toBeNull();
    const s = createNewGame(11);
    await saves.save(s);
    s.credits = 999;
    await saves.save(s);
    const loaded = await saves.load();
    expect(loaded.state?.credits).toBe(999);
    const backup = (await backend.get(BACKUP_KEY)) as { credits: number };
    expect(backup.credits).toBe(800);
  });

  it('falls back to the backup when the main save is damaged', async () => {
    const backend = new MemoryBackend();
    const saves = new SaveManager(backend);
    const s = createNewGame(11);
    await saves.save(s);
    await saves.save(s);
    backend.data.set(SAVE_KEY, { version: 2, credits: 'lots' });
    const loaded = await saves.load();
    expect(loaded.state?.credits).toBe(800);
    expect(loaded.warning).toMatch(/Restored the previous save/);
  });

  it('coalesces rapid saves and writes the latest snapshot', async () => {
    const backend = new MemoryBackend();
    const saves = new SaveManager(backend);
    const s = createNewGame(1);
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      s.credits = 100 + i;
      writes.push(saves.save(s));
    }
    await Promise.all(writes);
    expect(((await backend.get(SAVE_KEY)) as { credits: number }).credits).toBe(104);
  });

  it('persists the new system immediately after a jump (save-after-jump)', async () => {
    const saves = new SaveManager(new IndexedDbBackend(new IDBFactory()));
    const s = createNewGame(21);
    acceptJob(s, LIFELINE_ID);
    buyCommodity(s, 'earth-port', 'medical', 6);
    dockAt(s, 'earth-port');
    dockAt(s, 'mars-depot');
    undock(s);
    await saves.save(s);
    const route = findRoute(SYSTEMS, 'sol', 'alpha-centauri')!;
    performJump(s, route, routeFee(s, route));
    await saves.save(s);
    // A fresh manager (as after a page refresh) loads the post-jump state.
    const reloaded = await new SaveManager(saves.backend).load();
    expect(reloaded.state?.location.systemId).toBe('alpha-centauri');
    expect(reloaded.state?.visitedSystems).toContain('alpha-centauri');
    expect(reloaded.state?.jobs[LIFELINE_ID]?.status).toBe('active');
    expect(reloaded.state?.ship.cargo.medical).toBe(6);
  });

  it('reset removes the save but keeps settings', async () => {
    const saves = new SaveManager(new MemoryBackend());
    await saves.save(createNewGame(1));
    await saves.saveSettings({ ...defaultSettings(), textScale: 1.3 });
    await saves.reset();
    expect((await saves.load()).state).toBeNull();
    expect(sanitizeSettings(await saves.loadSettings()).textScale).toBe(1.3);
  });
});

describe('settings sanitising', () => {
  it('drops invalid values and clamps volumes', () => {
    const s = sanitizeSettings({ quality: 'ultra', textScale: 3, volumes: { master: 4, music: -1 }, aimAssist: 'medium' });
    expect(s.quality).toBe('auto');
    expect(s.textScale).toBe(1);
    expect(s.volumes.master).toBe(1);
    expect(s.volumes.music).toBe(0);
    expect(s.aimAssist).toBe('medium');
  });
});
