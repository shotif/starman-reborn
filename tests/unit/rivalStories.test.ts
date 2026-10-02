import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { COMBAT } from '../../src/content/combat/rules.ts';
import { STORY } from '../../src/content/rivals/storyLines.ts';
import { RIVAL_STORY, type RivalStoryRules } from '../../src/content/rivals/stories.ts';
import { RIVALS, ROSTER, type RivalDef } from '../../src/content/rivals/rules.ts';
import { getLocation, getSystem, WORLD } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { payCrew } from '../../src/economy/combat.ts';
import { advanceJobs } from '../../src/economy/jobs.ts';
import { lawIn, patrolsScanIn } from '../../src/economy/law.ts';
import { validateRivalStories } from '../../src/economy/rivalStoryGuards.ts';
import {
  alliesDock,
  ambushIn,
  askAlly,
  duelIn,
  duelLost,
  duelStarted,
  duelWon,
  lendTo,
  loanBack,
  partWays,
  repayAt,
  rescuePay,
  settleRivalStories,
  spendAmbush,
  spendTipoff,
  storyOffer,
  storyStatus,
  storyTag,
  takeEscort,
  tipoffIn,
} from '../../src/economy/rivalStories.ts';
import {
  buyRivalRound,
  claimsAt,
  departOf,
  duelSystem,
  holdsOf,
  makeAmends,
  metRival,
  nextRun,
  patchOf,
  rivalById,
  rivalShot,
  rivalWhere,
  runOf,
  standingWith,
  turnOf,
  turnStart,
} from '../../src/economy/rivals.ts';

/**
 * Rival stories (docs/PROCGEN.md §28): their guardrails; careers untouched without them; a friend's
 * loan, deed (an escort, a rescue) and flights on the wing; an enemy's feud, its opening (customs
 * tipped off, hired guns) and its duel; amends, falling out, and saves.
 */

afterEach(() => useWorldLog(null));

const rival = (id: string): RivalDef => rivalById(id)!;
const F = RIVAL_STORY.friend;
const E = RIVAL_STORY.enemy;

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Every rival's runs and whereabouts over three days, as a fingerprint. */
function careerPrint(turns = 72): string {
  const parts: string[] = [];
  for (const r of ROSTER) {
    for (let n = 0; n < turns; n++) {
      const run = runOf(r, n);
      parts.push(run ? `${run.id}:${run.kind}:${run.from}>${run.to}:${run.via ?? ''}:${run.depart}-${run.loaded}-${run.arrive}:${run.commodity ?? ''}${run.qty}:${run.legs.map((l) => `${l.systemId}/${l.kind}/${l.start}`).join(',')}:${run.claim?.contract.id ?? ''}:${run.shortage?.id ?? ''}` : '-');
    }
    for (let t = RIVALS.from - 100; t < RIVALS.from + turns * RIVALS.turnSeconds; t += 371) {
      const w = rivalWhere(r, t);
      parts.push(w.kind === 'docked' ? `d${w.locationId}` : w.kind === 'flying' ? `f${w.leg.systemId}${w.progress.toFixed(3)}` : w.kind);
    }
  }
  return fnv(parts.join('|'));
}

