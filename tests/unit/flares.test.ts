import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { EVENTS } from '../../src/content/events/rules.ts';
import { FLARE_COMMS, FLARE_TARGET } from '../../src/content/stellar/flareLines.ts';
import { FLARE_STARS, FLARES, type FlareKind } from '../../src/content/stellar/flares.ts';
import { jumpsFrom } from '../../src/content/world/network.ts';
import { ALL_LOCATIONS, getComponent, getLocation, WORLD } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { boardEpoch, boardFor, postedContracts } from '../../src/economy/contracts.ts';
import { contractIssues, MAX_REWARD } from '../../src/economy/contractGuards.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import {
  flareAt,
  flareCard,
  flareComm,
  flareEffects,
  flareGlow,
  flareIn,
  flareNews,
  flaresBetween,
  flareStarsIn,
  flareStatus,
  flareSubtitle,
  flareSystems,
  flareWatchOffers,
  flareWatchReward,
  starFlareAt,
  type Flare,
} from '../../src/economy/flares.ts';
import { validateFlares, type FlareRules } from '../../src/economy/flareGuards.ts';
import { acceptJob, advanceJobs, describeObjective } from '../../src/economy/jobs.ts';
import { observationsWanted, recordObservation } from '../../src/economy/stellar.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Flare stars (docs/PROCGEN.md §43): the stars, real and named as SIMBAD names them; the rules and
 * their guardrails; the flares, drawn from the clock; what they do in their systems; the News, the
 * radio and the star map; flare watch at research stations; and the flight scene.
 */

afterEach(() => useWorldLog(null));

const WOLF = 'wolf-359' as SystemId;
const LEDGER = 'ledger-institute';
const research = ALL_LOCATIONS.filter((l) => l.stationType === 'research-station' && l.status === 'functional' && l.dockable !== false);

/** The first flares of a star (or of any star in a system) from a moment on, of a kind if named. */
function flaresOf(where: { star?: string; systemId?: SystemId }, from: number = FLARES.quietUntil, kind?: FlareKind, days = 20): Flare[] {
  return flaresBetween(from, from + days * 86_400).filter((f) => (!where.star || f.star === where.star) && (!where.systemId || f.systemId === where.systemId) && (!kind || f.kind === kind) && f.start >= from);
}

/** A pilot past the opening, docked at a station, its world log in use. */
function pilotAt(locationId: string, clock: number): GameState {
  const s = createNewGame(9);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 10_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

describe('the flare stars', () => {
  it('are ten real red dwarfs of the archives, in systems on the map, once each', () => {
    expect(FLARE_STARS).toHaveLength(10);
    for (const s of FLARE_STARS) {
      const c = getComponent(s.star)!;
      expect(c, s.star).toBeDefined();
      expect(c.spectralType).toMatch(/^d?M/);
    }
    expect(new Set(FLARE_STARS.map((s) => s.star)).size).toBe(10);
    expect(flareStarsIn('luyten-726-8' as SystemId).map((s) => s.star).sort()).toEqual(['bl-ceti', 'uv-ceti']);
    expect(flareSystems()).toHaveLength(9);
  });

  it('carry the variable-star names SIMBAD gives them in the sky snapshot, each found through its Gaia DR3 source', () => {
    const root = 'data/snapshot/raw';
    const date = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1)!;
    const idents = new Map<number, string[]>();
    for (const f of readdirSync(`${root}/${date}`).filter((x) => /^simbad-idents-\d+\.json$/.test(x))) {
      const rows = (JSON.parse(readFileSync(`${root}/${date}/${f}`, 'utf8')) as { data: [number, string][] }).data;
      for (const [oid, id] of rows) (idents.get(oid) ?? idents.set(oid, []).get(oid)!).push(id);
    }
    const normal = (x: string) => x.replace(/\s+/g, ' ').trim();
    for (const s of FLARE_STARS) {
      const gaia = getComponent(s.star)!.catalogIds.gaiaDr3!;
      const record = [...idents.values()].find((ids) => ids.some((i) => normal(i) === gaia));
      expect(record, `${s.star}: no SIMBAD record with ${gaia}`).toBeDefined();
      expect(record!.map(normal), s.star).toContain(`V* ${s.variable}`);
    }
  });
});

