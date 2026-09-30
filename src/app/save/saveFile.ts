import { SAVE_VERSION, type GameState } from '../state.ts';
import { migrateSave, SaveFormatError } from './migrate.ts';

/**
 * Save files: a game exported to a JSON file the player keeps or moves to another device, and read
 * back by Import. The file wraps the GameState in a small versioned envelope; the game inside
 * carries its own save format version and is migrated on import like any stored save.
 */
export const SAVE_FILE_FORMAT = 'starman-reborn-save';

/** Version of the envelope (not of the game inside it). */
export const SAVE_FILE_VERSION = 1;

/** Larger files are refused unread: a save is a few tens of kilobytes. */
export const SAVE_FILE_MAX_BYTES = 5 * 1024 * 1024;

export interface SaveFile {
  format: typeof SAVE_FILE_FORMAT;
  version: typeof SAVE_FILE_VERSION;
  /** ISO time of the export. */
  exportedAt: string;
  state: GameState;
}

/** A file that cannot be imported. The message is written for the player. */
export class SaveFileError extends Error {}

/** `starman-save-2026-09-30.json` (the local date), or `starman-save-2026-09-30-slot-2.json` for a slot. */
export function saveFileName(now: Date, slot?: number): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `starman-save-${date}${slot ? `-slot-${slot}` : ''}.json`;
}

/** The export file for a game: its name and its JSON text. */
export function exportSaveFile(state: GameState, now = new Date(), slot?: number): { name: string; json: string } {
  const file: SaveFile = { format: SAVE_FILE_FORMAT, version: SAVE_FILE_VERSION, exportedAt: now.toISOString(), state };
  return { name: saveFileName(now, slot), json: JSON.stringify(file) };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const NEWER = 'This save file was made by a newer version of the game. Reload the page to update the game, then import it again.';

/**
 * Reads a save file back into a current, validated GameState (older games are migrated).
 * Throws SaveFileError, with a message for the player, for anything else.
 */
export function parseSaveFile(text: string): GameState {
  if (text.length > SAVE_FILE_MAX_BYTES) throw new SaveFileError('This file is too large to be a Starman Reborn save file.');
  let raw: unknown;
  try {
    // Some editors put a byte-order mark in front of the text.
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new SaveFileError('This file could not be read. Choose a save file exported from Starman Reborn (a .json file).');
  }
  if (!isRecord(raw) || raw.format !== SAVE_FILE_FORMAT) throw new SaveFileError('This file is not a Starman Reborn save file.');
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    throw new SaveFileError('This save file is damaged: its version is missing.');
  }
  if (raw.version > SAVE_FILE_VERSION) throw new SaveFileError(NEWER);
  const state = raw.state;
  if (!isRecord(state)) throw new SaveFileError('This save file is damaged: it holds no game.');
  if (typeof state.version === 'number' && state.version > SAVE_VERSION) throw new SaveFileError(NEWER);
  try {
    return migrateSave(state);
  } catch (err) {
    const detail = err instanceof SaveFormatError ? ` ${err.message}` : '';
    throw new SaveFileError(`This save file is damaged and cannot be loaded.${detail}`);
  }
}
