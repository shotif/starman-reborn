import { EVENTS } from '../content/events/rules.ts';
import { hashString, rng } from '../content/random.ts';
import { FLARE_CARD, FLARE_COMMS, FLARE_FICTION, FLARE_HUD, FLARE_MAP, FLARE_NEWS, FLARE_SPEAKER, FLARE_TARGET, FLARE_WORD } from '../content/stellar/flareLines.ts';
import { FLARE_STARS, FLARES, type FlareKind, type FlareStar } from '../content/stellar/flares.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { getComponent, getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { StellarComponent, SystemId } from '../data/types.ts';

/**
 * Flare stars (docs/PROCGEN.md §43). Ten real red dwarfs flare now and then; while one does, its
 * system is harder to fly in. Like the world's events (§11) the flares are a pure function of the
 * world seed and the clock: each star has one window after another, each holding at most one flare
 * drawn from its own random stream. Nothing runs in the background and nothing needs saving. That the
 * stars flare is real; when, how strongly and what it does to ships is the game's fiction.
 */

export interface Flare {
  /** `f.<star>.<window>`. */
  id: string;
  /** The star's id in the archives. */
  star: string;
  systemId: SystemId;
  kind: FlareKind;
  /** Game-clock seconds, whole minutes. */
  start: number;
  end: number;
}

const BY_STAR = new Map<string, FlareStar>(FLARE_STARS.map((s) => [s.star, s]));

/** A flare star by its star's id, or undefined. */
export function flareStar(id: string): FlareStar | undefined {
  return BY_STAR.get(id);
}

/** The flare stars of a system (Luyten 726-8 has two). */
export function flareStarsIn(systemId: SystemId): FlareStar[] {
  return FLARE_STARS.filter((s) => getComponent(s.star)?.systemId === systemId);
}

/** The systems with flare stars. */
export function flareSystems(): SystemId[] {
  return [...new Set(FLARE_STARS.flatMap((s) => getComponent(s.star)?.systemId ?? []))];
}

const component = (star: string): StellarComponent => getComponent(star)!;

// ---------------------------------------------------------------- one window

/** Each star's windows are shifted by its own phase, so neighbours never keep time with each other. */
export function flarePhase(star: string): number {
  return (hashString(`flares|${star}`) % (FLARES.window / 60)) * 60;
}

function windowOf(star: string, clock: number): number {
  return Math.floor((clock + flarePhase(star)) / FLARES.window);
}

const STRENGTH: Record<FlareKind, number> = { flare: 0, strong: 1, superflare: 2 };
const KINDS = Object.keys(FLARES.kinds) as FlareKind[];

const cache = new Map<string, Flare | null>();

/** The flare in a star's window, if any. */
export function flareIn(star: string, index: number): Flare | null {
  const key = `${star}|${index}`;
  if (cache.has(key)) return cache.get(key)!;
  let f: Flare | null = null;
  const c = getComponent(star);
  if (c && BY_STAR.has(star)) {
    const r = rng(WORLD_SEED, 'flares', star, index);
    if (r.next() < FLARES.odds) {
      let x = r.next();
      let kind: FlareKind = KINDS[KINDS.length - 1]!;
      for (const k of KINDS) {
        if (x < FLARES.kinds[k].share) {
          kind = k;
          break;
        }
        x -= FLARES.kinds[k].share;
      }
      const [lo, hi] = FLARES.kinds[kind].lasts;
      const length = Math.round(r.range(lo, hi) / 60) * 60;
      const start = index * FLARES.window - flarePhase(star) + Math.round(r.range(0, FLARES.window - length) / 60) * 60;
      if (start >= FLARES.quietUntil) f = { id: `f.${star}.${index}`, star, systemId: c.systemId, kind, start, end: start + length };
    }
  }
  if (cache.size > 4_000) cache.clear();
  cache.set(key, f);
  return f;
}