describe('the rules', () => {
  it('pass their guardrails', () => {
    expect(validateFlares()).toEqual([]);
  });

  it('catch broken ones: shares that do not add up, a weaker flare harder on ships, a window shorter than a flare, pay above the ceiling, a star that is not a red dwarf, a line with a number', () => {
    const broken = (change: (r: FlareRules) => void) => {
      const r = structuredClone(FLARES) as FlareRules;
      change(r);
      return validateFlares(r).map((i) => i.rule);
    };
    const w = <T>(x: T) => x as { -readonly [K in keyof T]: T[K] extends number ? number : T[K] };
    expect(broken((r) => (w(r.kinds.flare).share = 0.9))).toContain('kinds');
    expect(broken((r) => (w(r.kinds.superflare).shields = 0.9))).toContain('kinds');
    expect(broken((r) => (w(r.kinds.strong).scanner = 1.4))).toContain('kinds');
    expect(broken((r) => (w(r).window = 1_800))).toContain('window');
    expect(broken((r) => (w(r).odds = 1))).toContain('window');
    expect(broken((r) => (w(r.watch.reward).superflare = MAX_REWARD))).toContain('watch');
    expect(broken((r) => (w(r.watch.reward).strong = 600))).toContain('watch');
    expect(validateFlares(FLARES, [...FLARE_STARS, { star: 'sirius-a', variable: 'XX Cma' }]).map((i) => i.rule)).toContain('stars');
    expect(validateFlares(FLARES, [...FLARE_STARS, { star: 'wolf-359', variable: 'CN Leo' }]).map((i) => i.rule)).toContain('stars');
    expect(validateFlares(FLARES, [{ star: 'barnards-star', variable: 'Barnard flare' }]).map((i) => i.rule)).toContain('stars');
    const comms = FLARE_COMMS as { start: string };
    const was = comms.start;
    try {
      comms.start = 'A flare for 20 minutes, {star}.';
      expect(validateFlares().map((i) => i.rule)).toContain('lines');
      comms.start = 'A flare on {planet}.';
      expect(validateFlares().map((i) => i.rule)).toContain('lines');
    } finally {
      comms.start = was;
    }
  });
});

describe('the flares', () => {
  it('are the same for every save at the same clock, at most one a window, on whole minutes, none in the first hour', () => {
    const counts: Record<FlareKind, number> = { flare: 0, strong: 0, superflare: 0 };
    let windows = 0;
    let flares = 0;
    for (const s of FLARE_STARS) {
      for (let w = 0; w < 400; w++) {
        windows++;
        const f = flareIn(s.star, w);
        expect(flareIn(s.star, w)).toEqual(f);
        if (!f) continue;
        flares++;
        counts[f.kind]++;
        expect(f.start).toBeGreaterThanOrEqual(FLARES.quietUntil);
        expect(f.start % 60).toBe(0);
        expect(f.end % 60).toBe(0);
        const [lo, hi] = FLARES.kinds[f.kind].lasts;
        expect(f.end - f.start).toBeGreaterThanOrEqual(lo - 30);
        expect(f.end - f.start).toBeLessThanOrEqual(hi + 30);
        // Inside its window, so never two at once on one star.
        const next = flareIn(s.star, w + 1);
        if (next) expect(next.start).toBeGreaterThanOrEqual(f.end);
        expect(f.systemId).toBe(getComponent(s.star)!.systemId);
      }
    }
    // About one window in two holds a flare; strong ones rarer, superflares rarer still.
    expect(flares / windows).toBeGreaterThan(FLARES.odds - 0.06);
    expect(flares / windows).toBeLessThan(FLARES.odds + 0.06);
    expect(counts.flare).toBeGreaterThan(counts.strong);
    expect(counts.strong).toBeGreaterThan(counts.superflare);
    expect(counts.superflare).toBeGreaterThan(0);
    expect(flaresBetween(0, FLARES.quietUntil)).toEqual([]);
  });

  it('work only in their own system while they last, and Luyten 726-8 takes the stronger of its two stars', () => {
    const f = flaresOf({ star: 'wolf-359' })[0]!;
    const mid = (f.start + f.end) / 2;
    const k = FLARES.kinds[f.kind];
    expect(flareAt(WOLF, mid)?.id).toBe(f.id);
    expect(flareEffects(WOLF, mid)).toEqual({ shields: k.shields, scanner: k.scanner });
    expect(flareEffects(WOLF, f.end)).toEqual({ shields: 1, scanner: 1 });
    expect(flareEffects(WOLF, f.start - 1)).toEqual({ shields: 1, scanner: 1 });
    expect(flareEffects('sol' as SystemId, mid)).toEqual({ shields: 1, scanner: 1 });
    // Its glow: up over the first minute, highest at the end of the rise, nothing at its end.
    expect(flareGlow(f, f.start)).toBe(0);
    expect(flareGlow(f, f.start + FLARES.rise)).toBeCloseTo(k.glow);
    expect(flareGlow(f, mid)).toBeGreaterThan(0);
    expect(flareGlow(f, mid)).toBeLessThan(k.glow);
    expect(flareGlow(f, f.end)).toBe(0);
    // Two stars in one system: when both flare, the stronger one rules.
    const luyten = 'luyten-726-8' as SystemId;
    const both = flaresOf({ star: 'bl-ceti' }, FLARES.quietUntil, undefined, 200).flatMap((a) => {
      const b = flaresOf({ star: 'uv-ceti' }, a.start - 3_600, undefined, 1).find((x) => x.start < a.end && x.end > a.start && x.kind !== a.kind);
      return b ? [[a, b] as const] : [];
    });
    expect(both.length).toBeGreaterThan(0);
    const [a, b] = both[0]!;
    const t = Math.max(a.start, b.start) + 1;
    const strongest = ['flare', 'strong', 'superflare'].indexOf(a.kind) > ['flare', 'strong', 'superflare'].indexOf(b.kind) ? a : b;
    expect(flareAt(luyten, t)?.id).toBe(strongest.id);
    expect(starFlareAt(a.star, t)?.id).toBe(a.id);
  });
});