/** A pilot past the opening, docked where a rival sits, its world log in use. */
function pilotAt(locationId: string, clock: number): GameState {
  const s = createNewGame(5);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 20_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

/** The first moment from `from` on when a rival sits docked somewhere, with a run of its own to fly next. */
function docked(r: RivalDef, from: number): { at: number; locationId: string } {
  for (let t = from; t < from + 40 * RIVALS.turnSeconds; t += 60) {
    const w = rivalWhere(r, t);
    const run = nextRun(r, t);
    if (w.kind === 'docked' && run && run.from === w.locationId && run.to !== w.locationId) return { at: t, locationId: w.locationId };
  }
  throw new Error(`${r.id} never docked`);
}

/** A friend at their table: met long ago, standing to ask for a loan. */
function friendAt(id: string, from = turnStart(4)): { s: GameState; r: RivalDef } {
  const r = rival(id);
  useWorldLog(createNewGame(1).world);
  const at = docked(r, from);
  const s = pilotAt(at.locationId, at.at);
  s.rivals = { [r.id]: { standing: F.standing, met: at.at - F.knownSeconds } };
  return { s, r };
}

/** Lets the clock run to a moment, settling stories as the game does. */
function runTo(s: GameState, clock: number) {
  s.clock = clock;
  return settleRivalStories(s);
}

describe('the rules', () => {
  it('pass their guardrails, every rival with a story it can play', { timeout: 60_000 }, () => {
    expect(validateRivalStories()).toEqual([]);
    for (const r of ROSTER) expect(RIVAL_STORY.paths[r.id]).toBeDefined();
  });

  it('catch broken ones: a yield too low, an ally out of reach, a window too short, a line with a number or a he', { timeout: 60_000 }, () => {
    const broken = (patch: (r: RivalStoryRules) => void) => {
      const rules = structuredClone(RIVAL_STORY);
      patch(rules);
      return validateRivalStories(rules).map((i) => `${i.rule}:${i.subject}`);
    };
    expect(broken((r) => (r.enemy.duel.yieldAt = 0.05))).toContain('rules:duel');
    expect(broken((r) => (r.friend.ally.standing = 90))).toContain('rules:ally');
    expect(broken((r) => (r.enemy.duel.open = 300))).toContain('rules:duel');
    expect(broken((r) => (r.enemy.duel.lostStanding = -40))).toContain('rules:duel');
    expect(broken((r) => delete r.paths.quickstep)).toContain('roster:quickstep');
    const lines = STORY.dry as { yields: string };
    const keep = lines.yields;
    lines.yields = 'I yield, and so does he.';
    expect(validateRivalStories().map((i) => i.rule)).toContain('lines');
    lines.yields = 'I yield after 3 rounds.';
    expect(validateRivalStories().map((i) => i.rule)).toContain('lines');
    lines.yields = keep;
  });
});

describe('careers', () => {
  it('without stories are exactly what they were before stories', { timeout: 60_000 }, () => {
    useWorldLog(null);
    expect(careerPrint()).toBe('855d9753');
    useWorldLog(createNewGame(1).world);
    expect(careerPrint()).toBe('855d9753');
    const s = createNewGame(1);
    const parts: string[] = [];
    const stations = ROSTER.filter((r) => r.style === 'hunter').flatMap((r) => patchOf(r).map((l) => l.id));
    for (let t = RIVALS.from; t < RIVALS.from + 72 * 3600; t += 900) {
      s.clock = t;
      for (const id of stations) for (const c of claimsAt(s, id)) parts.push(`${c.contract.id}:${c.rival.id}:${c.at}:${c.price}`);
    }
    expect(fnv(parts.join('|'))).toBe('a9bc3b09');
  });
});

/** A friend whose loan has come back, at their table again with a run to fly next. */
function repaid(id: string): { s: GameState; r: RivalDef } {
  const { s, r } = friendAt(id);
  lendTo(s, r);
  const story = s.world.rivals!.stories![r.id]!;
  runTo(s, repayAt(r, story, s.clock + 12 * 3_600) + 1);
  return { s, r };
}

function dockWith(s: GameState, r: RivalDef): void {
  const at = docked(r, s.clock);
  const loc = getLocation(at.locationId);
  s.clock = at.at;
  s.location = { systemId: loc.systemId, dockedAt: loc.id, flight: null, lastDockId: loc.id };
}

describe('a friend', () => {
  it('asks for a loan at their table once known a while, and pays it back with interest when their next run docks', () => {
    const { s, r } = friendAt('quickstep');
    s.rivals![r.id]!.met = s.clock - 60;
    expect(storyOffer(s, r)).toBeNull();
    s.rivals![r.id]!.met = s.clock - F.knownSeconds;
    s.rivals![r.id]!.standing = F.standing - 1;
    expect(storyOffer(s, r)).toBeNull();
    s.rivals![r.id]!.standing = F.standing;
    const offer = storyOffer(s, r)!;
    expect(offer).toMatchObject({ kind: 'loan', amount: F.loan.amount.trader, back: loanBack(F.loan.amount.trader), lock: null });
    expect(offer.kind === 'loan' && offer.text).toContain('1,500 cr');
    expect(storyTag(s, r)).toBe('Story');
    const credits = s.credits;
    expect(lendTo(s, r)).toMatchObject({ ok: true, line: STORY[r.voice].loanThanks });
    expect(s.credits).toBe(credits - 1_500);
    expect(standingWith(s, r.id)).toBe(F.standing + F.loan.standing);
    expect(storyOffer(s, r)).toBeNull();
    const story = s.world.rivals!.stories![r.id]!;
    expect(storyStatus(s, r)).toBe('Owes you 1,800 cr, back when their next run docks.');
    const back = repayAt(r, story, s.clock + 12 * 3_600);
    expect(back).toBeGreaterThan(s.clock);
    expect(back).toBeLessThan(Infinity);
    expect(runTo(s, back - 1).notes).toEqual([]);
    const { notes } = runTo(s, back + 1);
    expect(notes[0]!.text).toBe(`${'Mara “Quickstep” Venn'} paid back your loan: 1,800 cr.`);
    expect(s.credits).toBe(credits - 1_500 + 1_800);
    expect(story.loan!.repaid).toBe(back);
    expect(runTo(s, back + 2).notes).toEqual([]);
    assertValidState(s);
  });

  it('then asks the player to fly escort on their next run: held until it is done, then at its destination, and back at work from there', () => {
    const { s, r } = repaid('quickstep');
    dockWith(s, r);
    const offer = storyOffer(s, r)!;
    expect(offer.kind).toBe('escort');
    const run = nextRun(r, s.clock)!;
    expect(takeEscort(s, r).ok).toBe(true);
    const id = 'rs.quickstep.escort';
    expect(s.jobs[id]?.status).toBe('active');
    expect(s.contracts[id]!.objectives[0]).toMatchObject({ kind: 'escort', fromLocationId: run.from, locationId: run.to, model: r.ship, shipName: r.shipName, level: F.escort.level });
    expect(s.contracts[id]!.reward).toBe(F.escort.reward);
    // Held: out of the bar, and the run never sets off on its own.
    expect(rivalWhere(r, s.clock + 60)).toMatchObject({ kind: 'held', hold: { kind: 'escort' } });
    expect(runOf(r, run.turn)).toBeNull();
    expect(storyStatus(s, r)).toMatch(/^Waiting for you to fly escort to /);
    // The escorted ship docks at its destination.
    s.clock += 1_500;
    s.jobs[id]!.escort = 'arrived';
    advanceJobs(s, { dockedAt: null, systemId: s.location.systemId });
    expect(s.jobs[id]!.status).toBe('complete');
    const before = standingWith(s, r.id);
    const { notes } = settleRivalStories(s);
    expect(notes[0]!.line).toBe(STORY[r.voice].escortThanks);
    expect(standingWith(s, r.id)).toBe(before + F.deedStanding);
    const story = s.world.rivals!.stories![r.id]!;
    expect(story.ended).toEqual({ at: s.clock, how: 'friends' });
    expect(rivalWhere(r, s.clock + 1)).toEqual({ kind: 'docked', locationId: run.to });
    let n = turnOf(s.clock) + 1;
    while (!runOf(r, n)) n++;
    expect(runOf(r, n)!.from).toBe(run.to);
    assertValidState(s);
  });

  it('left waiting too long, flies the run alone and thinks less of the player', () => {
    const { s, r } = repaid('halfpenny');
    dockWith(s, r);
    expect(takeEscort(s, r).ok).toBe(true);
    const story = s.world.rivals!.stories![r.id]!;
    const from = story.deed!.from!;
    const before = standingWith(s, r.id);
    const { notes, jobs } = runTo(s, story.deed!.at + F.escort.wait + 1);
    expect(jobs[0]).toMatchObject({ jobId: 'rs.halfpenny.escort', kind: 'failed' });
    expect(notes[0]!.text).toMatch(/gave up waiting/);
    expect(standingWith(s, r.id)).toBe(before + F.escort.letDown);
    expect(story.ended?.how).toBe('let-down');
    expect(rivalWhere(r, story.deed!.end! + 1)).toEqual({ kind: 'docked', locationId: from });
  });

  it('for a rescue, has their drive fail on a run: adrift in a system, a distress call and a job; the parts handed over, a friend', () => {
    const { s, r } = repaid('tally');
    const story = s.world.rivals!.stories![r.id]!;
    const deed = story.deed!;
    expect(deed).toMatchObject({ kind: 'rescue', job: 'rs.tally.rescue' });
    expect(deed.at).toBeGreaterThanOrEqual(story.loan!.repaid! + F.rescue.after);
    expect(rivalWhere(r, deed.at - 1).kind).toBe('flying');
    expect(rivalWhere(r, deed.at + 1)).toMatchObject({ kind: 'held', hold: { kind: 'adrift', systemId: deed.systemId } });
    const run = [runOf(r, turnOf(deed.at)), runOf(r, turnOf(deed.at) - 1)].find((x) => x?.lostAt === deed.at);
    expect(run).toBeDefined();
    expect(runTo(s, deed.at - 1).notes).toEqual([]);
    const { notes } = runTo(s, deed.at + 5);
    expect(notes[0]!.text).toMatch(/^Distress call from Bastian “Tally” Okonjo: the Fair Exchange’s drive failed in /);
    expect(notes[0]!.line).toContain('ship components');
    const id = 'rs.tally.rescue';
    expect(s.contracts[id]!.objectives[0]).toMatchObject({ kind: 'rescue', systemId: deed.systemId, model: r.ship, shipName: r.shipName, commodity: 'ship-parts', qty: F.rescue.qty });
    expect(s.contracts[id]!.reward).toBe(rescuePay());
    expect(storyStatus(s, r)).toMatch(/^Adrift in /);
    // The parts handed over: paid, and a friend.
    s.clock += 900;
    const credits = s.credits;
    s.jobs[id]!.rescued = true;
    advanceJobs(s, { dockedAt: null, systemId: deed.systemId! });
    expect(s.credits).toBe(credits + rescuePay());
    const before = standingWith(s, r.id);
    expect(settleRivalStories(s).notes[0]!.line).toBe(STORY[r.voice].rescued);
    expect(standingWith(s, r.id)).toBe(before + F.deedStanding);
    expect(story.ended?.how).toBe('friends');
    expect(rivalWhere(r, s.clock + 1)).toEqual({ kind: 'docked', locationId: deed.to });
    assertValidState(s);
  });

  it('given up on, a rescue sends them home on a tow, thinking less of the player', () => {
    const { s, r } = repaid('sundown');
    const story = s.world.rivals!.stories![r.id]!;
    const deed = story.deed!;
    runTo(s, deed.at + 5);
    const before = standingWith(s, r.id);
    const { notes, jobs } = runTo(s, deed.at + F.rescue.giveUp + 1);
    expect(jobs[0]).toMatchObject({ jobId: 'rs.sundown.rescue', kind: 'failed' });
    expect(notes[0]!.line).toBe(STORY[r.voice].towed);
    expect(standingWith(s, r.id)).toBe(before + F.rescue.towed);
    expect(story.ended).toEqual({ at: deed.at + F.rescue.giveUp, how: 'towed' });
    expect(rivalWhere(r, story.ended!.at + 1)).toEqual({ kind: 'docked', locationId: r.home });
    expect(storyStatus(s, r)).toMatch(/^Towed home/);
  });

  it('done, the deed makes an ally: asked at their table, they fly on the wing until the player next docks, once in a while', () => {
    const r = rival('lantern');
    useWorldLog(createNewGame(1).world);
    const at = docked(r, turnStart(20));
    const s = pilotAt(at.locationId, at.at);
    s.rivals = { lantern: { standing: F.standing + F.loan.standing + F.deedStanding, met: 0 } };
    s.world.rivals = { down: {}, bought: {}, stories: { lantern: { path: 'friend', began: turnStart(2), loan: { amount: 1_200, repaid: turnStart(4) }, deed: { kind: 'rescue', at: turnStart(6), job: 'rs.lantern.rescue', to: r.home, systemId: getLocation(r.home).systemId, end: turnStart(7), resume: r.home, done: true }, ended: { at: turnStart(7), how: 'friends' } } } };
    expect(storyOffer(s, r)).toEqual({ kind: 'ally', lock: null });
    expect(storyTag(s, r)).toBe('Ally');
    expect(askAlly(s, r)).toMatchObject({ ok: true, line: STORY[r.voice].allyYes });
    expect(s.crew).toEqual([{ id: 'ally.lantern', name: 'Ione “Lantern” Sallow', model: r.ship, fee: 0, skill: 'sharp', ally: 'lantern' }]);
    expect(rivalWhere(r, s.clock + 600)).toMatchObject({ kind: 'held', hold: { kind: 'wing' } });
    expect(storyOffer(s, r)).toMatchObject({ lock: 'Ione is on your wing.' });
    expect(storyStatus(s, r)).toBe('An ally, flying on your wing.');
    // Docked again: they leave the wing there, and pick their career up from it.
    s.clock += 1_800;
    const dock = patchOf(r).find((l) => l.id !== at.locationId)!;
    expect(alliesDock(s, dock.id)).toEqual([`Ione “Lantern” Sallow leaves your wing at ${dock.name}.`]);
    expect(s.crew).toEqual([]);
    expect(rivalWhere(r, s.clock + 1)).toEqual({ kind: 'docked', locationId: dock.id });
    // Not again for a while; nor with the wing full.
    expect(storyOffer(s, r)).toMatchObject({ lock: 'Ione has a run of their own to fly. Ask again in about 3 h.' });
    s.clock += F.ally.every;
    s.crew = [0, 1].map((i) => ({ id: `w.${i}`, name: `Pilot ${i}`, model: r.ship, fee: 100, skill: 'steady' as const }));
    expect(storyOffer(s, r)).toMatchObject({ lock: `Your wing is full (${COMBAT.wingmen.max}).` });
    s.crew = [];
    expect(askAlly(s, r).ok).toBe(true);
    // An ally flies free: a jump pays them nothing, and writes nothing in the ledger.
    const ledger = s.ledger.length;
    expect(payCrew(s, 2)).toEqual({ paid: 0, notes: [] });
    expect(s.ledger.length).toBe(ledger);
    expect(s.crew).toHaveLength(1);
    expect(partWays(s, r).ok).toBe(true);
    expect(s.world.rivals!.stories!.lantern!.wings!.at(-1)).toEqual({ at: s.clock, end: s.clock, resume: at.locationId });
    assertValidState(s);
  });

  it('done, the deed lets rounds take standing up to an ally’s, and an ally hunter hands claims over for nothing', () => {
    const r = rival('lantern');
    useWorldLog(createNewGame(1).world);
    let claim: { giver: string; at: number; id: string } | null = null;
    for (let n = 6; n < 200 && !claim; n++) {
      const run = runOf(r, n);
      if (run?.claim) claim = { giver: run.claim.giver, at: run.claim.at, id: run.claim.contract.id };
    }
    const s = pilotAt(claim!.giver, claim!.at + 1);
    s.rivals = { lantern: { standing: 30, met: 0 } };
    s.world.rivals = { down: {}, bought: {}, stories: { lantern: { path: 'friend', began: turnStart(0), loan: { amount: 1_200, repaid: turnStart(1) }, deed: { kind: 'rescue', at: turnStart(2), job: 'rs.lantern.rescue', to: r.home, systemId: getLocation(r.home).systemId, end: turnStart(3), resume: r.home, done: true }, ended: { at: turnStart(3), how: 'friends' } } } };
    for (let i = 0; i < 4; i++) {
      s.clock += 4 * 1_500;
      buyRivalRound(s, r);
    }
    expect(standingWith(s, r.id)).toBe(F.ally.standing);
    // Back to the claim's moment: an ally hands it over.
    s.clock = claim!.at + 1;
    const held = claimsAt(s, claim!.giver).find((c) => c.contract.id === claim!.id);
    expect(held?.price).toBe(0);
  });
});

/** A pilot who has just made a rival hostile, met a while back. */
function feud(id: string, clock = turnStart(6)): { s: GameState; r: RivalDef } {
  const r = rival(id);
  const s = pilotAt(r.home, clock);
  s.rivals = { [r.id]: { standing: -20, met: clock - 600 } };
  rivalShot(s, r, 1);
  return { s, r };
}

const security = (sys: SystemId) => WORLD.profiles.get(sys)?.security ?? 1;

/** Systems within some jumps of a rival's home. */
function nearHome(r: RivalDef, jumps: number): SystemId[] {
  const home = getLocation(r.home).systemId;
  const out: SystemId[] = [home];
  let ring: SystemId[] = [home];
  for (let j = 0; j < jumps; j++) {
    ring = ring.flatMap((x) => [...(WORLD.links.get(x) ?? [])]).filter((x) => !out.includes(x));
    out.push(...new Set(ring));
  }
  return out.filter((x) => x !== 'sol');
}

describe('an enemy', () => {
  it('made hostile, has a feud planned: its opening at a turn at least an hour on, two after they met', () => {
    const { s, r } = feud('quickstep');
    expect(standingWith(s, r.id)).toBe(-45);
    const story = s.world.rivals!.stories![r.id]!;
    expect(story.path).toBe('enemy');
    expect(story.began).toBeGreaterThanOrEqual(s.clock + E.after);
    expect(story.began).toBeGreaterThanOrEqual(s.rivals![r.id]!.met! + E.sinceMet);
    expect(story.began).toBe(departOf(r, turnOf(story.began)));
    expect(storyTag(s, r)).toBe('Feud');
    expect(storyOffer(s, r)).toBeNull();
    expect(storyStatus(s, r)).toBe('Has it in for you. Watch yourself near their home.');
  });

  it('tips customs off in lawful space near their home, once; then calls the player out to a duel off a lawless beacon', () => {
    const { s, r } = feud('tally');
    const story = s.world.rivals!.stories![r.id]!;
    const lawful = nearHome(r, E.tipoff.jumps).find((x) => patrolsScanIn(x))!;
    // Nobody's law: the Wake's space, or unclaimed.
    const lawless = nearHome(r, 3).find((x) => !lawIn(x));
    expect(lawful).toBeDefined();
    expect(tipoffIn(s, lawful)).toBeNull();
    s.clock = story.began + 10;
    expect(tipoffIn(s, lawful)).toBe(r);
    if (lawless) expect(tipoffIn(s, lawless)).toBeNull();
    expect(spendTipoff(s, r)).toBe('Customs were tipped off: Bastian “Tally” Okonjo told them to look you over.');
    expect(tipoffIn(s, lawful)).toBeNull();
    // A tip-off holds them nowhere; the duel is posted at their first turn half an hour on.
    expect(holdsOf(r).map((h) => h.kind)).toEqual(['duel']);
    const posted = holdsOf(r)[0]!.from;
    expect(posted).toBeGreaterThanOrEqual(story.spent! + E.duel.postedAfter);
    expect(runTo(s, posted - 1).notes).toEqual([]);
    const { notes } = runTo(s, posted + 1);
    expect(notes[0]!.text).toMatch(/^Bastian “Tally” Okonjo calls you out: a duel at the beacon in /);
    const sys = duelSystem(r);
    expect(notes[0]!.line).toBe(STORY[r.voice].challenge.replace('{system}', getSystem(sys).displayName));
    expect(security(sys)).toBeLessThan(RIVALS.hostile.lawless);
    expect(s.jobs['rs.tally.duel']?.status).toBe('active');
    expect(s.contracts['rs.tally.duel']!.objectives[0]).toMatchObject({ kind: 'duel', systemId: sys, rival: 'tally' });
    expect(duelIn(s, sys)).toEqual({ rival: r, jobId: 'rs.tally.duel', started: false });
    expect(rivalWhere(r, posted + 60)).toMatchObject({ kind: 'held', hold: { kind: 'duel', systemId: sys } });
    expect(storyStatus(s, r)).toMatch(/^Waiting for you at the beacon in /);
  });

  it('sends hired guns into lawless space near home, a bounty hunter flying with one of them; lying in wait meanwhile', () => {
    const { s, r } = feud('lantern');
    const story = s.world.rivals!.stories![r.id]!;
    const lawless = nearHome(r, E.ambush.jumps).find((x) => security(x) < RIVALS.hostile.lawless)!;
    expect(lawless).toBeDefined();
    s.clock = story.began + 10;
    const a = ambushIn(s, lawless)!;
    expect(a).toMatchObject({ rival: r, guns: E.ambush.hunterGuns, withRival: true, level: E.ambush.level });
    expect(a.delay).toBeGreaterThanOrEqual(E.ambush.delay[0]);
    expect(a.delay).toBeLessThanOrEqual(E.ambush.delay[1]);
    expect(rivalWhere(r, s.clock)).toMatchObject({ kind: 'held', hold: { kind: 'waiting' } });
    expect(spendAmbush(s, r)).toBe('Hired guns! Ione “Lantern” Sallow paid them to find you.');
    expect(ambushIn(s, lawless)).toBeNull();
    expect(rivalWhere(r, s.clock + 1)).toEqual({ kind: 'docked', locationId: r.home });
    const runner = feud('sundown');
    const st = runner.s.world.rivals!.stories!.sundown!;
    runner.s.clock = st.began + 10;
    const sys = nearHome(runner.r, E.ambush.jumps).find((x) => security(x) < RIVALS.hostile.lawless)!;
    expect(ambushIn(runner.s, sys)).toMatchObject({ guns: E.ambush.guns, withRival: false });
  });

  it('won, a duel pays the purse and ends the feud; yielded or left, the stake', () => {
    const { s, r } = feud('two-bells');
    const story = s.world.rivals!.stories![r.id]!;
    runTo(s, holdsOf(r).find((h) => h.kind === 'duel')!.from + 5);
    duelStarted(s, r);
    expect(story.duel!.started).toBe(s.clock);
    expect(duelIn(s, duelSystem(r))!.started).toBe(true);
    // Under way, it goes on past its window (a game saved in the middle of one comes back to it).
    const at = s.clock;
    s.clock = story.duel!.posted + E.duel.open + 60;
    expect(duelIn(s, duelSystem(r))).toMatchObject({ started: true });
    expect(settleRivalStories(s).jobs).toEqual([]);
    s.clock = at;
    const credits = s.credits;
    const won = duelWon(s, r);
    expect(won.events.map((e) => e.kind)).toEqual(['complete']);
    expect(won.line).toBe(STORY[r.voice].yields);
    expect(s.credits).toBe(credits + E.duel.purse);
    expect(standingWith(s, r.id)).toBe(E.duel.wonStanding);
    expect(story.ended).toEqual({ at: s.clock, how: 'won' });
    expect(duelIn(s, duelSystem(r))).toBeNull();
    expect(storyStatus(s, r)).toBe('Lost a duel to you. You are square.');
    expect(rivalWhere(r, s.clock + 1)).toEqual({ kind: 'docked', locationId: r.home });
    const other = feud('halfpenny');
    runTo(other.s, holdsOf(other.r).find((h) => h.kind === 'duel')!.from + 5);
    duelStarted(other.s, other.r);
    const before = other.s.credits;
    const lost = duelLost(other.s, other.r, 'lost');
    expect(lost.events.map((e) => e.kind)).toEqual(['failed']);
    expect(other.s.credits).toBe(before - E.duel.stake);
    expect(standingWith(other.s, other.r.id)).toBe(E.duel.lostStanding);
    expect(other.s.world.rivals!.stories!.halfpenny!.ended!.how).toBe('lost');
    assertValidState(s);
    assertValidState(other.s);
  });

  it('waits at the beacon for the whole window; never met, the feud stands', () => {
    const { s, r } = feud('sundown');
    const duel = () => holdsOf(r).find((h) => h.kind === 'duel')!;
    runTo(s, duel().from + 5);
    const until = s.world.rivals!.stories![r.id]!.duel!.posted + E.duel.open;
    expect(runTo(s, until - 1).notes).toEqual([]);
    const { notes, jobs } = runTo(s, until + 1);
    expect(notes[0]!.line).toBe(STORY[r.voice].noShow);
    expect(jobs[0]).toMatchObject({ jobId: 'rs.sundown.duel', kind: 'failed' });
    expect(s.world.rivals!.stories![r.id]!.ended).toEqual({ at: until, how: 'no-show' });
    expect(standingWith(s, r.id)).toBeLessThanOrEqual(-30);
    expect(storyTag(s, r)).toBeNull();
  });

  it('ends with amends, whenever they come: before the opening, nothing comes; with a duel posted, it is off', () => {
    const { s, r } = feud('quickstep');
    expect(makeAmends(s, r).ok).toBe(true);
    expect(s.world.rivals!.stories![r.id]!.ended).toEqual({ at: s.clock, how: 'amends' });
    expect(holdsOf(r)).toEqual([]);
    expect(runTo(s, s.clock + 6 * 3_600).notes).toEqual([]);
    expect(storyStatus(s, r)).toBe('Took your amends. The feud is over.');
    const other = feud('lantern');
    runTo(other.s, holdsOf(other.r).find((h) => h.kind === 'duel')!.from + 5);
    expect(other.s.jobs['rs.lantern.duel']?.status).toBe('active');
    makeAmends(other.s, other.r);
    const { jobs } = settleRivalStories(other.s);
    expect(jobs[0]).toMatchObject({ jobId: 'rs.lantern.duel', kind: 'failed' });
  });
});

describe('falling out', () => {
  it('a friend made hostile ends their story there, leaves the wing, and gets no feud: one story each', () => {
    const r = rival('two-bells');
    useWorldLog(createNewGame(1).world);
    const at = docked(r, turnStart(20));
    const s = pilotAt(at.locationId, at.at);
    s.rivals = { 'two-bells': { standing: 45, met: 0 } };
    s.world.rivals = { down: {}, bought: {}, stories: { 'two-bells': { path: 'friend', began: turnStart(2), loan: { amount: 1_200, repaid: turnStart(4) }, deed: { kind: 'escort', at: turnStart(6), job: 'rs.two-bells.escort', from: r.home, to: r.home, end: turnStart(7), resume: r.home, done: true }, ended: { at: turnStart(7), how: 'friends' } } } };
    askAlly(s, r);
    expect(s.crew).toHaveLength(1);
    rivalShot(s, r, 1);
    rivalShot(s, r, 2);
    rivalShot(s, r, 3);
    expect(standingWith(s, r.id)).toBeLessThanOrEqual(-30);
    expect(s.crew).toEqual([]);
    expect(s.world.rivals!.stories!['two-bells']!.ended!.how).toBe('friends');
    expect(s.world.rivals!.stories!['two-bells']!.path).toBe('friend');
    expect(holdsOf(r).filter((h) => h.kind === 'duel')).toEqual([]);
  });

  it('a friend mid-story made hostile ends it as a falling-out', () => {
    const { s, r } = friendAt('tally');
    lendTo(s, r);
    for (let i = 1; i <= 4; i++) rivalShot(s, r, i);
    expect(s.world.rivals!.stories!.tally!.ended).toEqual({ at: s.clock, how: 'fell-out' });
    expect(storyStatus(s, r)).toBe('You fell out.');
  });
});

describe('saves', () => {
  it('keep stories, the moment a rival was met and allies on the wing, and refuse damaged ones', () => {
    const { s, r } = friendAt('quickstep');
    lendTo(s, r);
    metRival(s, 'tally');
    s.crew = [{ id: 'ally.lantern', name: 'Ione “Lantern” Sallow', model: rival('lantern').ship, fee: 0, skill: 'sharp', ally: 'lantern' }];
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    expect(bad((x) => (x.world.rivals!.stories!.quickstep!.path = 'rival' as never))).toThrow(/rival story/);
    expect(bad((x) => (x.world.rivals!.stories!.nobody = { path: 'friend', began: 0 }))).toThrow(/rival story/);
    expect(bad((x) => (x.world.rivals!.stories!.quickstep!.loan!.amount = -5))).toThrow(/rival story/);
    expect(bad((x) => (x.world.rivals!.stories!.quickstep!.ended = { at: 5, how: 'eaten' as never }))).toThrow(/rival story/);
    expect(bad((x) => (x.crew[0]!.ally = 'nobody'))).toThrow(/crew/);
    expect(bad((x) => (x.rivals!.tally!.met = Number.NaN))).toThrow(/rival/);
  });
});

// ---------------------------------------------------------------- in flight

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') {
          return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        }
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }),
  };
}

