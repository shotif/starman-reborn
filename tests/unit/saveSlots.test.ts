import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { dockAt, undock } from '../../src/app/rules.ts';
import { IndexedDbBackend, MemoryBackend } from '../../src/app/save/backend.ts';
import { migrateSave, SaveFormatError, type SaveV1 } from '../../src/app/save/migrate.ts';
import { exportSaveFile, parseSaveFile, SAVE_FILE_FORMAT, SAVE_FILE_MAX_BYTES, SAVE_FILE_VERSION, SaveFileError, saveFileName } from '../../src/app/save/saveFile.ts';
import { BACKUP_KEY, SAVE_KEY, SaveManager } from '../../src/app/save/SaveManager.ts';
import { describeSave, placeLabel, playTimeLabel, readSlot, savedAtLabel, SLOT_COUNT, slotGame, slotKey, summarize, summaryLine } from '../../src/app/save/slots.ts';
import { createNewGame, SAVE_VERSION, type GameState } from '../../src/app/state.ts';
import { acceptJob, LIFELINE_ID } from '../../src/economy/jobs.ts';
import { buyCommodity } from '../../src/economy/trade.ts';

/** A game some way in: a contract, cargo, a trip to Mars, and out in flight at a pose. */
function gameInFlight(seed = 31): GameState {
  const s = createNewGame(seed);
  acceptJob(s, LIFELINE_ID);
  buyCommodity(s, 'earth-port', 'medical', 6);
  dockAt(s, 'earth-port');
  dockAt(s, 'mars-depot');
  undock(s);
  s.clock = 3725;
  s.location.flight = { position: [120.5, -40, 2600], quaternion: [0, 0.2, 0, 0.98] };
  return s;
}

const v1Save: SaveV1 = {
  version: 1,
  savedAt: '2026-09-20T10:00:00.000Z',
  seed: 42,
  system: 'sol',
  dockedAt: 'mars-depot',
  money: 1234,
  hull: 77,
  shield: 30,
  cargo: { medical: 5 },
  visited: ['sol'],
};