describe('what the world says', () => {
  it('the News within two jumps tells each flare while it lasts and half an hour after, marked as fiction about a real star', () => {
    const f = flaresOf({ star: 'wolf-359' })[0]!;
    const mid = f.start + 120;
    const here = flareNews(WOLF, mid).find((n) => n.flare.id === f.id)!;
    expect(here.active).toBe(true);
    expect(here.jumps).toBe(0);
    expect(here.headline).toMatch(/on Wolf 359$/);
    expect(here.detail).toContain(`${Math.round(FLARES.kinds[f.kind].shields * 100)}%`);
    expect(here.fiction).toBe('Fiction: when Wolf 359 flares, and what it does to ships, is the game’s. Wolf 359 is a real flare star, the variable star CN Leo.');
    const jumps = jumpsFrom(WORLD.links, WOLF);
    const near = [...jumps].find(([, j]) => j === EVENTS.newsJumps)![0];
    const far = [...jumps].find(([, j]) => j > EVENTS.newsJumps)![0];
    expect(flareNews(near, mid).some((n) => n.flare.id === f.id)).toBe(true);
    expect(flareNews(far, mid).some((n) => n.flare.id === f.id)).toBe(false);
    // Over: said so for half an hour, then gone.
    const over = flareNews(WOLF, f.end + 60).find((n) => n.flare.id === f.id)!;
    expect(over.active).toBe(false);
    expect(over.detail).toContain('back to normal');
    expect(flareNews(WOLF, f.end + EVENTS.newsRecent + 60).some((n) => n.flare.id === f.id)).toBe(false);
    expect(flareNews(WOLF, f.start - 60).some((n) => n.flare.id === f.id)).toBe(false);
    for (const n of flareNews(WOLF, mid)) expect(`${n.headline} ${n.detail} ${n.fiction}`).not.toMatch(/[{}]/);
  });

  it('the radio, the star map, the target and the science card say how things stand, every number from the rules', () => {
    const f = flaresOf({ star: 'proxima-centauri' }, FLARES.quietUntil, 'strong')[0]!;
    const t = f.start + 300;
    const ac = 'alpha-centauri' as SystemId;
    expect(flareComm('start', f, f.start).text).toBe(`Strong flare on Proxima Centauri. Shields recharge at 45% and scanners reach 60% for about ${Math.round((f.end - f.start) / 60)} minutes.`);
    expect(flareComm('end', f, f.end).text).toBe('Proxima Centauri has settled. Shields and scanners are back to normal.');
    expect(flareStatus(ac, t)).toEqual(['Flare star: Proxima Centauri (V645 Cen)', `Strong flare under way, about ${Math.round((f.end - t) / 60)} min to go`]);
    expect(flareStatus(ac, f.end)).toEqual(['Flare star: Proxima Centauri (V645 Cen)', 'Quiet now']);
    expect(flareStatus('sol' as SystemId, t)).toBeNull();
    expect(flareSubtitle('proxima-centauri', t)).toBe(FLARE_TARGET.flaring);
    expect(flareSubtitle('proxima-centauri', f.end)).toBe(FLARE_TARGET.quiet);
    expect(flareCard('proxima-centauri', t)).toHaveLength(2);
    expect(flareCard('proxima-centauri', t)[0]).toContain('the variable star V645 Cen');
    expect(flareCard('proxima-centauri', f.end)).toHaveLength(1);
    expect(flareCard('alpha-centauri-a', t)).toEqual([]);
  });
});