interface RawNpc {
  id: string;
  foe: unknown;
  body: { position: THREE.Vector3 };
  durability: { hull: number; hullMax: number };
}

/** A flight in a system with a rival's story in its traffic, recording what the scene tells the game. */
function storyFlight(systemId: SystemId, traffic: Partial<TrafficSetup>, setup: (s: GameState) => void = () => {}) {
  installCanvasStub();
  const state = createNewGame(9);
  state.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  state.location = { systemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  state.clock = turnStart(10);
  setup(state);
  useWorldLog(state.world);
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const nothing = () => {};
  const callbacks: FlightCallbacks = {
    onDocked: nothing,
    onPlayerDestroyed: record('destroyed'),
    onDiscovery: nothing,
    onScanInfo: nothing,
    onEncounterStart: nothing,
    onEncounterEnd: nothing,
    onLoot: nothing,
    onBounty: record('bounty'),
    onContractKill: nothing,
    onMessage: nothing,
    onComm: nothing,
    onScan: record('scan'),
    onRival: record('rival'),
    onRivalAmbush: record('ambush'),
    onDuel: record('duel'),
    onWingmanLost: record('wingLost'),
  };
  const flight = new FlightSession({
    system: new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true }),
    camera: new THREE.PerspectiveCamera(),
    state,
    settings: defaultSettings(),
    ctx: { quality: 'low', reducedMotion: true },
    audio: { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine,
    callbacks,
    traffic: { plan: { traders: 0, patrolWings: 0, wingSize: 2, packs: null }, owner: null, ...traffic },
  });
  flight.start({ kind: 'arrival' });
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      state.clock += 1 / 20;
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  const raw = (id: string) => (flight as unknown as { npcs: RawNpc[] }).npcs.find((n) => n.id === id)!;
  const hull = () => (flight as unknown as { playerDurability: { hull: number; hullMax: number } }).playerDurability;
  return { flight, state, calls, run, npcs: () => flight.debugNpcs(), raw, hull };
}