describe('save slots', () => {
  it('start empty, and store, list, load and delete a game in IndexedDB', async () => {
    const backend = new IndexedDbBackend(new IDBFactory());
    const saves = new SaveManager(backend);
    const empty = await saves.listSlots();
    expect(empty.map((s) => s.slot)).toEqual([1, 2, 3]);
    expect(SLOT_COUNT).toBe(3);
    expect(empty.every((s) => s.empty && s.summary === null)).toBe(true);

    const game = gameInFlight();
    await saves.saveToSlot(2, game);
    const listed = await saves.listSlots();
    expect(listed.map((s) => s.empty)).toEqual([true, false, true]);
    expect(listed[1]!.summary).toMatchObject({ credits: game.credits, systemId: 'sol', dockedAt: null, clock: 3725 });
    expect(Date.parse(listed[1]!.summary!.savedAt)).not.toBeNaN();

    const loaded = await saves.loadSlot(2);
    expect(loaded).toEqual({ ...game, savedAt: loaded.savedAt });
    expect(loaded.location.flight).toEqual(game.location.flight);
    expect(loaded.jobs[LIFELINE_ID]?.status).toBe('active');
    expect(slotGame(listed[1]!)).toEqual(loaded);

    await saves.deleteSlot(2);
    expect((await saves.listSlots()).every((s) => s.empty)).toBe(true);
    await expect(saves.loadSlot(2)).rejects.toThrow(SaveFormatError);
    await expect(saves.loadSlot(2)).rejects.toThrow(/empty/);
  });

  it('keep a copy: later changes to the running game do not reach the slot', async () => {
    const saves = new SaveManager(new MemoryBackend());
    const game = createNewGame(4);
    await saves.saveToSlot(1, game);
    game.credits = 5;
    game.ship.cargo.medical = 3;
    const loaded = await saves.loadSlot(1);
    expect(loaded.credits).toBe(800);
    expect(loaded.ship.cargo).toEqual({});
  });

  it('overwrite a slot with the new game and summary', async () => {
    const saves = new SaveManager(new MemoryBackend());
    await saves.saveToSlot(3, createNewGame(1));
    const richer = createNewGame(2);
    richer.credits = 4321;
    await saves.saveToSlot(3, richer);
    const [, , third] = await saves.listSlots();
    expect(third!.summary?.credits).toBe(4321);
    expect((await saves.loadSlot(3)).seed).toBe(2);
  });

  it('live beside the autosave, which keeps its key and is never touched by slot writes', async () => {
    const backend = new MemoryBackend();
    const saves = new SaveManager(backend);
    const running = createNewGame(8);
    await saves.save(running);
    await saves.save(running);
    const slotGameState = createNewGame(9);
    slotGameState.credits = 77;
    await saves.saveToSlot(1, slotGameState);
    await saves.deleteSlot(1);
    await saves.saveToSlot(2, slotGameState);
    expect([...backend.data.keys()].sort()).toEqual([BACKUP_KEY, SAVE_KEY, slotKey(2)].sort());
    expect(SAVE_KEY).toBe('save:main');
    expect((await saves.load()).state?.seed).toBe(8);
    // Resetting the autosave keeps the slots.
    await saves.reset();
    expect((await saves.load()).state).toBeNull();
    expect((await saves.loadSlot(2)).credits).toBe(77);
  });

  it('write in order with pending autosaves', async () => {
    const backend = new MemoryBackend();
    const saves = new SaveManager(backend);
    const game = createNewGame(3);
    const writes: Promise<void>[] = [];
    game.credits = 100;
    writes.push(saves.save(game));
    writes.push(saves.saveToSlot(1, game));
    game.credits = 200;
    writes.push(saves.save(game));
    await Promise.all(writes);
    expect((await saves.loadSlot(1)).credits).toBe(100);
    expect((await saves.load()).state?.credits).toBe(200);
  });

  it('refuse slots that do not exist', async () => {
    const saves = new SaveManager(new MemoryBackend());
    expect(() => saves.saveToSlot(0, createNewGame(1))).toThrow(RangeError);
    expect(() => saves.saveToSlot(SLOT_COUNT + 1, createNewGame(1))).toThrow(RangeError);
    expect(() => saves.deleteSlot(1.5)).toThrow(RangeError);
    await expect(saves.loadSlot(4)).rejects.toThrow(RangeError);
  });

  it('show an older game from its stored summary, and migrate it only when loaded', async () => {
    const backend = new MemoryBackend();
    const saves = new SaveManager(backend);
    backend.data.set(slotKey(1), {
      summary: { credits: 1234, systemId: 'sol', dockedAt: 'mars-depot', clock: 0, savedAt: v1Save.savedAt },
      state: v1Save,
    });
    const [first] = await saves.listSlots();
    expect(first!.summary).toEqual({ credits: 1234, systemId: 'sol', dockedAt: 'mars-depot', clock: 0, savedAt: v1Save.savedAt });
    expect(first!.data).toEqual(v1Save);
    const loaded = await saves.loadSlot(1);
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.location.dockedAt).toBe('mars-depot');
  });

  it('list damaged slots as such: loading them fails cleanly and deleting clears them', async () => {
    const backend = new MemoryBackend();
    const saves = new SaveManager(backend);
    const good = createNewGame(6);
    // A summary without its game, a game whose summary is broken, a damaged game, and junk.
    backend.data.set(slotKey(1), { summary: summarize(good) });
    backend.data.set(slotKey(2), { summary: { credits: 'lots' }, state: good });
    backend.data.set(slotKey(3), { summary: summarize(good), state: { ...good, credits: -5 } });
    const [one, two, three] = await saves.listSlots();
    expect(one).toMatchObject({ empty: false, summary: null });
    expect(two!.summary).toEqual(summarize(good));
    expect(three!.summary).toEqual(summarize(good));
    await expect(saves.loadSlot(1)).rejects.toThrow(SaveFormatError);
    await expect(saves.loadSlot(3)).rejects.toThrow(/damaged: credits/);
    expect((await saves.loadSlot(2)).seed).toBe(6);
    expect(readSlot(1, 'junk')).toMatchObject({ empty: false, summary: null });
    expect(readSlot(1, null)).toMatchObject({ empty: true, summary: null });
    await saves.deleteSlot(3);
    expect((await saves.listSlots())[2]!.empty).toBe(true);
  });

  it('keep the time an imported game was saved when asked to', async () => {
    const saves = new SaveManager(new MemoryBackend());
    const imported = createNewGame(5, new Date('2026-09-28T21:04:00.000Z'));
    await saves.saveToSlot(1, imported, { keepSavedAt: true });
    await saves.saveToSlot(2, imported);
    const [one, two] = await saves.listSlots();
    expect(one!.summary?.savedAt).toBe('2026-09-28T21:04:00.000Z');
    expect(two!.summary?.savedAt).not.toBe('2026-09-28T21:04:00.000Z');
  });
});

describe('save summaries', () => {
  it('say where the game is, how rich, how long played and when saved', () => {
    const docked = createNewGame(1, new Date(2026, 8, 30, 18, 31));
    docked.credits = 1234.4;
    docked.clock = 65 * 60 + 20;
    const s = summarize(docked);
    expect(s).toEqual({ credits: 1234.4, systemId: 'sol', dockedAt: 'earth-port', clock: 3920, savedAt: docked.savedAt });
    expect(describeSave(s)).toEqual({ place: 'Sol · Halcyon Ring', credits: '1,234 cr', played: '1 h 05 min played', saved: '30 Sep 2026, 18:31' });
    expect(summaryLine(s)).toBe('Sol · Halcyon Ring · 1,234 cr · saved 30 Sep 2026, 18:31');
    expect(placeLabel(summarize(gameInFlight()))).toBe('Sol · in flight');
  });

  it('read play time and dates plainly, and survive ids from a newer game', () => {
    expect(playTimeLabel(0)).toBe('under a minute');
    expect(playTimeLabel(59)).toBe('under a minute');
    expect(playTimeLabel(12 * 60 + 5)).toBe('12 min');
    expect(playTimeLabel(26 * 3600 + 7 * 60)).toBe('26 h 07 min');
    expect(savedAtLabel(new Date(2026, 0, 2, 9, 5).toISOString())).toBe('2 Jan 2026, 09:05');
    expect(savedAtLabel('not a date')).toBe('unknown');
    expect(placeLabel({ systemId: 'vega', dockedAt: 'vega-port' })).toBe('vega · vega-port');
    expect(placeLabel({ systemId: 'alpha-centauri', dockedAt: null })).toBe('Alpha Centauri · in flight');
  });
});