describe('flare watch', () => {
  it('is posted by research stations within reach while a flare lasts, passes the contract guardrails, and pays for a reading taken there, in time', () => {
    const f = flaresOf({ star: 'wolf-359' })[0]!;
    const s = pilotAt(LEDGER, f.start + 30);
    const board = boardFor(LEDGER, boardEpoch(s.clock));
    const watch = board.find((c) => c.contract?.flare === f.id)!;
    expect(watch).toBeDefined();
    expect(watch.title).toBe('Flare watch: Wolf 359');
    expect(watch.reward).toBe(flareWatchReward(f.kind, 0));
    expect(contractIssues(watch, s.clock)).toEqual([]);
    expect(postedContracts(s, LEDGER).some((c) => c.id === watch.id)).toBe(true);
    // Not before the flare, nor after it.
    const before = pilotAt(LEDGER, f.start - 60);
    expect(postedContracts(before, LEDGER).some((c) => c.contract?.flare === f.id)).toBe(false);
    const after = pilotAt(LEDGER, f.end);
    expect(postedContracts(after, LEDGER).some((c) => c.contract?.flare === f.id)).toBe(false);
    useWorldLog(s.world);
    // Only research stations, and only within reach.
    expect(flareWatchOffers('ledger-institute', f.start, f.end).some((o) => o.flare.id === f.id)).toBe(true);
    const port = ALL_LOCATIONS.find((l) => l.systemId === WOLF && l.stationType !== 'research-station' && l.services.includes('contracts'));
    if (port) expect(flareWatchOffers(port.id, f.start, f.end)).toEqual([]);
    const jumps = jumpsFrom(WORLD.links, WOLF);
    const distant = research.find((l) => (jumps.get(l.systemId) ?? 99) > FLARES.watch.reach)!;
    expect(flareWatchOffers(distant.id, f.start, f.end).some((o) => o.flare.id === f.id)).toBe(false);

    expect(acceptJob(s, watch.id).ok).toBe(true);
    s.location = { ...s.location, dockedAt: null };
    expect(describeObjective(s, watch.id)).toMatchObject({ targetSystemId: WOLF, targetId: 'star:wolf-359' });
    // A reading from another system counts for nothing; from its own, while it flares, it does.
    expect(observationsWanted(s, 'wolf-359')).toEqual([watch.id]);
    recordObservation(s, 'wolf-359', 'sol' as SystemId);
    expect(advanceJobs(s, { dockedAt: null, systemId: 'sol' as SystemId })).toEqual([]);
    recordObservation(s, 'wolf-359', WOLF);
    expect(advanceJobs(s, { dockedAt: null, systemId: WOLF }).map((e) => e.kind)).toEqual(['objective']);
    const credits = s.credits;
    expect(dockAt(s, LEDGER).jobEvents.some((e) => e.kind === 'complete')).toBe(true);
    expect(s.credits - credits).toBe(watch.reward);
    assertValidState(s);
  });

  it('is not offered twice for one flare, and a reading after the flare counts for nothing', () => {
    const f = flaresOf({ star: 'wolf-359' }).find((x) => Math.floor(x.start / CONTRACTS.epochSeconds) !== Math.floor((x.end - 1) / CONTRACTS.epochSeconds))!;
    expect(f).toBeDefined();
    const s = pilotAt(LEDGER, f.start + 10);
    const first = postedContracts(s, LEDGER).find((c) => c.contract?.flare === f.id)!;
    expect(acceptJob(s, first.id).ok).toBe(true);
    s.clock = (Math.floor(f.start / CONTRACTS.epochSeconds) + 1) * CONTRACTS.epochSeconds + 5;
    expect(s.clock).toBeLessThan(f.end);
    // The next time slot's copy of it is on the board, but not offered to a pilot who holds one.
    expect(boardFor(LEDGER, boardEpoch(s.clock)).some((c) => c.contract?.flare === f.id && c.id !== first.id)).toBe(true);
    expect(postedContracts(s, LEDGER).some((c) => c.contract?.flare === f.id)).toBe(false);
    expect(postedContracts(pilotAt(LEDGER, s.clock), LEDGER).some((c) => c.contract?.flare === f.id)).toBe(true);
    useWorldLog(s.world);
    s.clock = f.end + 10;
    s.location = { ...s.location, dockedAt: null, systemId: WOLF };
    expect(observationsWanted(s, 'wolf-359')).toEqual([]);
    recordObservation(s, 'wolf-359', WOLF);
    expect(advanceJobs(s, { dockedAt: null, systemId: WOLF })).toEqual([]);
  });

  it('is posted for most flare stars, and every one on the boards passes the contract guardrails', () => {
    const watched = new Set<string>();
    for (const l of research) {
      for (let epoch = Math.ceil(FLARES.quietUntil / CONTRACTS.epochSeconds); epoch < 120; epoch++) {
        for (const c of boardFor(l.id, epoch).filter((x) => x.contract?.flare)) {
          expect(contractIssues(c, epoch * CONTRACTS.epochSeconds), c.id).toEqual([]);
          watched.add(c.objectives[0]!.kind === 'observe' ? (c.objectives[0] as { star: string }).star : '');
        }
      }
    }
    expect(watched.size).toBeGreaterThanOrEqual(FLARE_STARS.length / 2);
    for (const star of ['ad-leonis', 'ross-154', 'yz-canis-minoris']) expect(watched.has(star)).toBe(false);
  });
});

