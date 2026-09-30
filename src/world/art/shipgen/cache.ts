import type { ShipBlueprint } from './blueprint.ts';

/**
 * Blueprint cache, reference-counted per (model, quality): every ship of a model shares one set of
 * geometry. When the last ship of a model is disposed its blueprint stays around (idle) for quick
 * respawns; only the least recently released idle blueprints beyond MAX_IDLE are freed.
 */

interface Entry {
  blueprint: ShipBlueprint;
  refs: number;
}

const entries = new Map<string, Entry>();
/** Keys of unused blueprints, least recently released first. */
const idle: string[] = [];

export const MAX_IDLE_BLUEPRINTS = 8;

function dropIdle(key: string): void {
  const i = idle.indexOf(key);
  if (i >= 0) idle.splice(i, 1);
}

function evict(key: string): void {
  const e = entries.get(key);
  if (!e || e.refs > 0) return;
  entries.delete(key);
  for (const part of e.blueprint.parts) part.geometry.dispose();
}

export function acquireBlueprint(key: string, build: () => ShipBlueprint): ShipBlueprint {
  let e = entries.get(key);
  if (!e) {
    e = { blueprint: build(), refs: 0 };
    entries.set(key, e);
  }
  if (e.refs === 0) dropIdle(key);
  e.refs++;
  return e.blueprint;
}

export function releaseBlueprint(key: string): void {
  const e = entries.get(key);
  if (!e || e.refs <= 0) return;
  e.refs--;
  if (e.refs > 0) return;
  idle.push(key);
  while (idle.length > MAX_IDLE_BLUEPRINTS) evict(idle.shift()!);
}

/** Frees every cached model no ship is using (e.g. after leaving flight or changing quality). */
export function clearShipArtCache(): void {
  for (const key of idle.splice(0)) evict(key);
}

export interface ShipArtCacheStats {
  /** Cached models (in use or idle). */
  models: number;
  /** Models at least one live ship uses. */
  inUse: number;
  /** Live ships across all models. */
  ships: number;
}

export function shipArtCacheStats(): ShipArtCacheStats {
  let inUse = 0;
  let ships = 0;
  for (const e of entries.values()) {
    if (e.refs > 0) inUse++;
    ships += e.refs;
  }
  return { models: entries.size, inUse, ships };
}