describe('save files', () => {
  it('are named by the local date, and by slot', () => {
    expect(saveFileName(new Date(2026, 8, 30, 23, 59))).toBe('starman-save-2026-09-30.json');
    expect(saveFileName(new Date(2026, 0, 5, 0, 1), 2)).toBe('starman-save-2026-01-05-slot-2.json');
  });

  it('round-trip a game through export, import and migrateSave', () => {
    const game = gameInFlight();
    const now = new Date(2026, 8, 30, 12, 0);
    const file = exportSaveFile(game, now, 1);
    expect(file.name).toBe('starman-save-2026-09-30-slot-1.json');
    const raw = JSON.parse(file.json);
    expect(Object.keys(raw)).toEqual(['format', 'version', 'exportedAt', 'state']);
    expect(raw).toMatchObject({ format: SAVE_FILE_FORMAT, version: SAVE_FILE_VERSION, exportedAt: now.toISOString() });
    const back = parseSaveFile(file.json);
    expect(back).toEqual(game);
    expect(migrateSave(raw.state)).toEqual(game);
    // A byte-order mark from an editor is ignored.
    expect(parseSaveFile(`﻿${file.json}`)).toEqual(game);
  });

  it('import a file holding an older game by migrating it', () => {
    const json = JSON.stringify({ format: SAVE_FILE_FORMAT, version: 1, exportedAt: '2026-09-21T08:00:00.000Z', state: v1Save });
    const s = parseSaveFile(json);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.credits).toBe(1234);
    expect(s.location.dockedAt).toBe('mars-depot');
  });

  it('refuse unreadable, foreign, newer and damaged files with a clear message', () => {
    const game = createNewGame(2);
    const wrap = (over: Record<string, unknown>) => JSON.stringify({ format: SAVE_FILE_FORMAT, version: 1, exportedAt: '2026-09-30T10:00:00.000Z', state: game, ...over });
    const cases: [string, RegExp][] = [
      ['', /could not be read/],
      ['garbage', /could not be read/],
      ['\u0089PNG\r\n\u001a\n', /could not be read/],
      ['{"format": "starman-reborn-save", "version": 1, "state": {', /could not be read/],
      ['[1, 2, 3]', /not a Starman Reborn save/],
      ['"starman-reborn-save"', /not a Starman Reborn save/],
      [JSON.stringify({ name: 'another game', level: 3 }), /not a Starman Reborn save/],
      // A bare game without the file envelope is not a save file either.
      [JSON.stringify(game), /not a Starman Reborn save/],
      [wrap({ format: 'starman-save' }), /not a Starman Reborn save/],
      [wrap({ version: undefined }), /version is missing/],
      [wrap({ version: '1' }), /version is missing/],
      [wrap({ version: 2 }), /newer version of the game/],
      [wrap({ state: undefined }), /holds no game/],
      [wrap({ state: [game] }), /holds no game/],
      [wrap({ state: { ...game, version: 99 } }), /newer version of the game/],
      [wrap({ state: { ...game, credits: -5 } }), /damaged and cannot be loaded\. Save data is damaged: credits/],
      [wrap({ state: { ...game, location: { ...game.location, systemId: 'vega' } } }), /damaged.*unknown system/],
      [wrap({ state: { version: 6, discoveredBodies: 'none' } }), /damaged and cannot be loaded/],
      [wrap({ state: { ...game, version: 'eight' } }), /damaged and cannot be loaded/],
    ];
    for (const [text, message] of cases) {
      expect(() => parseSaveFile(text), text.slice(0, 60)).toThrow(SaveFileError);
      expect(() => parseSaveFile(text), text.slice(0, 60)).toThrow(message);
    }
    expect(() => parseSaveFile(' '.repeat(SAVE_FILE_MAX_BYTES + 1))).toThrow(/too large/);
  });

  it('import into a slot like any other game', async () => {
    const saves = new SaveManager(new IndexedDbBackend(new IDBFactory()));
    const game = gameInFlight(12);
    const imported = parseSaveFile(exportSaveFile(game).json);
    await saves.saveToSlot(3, imported, { keepSavedAt: true });
    const [, , third] = await saves.listSlots();
    expect(third!.summary).toEqual(summarize(game));
    expect(await saves.loadSlot(3)).toEqual(game);
  });
});