/** A lawless system (nobody's law), for hired guns and duels. */
const LAWLESS = (): SystemId => duelSystem(rival('lantern'));

describe('in flight', () => {
  it('an ally flies on the wing in their own ship; lost there, they eject (told of as a wingman)', () => {
    const r = rival('lantern');
    const f = storyFlight('sirius', { crew: [{ id: 'ally.lantern', name: 'Ione “Lantern” Sallow', model: r.ship, skill: 'sharp', ally: 'lantern' }] });
    f.run(3);
    const ally = f.npcs().find((n) => n.rival === 'lantern')!;
    expect(ally).toMatchObject({ name: 'Ione “Lantern” Sallow', subtitle: 'Your ally · the Long Night', side: 'lawful' });
    f.flight.debugDestroy(ally.id, false);
    expect(f.calls.wingLost).toEqual([['ally.lantern']]);
    expect(f.calls.rival).toBeUndefined();
  });

  it('hired guns strike after their delay, a bounty hunter flying with them; they want the player, and pay no bounty', () => {
    const f = storyFlight(LAWLESS(), { rivalAmbush: { rivalId: 'lantern', delay: 20, guns: 1, withRival: true, level: 2 } });
    f.run(18);
    expect(f.npcs().filter((n) => n.hired)).toEqual([]);
    expect(f.run(5, () => !!f.calls.ambush)).toBe(true);
    expect(f.calls.ambush).toEqual([['lantern']]);
    const hired = f.npcs().filter((n) => n.hired === 'lantern');
    expect(hired).toHaveLength(2);
    expect(hired.filter((n) => n.rival === 'lantern')).toHaveLength(1);
    expect(hired.every((n) => n.side === 'raider')).toBe(true);
    for (const n of hired) expect(f.raw(n.id).foe).toBe('player');
    f.flight.debugDestroy(hired.find((n) => !n.rival)!.id, true);
    expect(f.calls.bounty).toBeUndefined();
    // Once a flight.
    f.run(30);
    expect(f.calls.ambush).toHaveLength(1);
    const runner = storyFlight(LAWLESS(), { rivalAmbush: { rivalId: 'sundown', delay: 20, guns: 2, withRival: false, level: 2 } });
    runner.run(25);
    expect(runner.npcs().filter((n) => n.hired === 'sundown').map((n) => n.rival)).toEqual([null, null]);
  });

  it('a duel: the rival waits off the beacon, no raiders come, it starts once the player is close with a sound hull, and the rival yields before its ship is lost', () => {
    const jobId = 'rs.lantern.duel';
    const packs = { max: 2, level: 2 as const, size: [2, 3] as [number, number], firstDelay: 0, interval: [1, 2] as [number, number] };
    const f = storyFlight(LAWLESS(), { plan: { traders: 0, patrolWings: 0, wingSize: 2, packs }, duel: { jobId, rivalId: 'lantern', started: false } });
    f.run(4);
    const duelist = f.npcs().find((n) => n.duel)!;
    expect(duelist).toMatchObject({ rival: 'lantern', duel: 'waiting', name: 'Ione “Lantern” Sallow' });
    expect(f.raw(duelist.id).body.position.distanceTo(f.flight.duelSpot(jobId))).toBeLessThan(800);
    expect(f.flight.duelStatus()).toEqual({ jobId, rivalId: 'lantern', state: 'waiting' });
    f.run(5);
    expect(f.npcs().filter((n) => n.side === 'raider' && !n.duel)).toEqual([]);
    // Too battered to fight: told once, and it waits.
    const hull = f.hull();
    hull.hull = hull.hullMax * 0.5;
    f.flight.placeNear(`duel:${jobId}`, 1_000);
    f.run(1);
    expect(f.calls.duel).toEqual([[jobId, 'lantern', 'unfit']]);
    hull.hull = hull.hullMax;
    expect(f.run(2, () => f.flight.duelStatus()?.state === 'on')).toBe(true);
    expect(f.calls.duel!.at(-1)).toEqual([jobId, 'lantern', 'started']);
    expect(f.raw(duelist.id).foe).toBe('player');
    // Shots in the duel cost no standing; the rival yields before its ship is lost.
    f.flight.debugDestroy(duelist.id, true);
    expect(f.calls.duel!.at(-1)).toEqual([jobId, 'lantern', 'won']);
    expect(f.calls.rival).toBeUndefined();
    const after = f.npcs().find((n) => n.id === duelist.id)!;
    expect(after.duel).toBe('yielded');
    expect(after.hull).toBeGreaterThanOrEqual(1);
    expect(f.raw(duelist.id).foe).toBeNull();
    // Firing on a rival who has yielded is a shot like any other.
    f.flight.debugDestroy(duelist.id, true);
    expect(f.calls.rival![0]).toEqual(['lantern', 'shot']);
  });

  it('in a duel the player yields before their ship is lost; flying off once it has started is forfeit', () => {
    const jobId = 'rs.two-bells.duel';
    const f = storyFlight(LAWLESS(), { duel: { jobId, rivalId: 'two-bells', started: false } });
    f.run(3);
    const duelist = f.npcs().find((n) => n.duel)!;
    f.flight.placeNear(`duel:${jobId}`, 1_000);
    expect(f.run(2, () => f.flight.duelStatus()?.state === 'on')).toBe(true);
    f.flight.debugHurt(1e6);
    expect(f.calls.duel!.at(-1)).toEqual([jobId, 'two-bells', 'lost']);
    expect(f.calls.destroyed).toBeUndefined();
    expect(f.hull().hull).toBeGreaterThanOrEqual(1);
    expect(f.flight.duelStatus()!.state).toBe('won');

    const g = storyFlight(LAWLESS(), { duel: { jobId, rivalId: 'two-bells', started: false } });
    g.run(3);
    const d = g.npcs().find((n) => n.duel)!;
    g.flight.placeNear(`duel:${jobId}`, 1_000);
    expect(g.run(2, () => g.flight.duelStatus()?.state === 'on')).toBe(true);
    g.flight.player.position.copy(g.raw(d.id).body.position).add(new THREE.Vector3(E.duel.forfeitRange + 2_000, 0, 0));
    expect(g.run(1, () => g.calls.duel!.at(-1)![2] === 'forfeit')).toBe(true);
  });

  it('a rescue or a duel posted while the player flies in its system brings its ship into the scene at once', () => {
    const r = rival('tally');
    const f = storyFlight(LAWLESS(), {});
    f.run(3);
    f.flight.addStoryShip({ rescue: { jobId: 'rs.tally.rescue', name: r.shipName, model: r.ship, commodity: 'ship-parts', qty: 4, guard: null } });
    f.flight.addStoryShip({ duel: { jobId: 'rs.lantern.duel', rivalId: 'lantern', started: false } });
    f.run(1);
    expect(f.npcs().some((n) => n.name === r.shipName && n.subtitle === 'Adrift · drive failure')).toBe(true);
    expect(f.npcs().find((n) => n.duel)).toMatchObject({ rival: 'lantern', duel: 'waiting' });
    // Once each.
    f.flight.addStoryShip({ duel: { jobId: 'rs.lantern.duel', rivalId: 'lantern', started: false } });
    expect(f.npcs().filter((n) => n.duel)).toHaveLength(1);
  });

  it('customs tipped off by a rival scan a clean hold', () => {
    const f = storyFlight('sol', { plan: { traders: 0, patrolWings: 1, wingSize: 2, packs: null }, owner: 'sta', tipped: true });
    f.run(3);
    const p = f.npcs().find((n) => n.role === 'patrol')!;
    f.flight.player.position.copy(f.raw(p.id).body.position).add(new THREE.Vector3(800, 0, 0));
    expect(f.run(20, () => !!f.calls.scan)).toBe(true);
    expect(f.calls.scan).toEqual([['complete', 'sta']]);
  });
});
