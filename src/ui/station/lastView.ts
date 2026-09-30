import type { RoomView } from '../../world/rooms/types.ts';
import type { StationWindow } from './StationHub.ts';

/**
 * The room and window last open at each station, so docking there again picks up where the
 * player left off. A per-device convenience kept in local storage, never in the save.
 */

const KEY = 'starman.lastView';
const REMEMBERED: readonly (StationWindow | null)[] = ['trader', 'outfitter', 'shipyard', 'fleet', 'jobs', 'people', 'news', 'computer', null];

type Views = Record<string, { room: RoomView; window: StationWindow | null }>;

function read(): Views {
  try {
    const raw = localStorage.getItem(KEY);
    const views = raw ? (JSON.parse(raw) as unknown) : {};
    return views && typeof views === 'object' ? (views as Views) : {};
  } catch {
    return {};
  }
}

export function rememberView(locationId: string, room: RoomView, window: StationWindow | null): void {
  if (!REMEMBERED.includes(window)) return;
  try {
    const views = read();
    views[locationId] = { room, window };
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    // Storage unavailable: nothing is remembered.
  }
}

export function lastView(locationId: string): { room: RoomView; window: StationWindow | null } | null {
  const v = read()[locationId];
  return v && typeof v.room === 'string' && REMEMBERED.includes(v.window) ? v : null;
}