// ---------------------------------------------------------------- in flight

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }) };
}

describe('in flight', () => {
  beforeAll(installCanvasStub);

  it('cuts shields and scanners while a flare lasts, makes its star glow and say so, tells the radio and the HUD, and lets go after', () => {
    const f = flaresOf({ star: 'wolf-359' }, FLARES.quietUntil, 'strong')[0]!;
    const s = pilotAt(LEDGER, f.start + 120);
    s.location = { ...s.location, dockedAt: null };
    const comms: string[] = [];
    const nothing = () => {};
    const flight = new FlightSession({
      system: new SystemScene(sceneDefFor(WOLF), { quality: 'low', reducedMotion: true }),
      camera: new THREE.PerspectiveCamera(),
      state: s,
      settings: defaultSettings(),
      ctx: { quality: 'low', reducedMotion: true },
      audio: { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine,
      callbacks: {
        onDocked: nothing,
        onPlayerDestroyed: nothing,
        onDiscovery: nothing,
        onScanInfo: nothing,
        onEncounterStart: nothing,
        onEncounterEnd: nothing,
        onLoot: nothing,
        onBounty: nothing,
        onContractKill: nothing,
        onMessage: nothing,
        onComm: (speaker, text) => comms.push(`${speaker}: ${text}`),
      },
      traffic: { plan: { traders: 0, patrolWings: 0, wingSize: 2, packs: null }, owner: null },
    });
    flight.start({ kind: 'arrival' });
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 20) {
        s.clock += 1 / 20;
        flight.update(1 / 20, emptyInput());
      }
    };
    run(1);
    const k = FLARES.kinds.strong;
    expect(flight.debugFlare()).toMatchObject({ id: f.id, kind: 'strong', shields: k.shields, scanner: k.scanner, subtitle: FLARE_TARGET.flaring });
    expect(flight.debugFlare()!.glow).toBeGreaterThan(0);
    // Found under way on arriving: the radio says so, and the HUD shows it.
    expect(comms).toHaveLength(1);
    expect(comms[0]).toMatch(/^Flare watch: Wolf 359 is flaring: shields recharge at 45% and scanners reach 60%/);
    expect(flight.hud.flare).toMatch(/^Strong flare on Wolf 359 · shields 45% · scanners 60% · \d+ min to go$/);
    // Shields come back at the flare's share of their rate.
    const regen = () => {
      flight.debugHurt(30);
      run(6);
      const a = flight.hud.shieldValue;
      run(1);
      return flight.hud.shieldValue - a;
    };
    const slow = regen();
    // After it: the radio says it has settled, the star is quiet, and shields recharge at full rate.
    s.clock = f.end + 1;
    run(1);
    expect(flight.debugFlare()).toBeNull();
    expect(comms.at(-1)).toBe('Flare watch: Wolf 359 has settled. Shields and scanners are back to normal.');
    expect(flight.hud.flare).toBeNull();
    expect(flight.allTargets().find((t) => t.id === 'star:wolf-359')!.subtitle).toBe(FLARE_TARGET.quiet);
    const full = regen();
    expect(slow / full).toBeCloseTo(k.shields, 1);
    flight.dispose();
  });
});