// ---------------------------------------------------------------- queries

/** The flare under way on a star at a moment, if any. */
export function starFlareAt(star: string, clock: number): Flare | null {
  const f = flareIn(star, windowOf(star, clock));
  return f && clock >= f.start && clock < f.end ? f : null;
}

/** The flare under way in a system at a moment: the strongest, should two of its stars flare at once. */
export function flareAt(systemId: SystemId, clock: number): Flare | null {
  let best: Flare | null = null;
  for (const s of flareStarsIn(systemId)) {
    const f = starFlareAt(s.star, clock);
    if (f && (!best || STRENGTH[f.kind] > STRENGTH[best.kind] || (f.kind === best.kind && f.end > best.end))) best = f;
  }
  return best;
}

/** Flares on any flare star whose times overlap `from`–`to`, oldest first. */
export function flaresBetween(from: number, to: number): Flare[] {
  const out: Flare[] = [];
  for (const s of FLARE_STARS) {
    const last = windowOf(s.star, to);
    for (let w = windowOf(s.star, from); w <= last; w++) {
      const f = flareIn(s.star, w);
      if (f && f.start <= to && f.end > from) out.push(f);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.star.localeCompare(b.star));
}

const NONE = { shields: 1, scanner: 1 } as const;

/** What a flare under way does in a system now: the share of their rate shields recharge at, and of their reach scanners keep (1 and 1 without one). */
export function flareEffects(systemId: SystemId, clock: number): { shields: number; scanner: number } {
  const f = flareAt(systemId, clock);
  if (!f) return NONE;
  const k = FLARES.kinds[f.kind];
  return { shields: k.shields, scanner: k.scanner };
}

/** How much a flaring star has brightened (0 to its kind's glow): up over the rise, then fading to nothing at its end. */
export function flareGlow(f: Flare | null, clock: number): number {
  if (!f || clock < f.start || clock >= f.end) return 0;
  const t = clock - f.start;
  const rise = Math.min(FLARES.rise, f.end - f.start);
  const k = t < rise ? t / rise : (1 - (t - rise) / Math.max(1, f.end - f.start - rise)) ** 1.6;
  return FLARES.kinds[f.kind].glow * Math.min(1, Math.max(0, k));
}

/** How a star's flaring brightens it now (0 when it is not a flare star or not flaring). */
export function starGlow(star: string, clock: number): number {
  return BY_STAR.has(star) ? flareGlow(starFlareAt(star, clock), clock) : 0;
}

// ---------------------------------------------------------------- what is said

const percent = (x: number) => String(Math.round(x * 100));
const minutesLeft = (f: Flare, clock: number) => String(Math.max(1, Math.round((f.end - clock) / 60)));

/** Fills a line about a flare star (`{star}`, `{variable}`, `{system}`). */
export function fillFlareStar(text: string, star: string): string {
  const c = component(star);
  const values: Record<string, string> = { star: c.name, variable: BY_STAR.get(star)?.variable ?? '', system: getSystem(c.systemId).displayName };
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

/** Fills a line about a flare, at a moment (every number from the rules and the clock). */
export function fillFlare(text: string, f: Flare, clock: number, giver = ''): string {
  const k = FLARES.kinds[f.kind];
  const values: Record<string, string> = {
    Kind: FLARE_WORD[f.kind],
    kind: FLARE_WORD[f.kind].toLowerCase(),
    shields: percent(k.shields),
    scanner: percent(k.scanner),
    minutes: minutesLeft(f, clock),
    giver,
  };
  return fillFlareStar(text.replace(/\{(Kind|kind|shields|scanner|minutes|giver)\}/g, (_, key: string) => values[key] ?? ''), f.star);
}

export interface FlareNews {
  flare: Flare;
  jumps: number;
  active: boolean;
  headline: string;
  detail: string;
  fiction: string;
}

const jumpCache = new Map<SystemId, Map<SystemId, number>>();
function jumpsOf(systemId: SystemId): Map<SystemId, number> {
  let j = jumpCache.get(systemId);
  if (!j) jumpCache.set(systemId, (j = jumpsFrom(WORLD.links, systemId)));
  return j;
}

/** The News of flares within reach of a system (`EVENTS.newsJumps`): under way, or over within `EVENTS.newsRecent`; under way first, then nearest, then newest. */
export function flareNews(systemId: SystemId, clock: number): FlareNews[] {
  const jumps = jumpsOf(systemId);
  return flaresBetween(clock - EVENTS.newsRecent, clock)
    .filter((f) => f.start <= clock)
    .map((f) => {
      const active = clock < f.end;
      return {
        flare: f,
        jumps: jumps.get(f.systemId) ?? 99,
        active,
        headline: fillFlare(FLARE_NEWS.headline, f, clock),
        detail: fillFlare(active ? FLARE_NEWS.detail : FLARE_NEWS.over, f, clock),
        fiction: fillFlareStar(FLARE_FICTION, f.star),
      };
    })
    .filter((n) => n.jumps <= EVENTS.newsJumps)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.jumps - b.jumps || b.flare.start - a.flare.start);
}

/** What the radio says of a flare in the pilot's system: when it starts, when the pilot finds one under way, when it ends. */
export function flareComm(moment: keyof typeof FLARE_COMMS, f: Flare, clock: number): { speaker: string; text: string } {
  return { speaker: FLARE_SPEAKER, text: fillFlare(FLARE_COMMS[moment], f, clock) };
}

/** The HUD's line on a flare under way in a system, or null. */
export function flareHud(systemId: SystemId, clock: number): string | null {
  const f = flareAt(systemId, clock);
  return f ? fillFlare(FLARE_HUD, f, clock) : null;
}

/** A flare star's target subtitle in flight. */
export function flareSubtitle(star: string, clock: number): string {
  return starFlareAt(star, clock) ? FLARE_TARGET.flaring : FLARE_TARGET.quiet;
}

/** The star map's lines on a system's flare stars, or null for a system without one (§43.4). */
export function flareStatus(systemId: SystemId, clock: number): string[] | null {
  const stars = flareStarsIn(systemId);
  if (!stars.length) return null;
  const f = flareAt(systemId, clock);
  return [...stars.map((s) => fillFlareStar(FLARE_MAP.star, s.star)), f ? fillFlare(FLARE_MAP.flaring, f, clock) : FLARE_MAP.quiet];
}

/** The science card's lines on a flare star (none for any other star). */
export function flareCard(star: string, clock: number): string[] {
  if (!BY_STAR.has(star)) return [];
  const f = starFlareAt(star, clock);
  return [fillFlareStar(FLARE_CARD.what, star), ...(f ? [fillFlare(FLARE_CARD.flaring, f, clock)] : [])];
}

// ---------------------------------------------------------------- flare watch

export interface FlareWatchOffer {
  flare: Flare;
  /** Jumps from the station to the flaring star. */
  jumps: number;
}

/** The flare watch a station posts between two moments (§43.5): research stations, for flares within reach. */
export function flareWatchOffers(locationId: string, start: number, end: number): FlareWatchOffer[] {
  const loc = getLocation(locationId);
  if (loc.stationType !== 'research-station' || loc.status !== 'functional' || loc.dockable === false) return [];
  const jumps = jumpsOf(loc.systemId);
  return flaresBetween(start, end)
    .filter((f) => f.start < end && f.end > start)
    .map((flare) => ({ flare, jumps: jumps.get(flare.systemId) ?? Infinity }))
    .filter((o) => o.jumps <= FLARES.watch.reach);
}

/** What flare watch pays for a flare so many jumps off. */
export function flareWatchReward(kind: FlareKind, jumps: number): number {
  return FLARES.watch.reward[kind] + FLARES.watch.perJump * jumps;
}
