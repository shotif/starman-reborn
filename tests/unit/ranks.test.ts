import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { gearForSale, resaleValue, shipsForSale } from '../../src/content/catalog.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { RANK_LINES } from '../../src/content/ranks/lines.ts';
import { RANKS, type RankRules } from '../../src/content/ranks/rules.ts';
import { ROSTER } from '../../src/content/rivals/rules.ts';
import { ALL_LOCATIONS, getLocation } from '../../src/data/systems.ts';
import type { FactionId } from '../../src/data/types.ts';
import { boardFor, contractBlock, followUpFor, postedContract } from '../../src/economy/contracts.ts';
import { buyGear, buyShip, gearOffers, shipOffers } from '../../src/economy/equipment.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { buyAndKeep, keepOffer } from '../../src/economy/fleet.ts';
import { jobLockReason, type JobDef } from '../../src/economy/jobs.ts';
import { shipSlots } from '../../src/economy/loadout.ts';
import { validateRanks } from '../../src/economy/rankGuards.ts';
import {
  activeLimit,
  coveredAt,
  earnedRank,
  heldRank,
  keptRank,
  outpostOdds,
  perkRank,
  perksOf,
  rankGreeting,
  rankNews,
  settleRanks,
  yardDiscount,
} from '../../src/economy/ranks.ts';
import { claimFor } from '../../src/economy/rivals.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { RAIDERS } from '../../src/world/traffic/plan.ts';

/**
 * Ranks that open doors (docs/PROCGEN.md §32): the rules' guardrails, the ladders, promotions and
 * falls, discounts at the yards, commissions, the sixth contract, the Wake's outpost, the News, the
 * save, and a ranked pilot cleared in under fire in a real flight.
 */

afterEach(() => useWorldLog(null));

const open = (l: (typeof ALL_LOCATIONS)[number]) => l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den';
/** A lawful faction's own open station, with a yard, outside Sol. */
const yardOf = (f: FactionId) => ALL_LOCATIONS.find((l) => l.factionId === f && open(l) && l.systemId !== 'sol' && shipsForSale(l.id).length > 0 && gearForSale(l.id).length > 0)!;
const STA = yardOf('sta');
const FRONTIER = yardOf('frontier');
const DEN = ALL_LOCATIONS.find((l) => l.stationType === 'pirate-den' && l.status === 'functional')!;
const INDEPENDENT = ALL_LOCATIONS.find((l) => !l.factionId && open(l))!;

/** A pilot past the opening, docked nowhere yet, with credits and the record and standing asked for. */
function pilot(record: { kills?: number; rewards?: number; visited?: number } = {}, rep: Partial<Record<FactionId, number>> = {}): GameState {
  const s = createNewGame(5);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 500_000;
  s.clock = 10_000;
  s.stats.kills = record.kills ?? 0;
  s.stats.rewards = record.rewards ?? 0;
  for (const [f, v] of Object.entries(rep)) s.reputation[f as FactionId] = v;
  useWorldLog(s.world);
  return s;
}

/** Docks there (the whole docking, ranks settled last). */
function dock(s: GameState, locationId: string) {
  s.location = { ...s.location, systemId: getLocation(locationId).systemId, dockedAt: null };
  return dockAt(s, locationId);
}

describe('the rules', () => {
  it('pass their guardrails over the world’s boards and yards', { timeout: 120_000 }, () => {
    expect(validateRanks()).toEqual([]);
  });

  it('catch broken rules and names', () => {
    const broken = (patch: (r: { -readonly [K in keyof RankRules]: any }) => void) => {
      const r = structuredClone(RANKS) as unknown as { -readonly [K in keyof RankRules]: any };
      patch(r);
      return validateRanks(r as unknown as RankRules).map((i) => `${i.rule}:${i.subject}`);
    };
    expect(broken((r) => (r.perks.yard = [0.1, 0.2, 0.3]))).toContain('balance:yard');
    expect(broken((r) => (r.ladders.sta.standing = [40, 30, 70]))).toContain('rules:sta');
    expect(broken((r) => (r.ladders['hollow-wake'].standing = [12, 45, 75]))).toContain('rules:hollow-wake');
    expect(broken((r) => (r.ladders.sta.names = ['Merchant', 'Lane Officer', 'Lightkeeper']))).toContain('names:Merchant');
    expect(broken((r) => (r.work.kinds.sta = ['smuggle']))).toContain('rules:sta');
    expect(broken((r) => (r.keepMargin = 30))).toContain('rules:frontier');
  });
});

describe('the ladders', () => {
  it('need both the standing and a record in either of two ratings, exactly', () => {
    // The Authority: standing 15 and a Dealer trade or Blooded combat record.
    expect(earnedRank(pilot({ kills: 3 }, { sta: 15 }), 'sta')).toBe(1);
    expect(earnedRank(pilot({ rewards: 2_000 }, { sta: 15 }), 'sta')).toBe(1);
    expect(earnedRank(pilot({ kills: 2 }, { sta: 15 }), 'sta')).toBe(0);
    expect(earnedRank(pilot({ kills: 3 }, { sta: 14 }), 'sta')).toBe(0);
    // Standing for the top, but only the record for the first.
    expect(earnedRank(pilot({ kills: 3 }, { sta: 80 }), 'sta')).toBe(1);
    expect(earnedRank(pilot({ kills: 25 }, { sta: 40 }), 'sta')).toBe(2);
    expect(earnedRank(pilot({ kills: 50 }, { sta: 70 }), 'sta')).toBe(3);
    // The Wake counts combat or trade.
    expect(earnedRank(pilot({ rewards: 2_000 }, { 'hollow-wake': 20 }), 'hollow-wake')).toBe(1);
    expect(earnedRank(pilot({ rewards: 2_000 }, { 'hollow-wake': 19 }), 'hollow-wake')).toBe(0);
    // Each opens more than the last.
    for (const f of ['sta', 'frontier', 'hollow-wake'] as FactionId[]) expect(perksOf(f, 3).length).toBeGreaterThan(perksOf(f, 1).length);
  });
});

describe('promotions and falls', () => {
  it('are given at the faction’s own open dock, straight to the highest earned, once', () => {
    const s = pilot({ kills: 25 }, { sta: 45, frontier: 45 });
    expect(dock(s, INDEPENDENT.id).ranks).toEqual([]);
    expect(dock(s, FRONTIER.id).ranks.map((n) => n.faction)).toEqual([]);
    const out = dock(s, STA.id).ranks;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ faction: 'sta', kind: 'promoted', rank: 2, from: 0 });
    expect(out[0]!.text).toContain('Lane Officer');
    expect(s.ranks?.sta).toMatchObject({ rank: 2, where: STA.id });
    expect(settleRanks(s, STA.id)).toEqual([]);
    assertValidState(s);
  });

  it('are not given to a hunted pilot (an emergency berth), nor by the Wake but at a den that takes them in', () => {
    const s = pilot({ kills: 3 }, { sta: 20, 'hollow-wake': 25 });
    s.law.fines.sta = 500;
    expect(settleRanks(s, STA.id)).toEqual([]);
    expect(settleRanks(s, INDEPENDENT.id).some((n) => n.faction === 'hollow-wake')).toBe(false);
    const w = settleRanks(s, DEN.id);
    expect(w.map((n) => [n.faction, n.rank])).toEqual([['hollow-wake', 1]]);
    expect(rankGreeting(s, DEN.id)).toBe(RANK_LINES['hollow-wake'].greet.replace('{rank}', 'Cold Hand'));
  });

  it('fall a step when standing drops ten below what earned them, at any dock; perks wait while hunted', () => {
    const s = pilot({ kills: 50 }, { sta: 75 });
    settleRanks(s, STA.id);
    expect(heldRank(s, 'sta')).toBe(3);
    s.reputation.sta = 61;
    expect(keptRank(s, 'sta')).toBe(3);
    s.reputation.sta = 59;
    expect(heldRank(s, 'sta')).toBe(2);
    const fell = settleRanks(s, INDEPENDENT.id);
    expect(fell[0]).toMatchObject({ faction: 'sta', kind: 'fell', rank: 2, from: 3 });
    expect(s.ranks?.sta).toMatchObject({ rank: 2, fell: true });
    // Fines known here: the rank is kept, its perks wait.
    s.law.fines.sta = 200;
    expect(heldRank(s, 'sta')).toBe(2);
    expect(perkRank(s, 'sta', STA.systemId)).toBe(0);
    s.law.fines.sta = 0;
    s.reputation.sta = 0;
    settleRanks(s, INDEPENDENT.id);
    expect(s.ranks?.sta).toBeUndefined();
  });
});

describe('what ranks open', () => {
  it('a discount at the faction’s own yards only, charged on gear, ships and ships kept; never enough to sell back at a profit', () => {
    const s = pilot({ kills: 50 }, { sta: 75 });
    settleRanks(s, STA.id);
    s.location = { ...s.location, systemId: STA.systemId, dockedAt: STA.id };
    expect(yardDiscount(s, STA.id, 'halden')).toBe(RANKS.perks.yard[2]);
    expect(yardDiscount(s, FRONTIER.id, 'halden')).toBe(0);
    const slot = shipSlots(s.ship).find((sl) => gearOffers(s, STA.id, sl.id).some((o) => !o.blocked))!;
    const gear = gearOffers(s, STA.id, slot.id).find((o) => !o.blocked)!;
    expect(gear.price).toBe(Math.round(gear.item.price * (1 - RANKS.perks.yard[2])));
    let before = s.credits;
    expect(buyGear(s, STA.id, gear.item.id, slot.id).ok).toBe(true);
    expect(before - s.credits).toBe(gear.net);
    const ship = shipOffers(s, STA.id).find((o) => !o.blocked)!;
    expect(ship.discount).toBe(RANKS.perks.yard[2]);
    const keep = keepOffer(s, STA.id, ship.model.id)!;
    expect(keep.price).toBe(ship.price);
    before = s.credits;
    expect(buyAndKeep(s, STA.id, ship.model.id).ok).toBe(true);
    expect(before - s.credits).toBe(keep.price);
    before = s.credits;
    const next = shipOffers(s, STA.id).find((o) => !o.blocked)!;
    expect(buyShip(s, STA.id, next.model.id).ok).toBe(true);
    expect(before - s.credits).toBe(next.net);
    // Bought at the best discount and sold back, every ship and piece of gear at every own yard still loses.
    for (const l of ALL_LOCATIONS.filter((x) => x.factionId === 'sta' && open(x))) {
      for (const it of [...gearForSale(l.id), ...shipsForSale(l.id)]) expect(Math.round(it.price * (1 - RANKS.perks.yard[2])) - resaleValue(it.price)).toBeGreaterThanOrEqual(it.price * 0.15 - 1);
    }
  });

  it('commissions on their boards, locked below the rank, never chained, never a rival’s, and a sixth contract at the top', () => {
    let commission: JobDef | undefined;
    for (let epoch = 0; epoch < 40 && !commission; epoch++) commission = boardFor(STA.id, epoch).find((c) => c.requires?.rank);
    expect(commission).toBeDefined();
    expect(postedContract(commission!.id)?.id).toBe(commission!.id);
    expect(commission!.title).toMatch(/^Authority commission: /);
    const need = commission!.requires!.rank!;
    const low = pilot({ kills: 50 }, { sta: 75 });
    expect(jobLockReason(low, commission!)).toMatch(/For a .* of the Sol Transit Authority or above/);
    settleRanks(low, STA.id);
    expect(heldRank(low, 'sta')).toBeGreaterThanOrEqual(need.rank);
    expect(jobLockReason(low, commission!) ?? '').not.toMatch(/For a/);
    expect(followUpFor(commission!, 0)).toBeNull();
    for (const r of ROSTER) for (let n = 0; n < 200; n++) expect(claimFor(r, n)?.contract.requires?.rank).toBeUndefined();
    // Five in progress: the sixth only at the top rank.
    expect(activeLimit(low)).toBe(CONTRACTS.maxActive + 1);
    for (let i = 0; i < CONTRACTS.maxActive; i++) low.jobs[`c.x.${i}`] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    expect(contractBlock(low, commission!) ?? '').not.toMatch(/contracts in progress/);
    const plain = pilot();
    for (let i = 0; i < CONTRACTS.maxActive; i++) plain.jobs[`c.x.${i}`] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    expect(contractBlock(plain, commission!)).toMatch(/already have 5 contracts/);
  });

  it('the Wake’s ranks keep its raiders off a pilot’s outpost; the News tells promotions nearby for a while, the Wake’s only in its own places', () => {
    const s = pilot({ kills: 25 }, { 'hollow-wake': 50, sta: 45 });
    expect(outpostOdds(s)).toBe(1);
    settleRanks(s, DEN.id);
    expect(outpostOdds(s)).toBe(RANKS.perks.outpost.odds);
    settleRanks(s, STA.id);
    expect(rankNews(s, STA.id).map((n) => n.faction)).toEqual(['sta']);
    expect(rankNews(s, DEN.id).map((n) => n.faction)).toContain('hollow-wake');
    s.clock += RANKS.news.seconds + 1;
    expect(rankNews(s, STA.id)).toEqual([]);
  });
});

describe('the save', () => {
  it('keeps ranks, and refuses damaged ones', () => {
    const s = pilot({ kills: 25 }, { sta: 45 });
    settleRanks(s, STA.id);
    assertValidState(s);
    const refuse = (patch: (x: GameState) => void) => {
      const bad = structuredClone(s);
      patch(bad);
      expect(() => assertValidState(bad)).toThrow(/damaged/);
    };
    refuse((x) => ((x.ranks as Record<string, unknown>).nobody = { rank: 1, at: 0, where: STA.id }));
    refuse((x) => (x.ranks!.sta!.rank = 4 as 1));
    refuse((x) => (x.ranks!.sta!.at = x.clock + 1));
    refuse((x) => (x.ranks!.sta!.where = 'nowhere'));
    refuse((x) => ((x.ranks!.sta as { fell?: unknown }).fell = false));
  });
});

// ---------------------------------------------------------------- in flight

describe('cleared in under fire', () => {
  it('a ranked pilot docks at their faction’s station with raiders near; others are refused', () => {
    if (!(globalThis as { document?: unknown }).document) {
      const stub = (): unknown => new Proxy(function () {}, { get: (_t, p) => (p === 'getImageData' || p === 'createImageData' ? (_x: number, _y: number, w: number, hh: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * hh * 4)), width: w, height: hh }) : stub()), apply: () => stub(), set: () => true });
      (globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }) };
    }
    const fly = (ranked: boolean) => {
      const s = pilot({ kills: 25 }, { sta: 45 });
      if (ranked) settleRanks(s, STA.id);
      s.location = { systemId: STA.systemId, dockedAt: null, flight: null, lastDockId: STA.id };
      const comms: string[] = [];
      const nothing = () => {};
      const callbacks: FlightCallbacks = {
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
        onComm: (who, text) => comms.push(`${who}: ${text}`),
      };
      const flight = new FlightSession({
        system: new SystemScene(sceneDefFor(STA.systemId), { quality: 'low', reducedMotion: true }),
        camera: new THREE.PerspectiveCamera(),
        state: s,
        settings: defaultSettings(),
        ctx: { quality: 'low', reducedMotion: true },
        audio: { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine,
        callbacks,
        lanes: false,
      });
      flight.start({ kind: 'arrival' });
      expect(flight.placeNear(`station:${STA.id}`, 600)).toBe(true);
      const guard = (flight as unknown as { spawnGuard(m: string, pack: number, at: THREE.Vector3): unknown }).spawnGuard(RAIDERS[1][0]!, 99, flight.player.position.clone().add(new THREE.Vector3(0, 800, 0)));
      expect(guard).toBeDefined();
      flight.update(1 / 20, emptyInput());
      expect(flight.hostilesNearby(2_200)).toBe(true);
      return { s, flight, comms };
    };
    const plain = fly(false);
    expect(coveredAt(plain.s, STA.id)).toBe(false);
    expect(plain.flight.contextAction()?.label).not.toBe('Dock');
    plain.flight.dispose();
    const ranked = fly(true);
    expect(coveredAt(ranked.s, STA.id)).toBe(true);
    expect(ranked.flight.contextAction()?.label).toBe('Dock');
    const input = emptyInput();
    input.actions.add('interact');
    ranked.flight.update(1 / 20, input);
    expect(ranked.flight.autopilotMode).toBe('dock');
    expect(ranked.comms.join(' ')).toMatch(/Come straight in/);
    ranked.flight.dispose();
  });
});
