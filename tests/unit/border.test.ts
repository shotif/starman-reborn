import { afterEach, describe, expect, it } from 'vitest';
import { dockAt, performJump } from '../../src/app/rules.ts';
import { findRoute } from '../../src/galaxy/routing.ts';
import { migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { BORDER } from '../../src/content/border/rules.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { LAW } from '../../src/content/law/rules.ts';
import { ARC_JOBS, CHARACTERS, LONG_BORDER_FRONT } from '../../src/content/story/arcs.ts';
import { jumpsFrom } from '../../src/content/world/network.ts';
import { ALL_LOCATIONS, getLocation, isFrontier, SYSTEMS, WORLD } from '../../src/data/systems.ts';
import { atWar, borderNews, deedsAt, EXPOSED, FRONTS, frontState, getFront, occupied, pushFront, recordDeed, STORY_FRONTS, tideAt, type Front } from '../../src/economy/border.ts';
import { markSettledFronts } from '../../src/economy/answers.ts';
import { boardEpoch, boardFor, contractBlock } from '../../src/economy/contracts.ts';
import { MAX_REWARD } from '../../src/economy/contractGuards.ts';
import { welcomeText } from '../../src/economy/dockText.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { acceptJob, advanceJobs, countPiracy, currentObjective, escortArrived, escortsIn, jobsAt, type JobDef } from '../../src/economy/jobs.ts';
import { dockAccess } from '../../src/economy/law.ts';
import { quote } from '../../src/economy/markets.ts';
import { allMarks } from '../../src/economy/marks.ts';
import { validateMarks } from '../../src/economy/storyGuards.ts';
import { marketContext } from '../../src/economy/trade.ts';
import { checkMilestones } from '../../src/economy/progress.ts';
import { arcStatus, briefingFor, makeChoice, optionLock } from '../../src/economy/story.ts';
import { trafficFor } from '../../src/world/traffic/setup.ts';

/** The border war and The Long Border (docs/PROCGEN.md §20), played with the game's own rules. */

afterEach(() => useWorldLog(null));

function pilot(): GameState {
  const s = createNewGame(29);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 20_000;
  useWorldLog(s.world);
  return s;
}

function dock(s: GameState, locationId: string) {
  s.location.systemId = getLocation(locationId).systemId;
  return dockAt(s, locationId).jobEvents;
}

/** A clock well inside a phase of a front (the middle of its first run in a tide), with no deeds. */
function clockIn(front: Front, phase: string): number {
  const step = 600;
  let start = -1;
  for (let t = 0; t < 2 * BORDER.tide.periodSeconds; t += step) {
    const inside = frontState(front, t, null).phase === phase;
    if (inside && start < 0 && t > 0) start = t;
    if (!inside && start >= 0) return Math.round((start + t) / 2);
  }
  throw new Error(`${front.id} never reaches ${phase}`);
}

const longBorder = getFront(LONG_BORDER_FRONT)!;
const done = (s: GameState, id: string) => s.jobs[id]?.status === 'complete';

describe('the border fronts', () => {
  it('run where lawful space meets a working den, and never leave a system without a repair dock', () => {
    expect(FRONTS.length).toBeGreaterThanOrEqual(3);
    expect(longBorder).toMatchObject({ lawSystem: 'ross-154', wakeSystem: 'wolf-1061', denId: 'maw-roost', faction: 'sta', exposedId: 'regent-concourse' });
    const homes = new Set(Object.values(CHARACTERS).map((c) => c.locationId));
    for (const f of FRONTS) {
      const den = getLocation(f.denId);
      expect(den.stationType).toBe('pirate-den');
      expect(den.systemId).toBe(f.wakeSystem);
      if (!f.exposedId) continue;
      const exposed = getLocation(f.exposedId);
      expect(exposed.systemId).toBe(f.lawSystem);
      expect(homes.has(exposed.id), `${exposed.id} is somebody's home`).toBe(false);
      // Another dock with repairs stays open in the system when this one falls.
      const others = ALL_LOCATIONS.filter((l) => l.systemId === f.lawSystem && l.id !== exposed.id && l.status === 'functional' && l.dockable !== false && l.services.includes('repair'));
      expect(others.length, f.id).toBeGreaterThan(0);
    }
  });

  it('swing with the tide through every phase, the same on every device', () => {
    for (const f of FRONTS) {
      const seen = new Set<string>();
      for (let t = 0; t < BORDER.tide.periodSeconds; t += 1_800) seen.add(frontState(f, t, null).phase);
      expect(seen.has('truce')).toBe(false);
      expect([...seen].sort()).toEqual(f.exposedId ? ['blockade', 'fallen', 'pushed-back', 'skirmish'] : ['blockade', 'pushed-back', 'skirmish']);
      expect(tideAt(f, 12_345)).toBeCloseTo(tideAt(f, 12_345 + BORDER.tide.periodSeconds), 9);
    }
  });

  it('answer the player: deeds push, fade with time, and are kept only so long', () => {
    const s = pilot();
    const t = clockIn(longBorder, 'fallen');
    s.clock = t;
    expect(occupied('regent-concourse', t)).not.toBeNull();
    pushFront(s, longBorder.id, BORDER.deeds.warContract);
    expect(frontState(longBorder, t).pressure).toBeCloseTo(frontState(longBorder, t, null).pressure + BORDER.deeds.warContract, 6);
    expect(deedsAt(s.world.border[longBorder.id], t + BORDER.fadeSeconds)).toBeCloseTo(BORDER.deeds.warContract / Math.E, 6);
    // Kills count on every front through a system.
    expect(recordDeed(s, 'ross-154', BORDER.deeds.raiderKill).map((f) => f.id)).toEqual([longBorder.id]);
    for (let i = 0; i < 40; i++) recordDeed(s, 'ross-154', 1);
    expect(s.world.border[longBorder.id]!.deeds).toHaveLength(BORDER.keep);
  });

  it('hand a fallen station to the Wake: lawful pilots get an emergency berth, its friends dock as usual', () => {
    const s = pilot();
    s.clock = clockIn(longBorder, 'fallen');
    expect(dockAccess(s, 'regent-concourse')).toBe('emergency');
    expect(dockAccess(s, 'waymark-waypoint')).toBe('full');
    expect(welcomeText(s, 'regent-concourse').text).toMatch(/held by the Hollow Wake/);
    s.reputation['hollow-wake'] = LAW.wakeFriendly;
    expect(dockAccess(s, 'regent-concourse')).toBe('full');
    // A held station posts no board, and no board anywhere asks for a delivery to a station that can
    // fall (a wreck's find may still be brought back to one: that is only a visit).
    expect(boardFor('regent-concourse', Math.floor(s.clock / CONTRACTS.epochSeconds))).toEqual([]);
    for (const l of ALL_LOCATIONS.filter((x) => x.systemId === 'ross-154' || x.systemId === 'barnard' || x.systemId === 'wolf-1061')) {
      for (let epoch = 0; epoch < 30; epoch++) {
        for (const c of boardFor(l.id, epoch)) {
          const docks = c.objectives.flatMap((o) => (o.kind === 'deliver' || (o.kind === 'visit' && o.locationId !== c.giverLocationId) ? [o.locationId] : []));
          for (const d of docks) expect(EXPOSED.has(d), `${c.id} → ${d}`).toBe(false);
        }
      }
    }
  });

  it('move the traffic: skirmishes bring guns to both sides, a blockade scares traders off, a truce quiets the lanes', () => {
    const base = trafficFor('ross-154', 'high').plan;
    const skirmish = trafficFor('ross-154', 'high', clockIn(longBorder, 'skirmish')).plan;
    expect(skirmish.patrolWings).toBeGreaterThanOrEqual(base.patrolWings);
    expect(skirmish.packs!.max).toBeGreaterThan(base.packs?.max ?? 0);
    const blockade = trafficFor('ross-154', 'high', clockIn(longBorder, 'blockade')).plan;
    expect(blockade.traders).toBeLessThan(base.traders);
    expect(blockade.packs!.max).toBeGreaterThan(base.packs?.max ?? 0);
    const s = pilot();
    s.world.border[longBorder.id] = { deeds: [], ending: 'truce' };
    expect(trafficFor('ross-154', 'high', clockIn(longBorder, 'blockade')).plan.packs).toBeNull();
  });

  it('make the news within three jumps, in words with nothing left to fill', () => {
    const t = clockIn(longBorder, 'blockade');
    const news = borderNews('barnard', t);
    expect(news.map((n) => n.state.front.id)).toContain(longBorder.id);
    for (const n of news) {
      expect(n.jumps).toBeLessThanOrEqual(BORDER.newsJumps);
      expect(`${n.headline} ${n.detail}`).not.toMatch(/\{|undefined|null/);
    }
    const jumps = jumpsFrom(WORLD.links, longBorder.lawSystem);
    const wake = jumpsFrom(WORLD.links, longBorder.wakeSystem);
    const far = SYSTEMS.find((x) => (jumps.get(x.id) ?? 99) > BORDER.newsJumps && (wake.get(x.id) ?? 99) > BORDER.newsJumps && !isFrontier(x.id))!;
    expect(borderNews(far.id, t).some((n) => n.state.front.id === longBorder.id)).toBe(false);
  });
});

describe('war contracts', () => {
  /** War contracts posted on a board over many time slots. */
  function warWork(locationId: string, epochs = 120): JobDef[] {
    const out: JobDef[] = [];
    for (let e = 0; e < epochs; e++) out.push(...boardFor(locationId, e).filter((c) => c.contract?.kind === 'war'));
    return out;
  }

  it('are posted by the law only while its front within reach fights, and push the front its way', () => {
    const law = warWork('regent-concourse');
    expect(law.length).toBeGreaterThan(0);
    for (const c of law) {
      expect(c.contract).toMatchObject({ kind: 'war', side: 'law' });
      const front = getFront(c.contract!.front!)!;
      expect(front.faction).toBe('sta');
      const o = c.objectives[0]!;
      expect(o.kind).toBe('bounty');
      if (o.kind === 'bounty') expect(o.systemId).toBe(front.lawSystem);
      const epoch = Number(c.id.split('.')[2]);
      expect(atWar(frontState(front, epoch * CONTRACTS.epochSeconds), 'law')).toBe(true);
    }
    // Completing one pushes the front toward the law.
    const s = pilot();
    const job = law[0]!;
    s.clock = Number(job.id.split('.')[2]) * CONTRACTS.epochSeconds;
    s.location = { systemId: 'ross-154', dockedAt: 'regent-concourse', flight: null, lastDockId: 'regent-concourse' };
    s.reputation.sta = 40;
    s.contracts[job.id] = structuredClone(job);
    s.jobs[job.id] = { status: 'active', objectiveIndex: 0, acceptedAt: s.clock, kills: 99 };
    const before = frontState(longBorder, s.clock).pressure;
    const events = advanceJobs(s, { dockedAt: null, systemId: 'ross-154' });
    expect(events.find((e) => e.kind === 'complete')!.text).toMatch(/shifts the TA’s way|shifts the .*’s way/);
    expect(frontState(longBorder, s.clock).pressure).toBeCloseTo(before + BORDER.deeds.warContract, 6);
  });

  it('are posted by the dens against the front faction’s haulers, and push the front the Wake’s way', () => {
    const wake = warWork('maw-roost');
    expect(wake.length).toBeGreaterThan(0);
    for (const c of wake) {
      expect(c.contract).toMatchObject({ kind: 'war', side: 'wake' });
      expect(c.repReward).toEqual({ 'hollow-wake': CONTRACTS.outlawWake.war });
      const front = getFront(c.contract!.front!)!;
      expect(c.objectives[0]).toMatchObject({ kind: 'piracy', systemId: front.lawSystem, faction: front.faction });
    }
    const s = pilot();
    const job = wake[0]!;
    s.clock = Number(job.id.split('.')[2]) * CONTRACTS.epochSeconds;
    s.contracts[job.id] = structuredClone(job);
    s.jobs[job.id] = { status: 'active', objectiveIndex: 0, acceptedAt: s.clock };
    const o = job.objectives[0]!;
    if (o.kind !== 'piracy') throw new Error('piracy expected');
    s.location = { systemId: o.systemId, dockedAt: null, flight: null, lastDockId: 'regent-concourse' };
    const front = getFront(job.contract!.front!)!;
    const before = frontState(front, s.clock).pressure;
    for (let i = 0; i < o.count; i++) countPiracy(s, o.systemId, o.faction);
    expect(done(s, job.id)).toBe(true);
    expect(frontState(front, s.clock).pressure).toBeCloseTo(before - BORDER.deeds.warContract, 6);
  });

  it('stop once The Long Border has settled the front', () => {
    const s = pilot();
    s.world.border[longBorder.id] = { deeds: [], ending: 'law' };
    const onFront = (id: string) => warWork(id, 60).filter((c) => c.contract?.front === longBorder.id);
    expect(onFront('regent-concourse')).toEqual([]);
    expect(onFront('maw-roost')).toEqual([]);
    // A settled front holds: deeds no longer move it.
    pushFront(s, longBorder.id, -500);
    expect(frontState(longBorder, 99_999)).toMatchObject({ phase: 'pushed-back', ending: 'law' });
  });
});

describe('The Long Border', () => {
  /** Plays the first three steps (recon, the letters) up to the choice at Waymark Waypoint. */
  function toTheChoice(s: GameState): void {
    dock(s, 'waymark-waypoint');
    expect(acceptJob(s, 'arc.border.1').ok).toBe(true);
    dock(s, 'flotsam-diggings');
    dock(s, 'waymark-waypoint');
    expect(done(s, 'arc.border.1')).toBe(true);
    expect(acceptJob(s, 'arc.border.2').ok).toBe(true);
    s.jobs['arc.border.2']!.recovered = true;
    advanceJobs(s, { dockedAt: null, systemId: 'wolf-1061' });
    dock(s, 'waymark-waypoint');
    expect(done(s, 'arc.border.2')).toBe(true);
    expect(acceptJob(s, 'arc.border.3').ok).toBe(true);
  }

  it('reads the choices made in the other three arcs', () => {
    const s = pilot();
    const first = ARC_JOBS.find((j) => j.id === 'arc.border.1')!;
    expect(briefingFor(s, first)).toBe(first.briefing);
    s.story.choices['sta.vail'] = 'bribe';
    s.story.choices['frontier.quarantine'] = 'seal';
    s.story.choices['wake.fiske'] = 'warn';
    const said = briefingFor(s, first);
    expect(said).toMatch(/sold my testimony/);
    expect(said).toMatch(/after the quarantine/);
    expect(said).toMatch(/Juno Fiske/);
  });

  it('can be finished as a lawful pilot: the line is the Authority’s for good', () => {
    const s = pilot();
    s.reputation.sta = 20;
    toTheChoice(s);
    const choice = currentObjective(s, 'arc.border.3');
    if (choice?.kind !== 'choice') throw new Error('a choice expected');
    // The Wake's side is only for its friends; the truce is open to everyone.
    expect(optionLock(s, choice.options.find((x) => x.id === 'wake')!)).toMatch(/Hollow Wake/);
    expect(optionLock(s, choice.options.find((x) => x.id === 'truce')!)).toBeNull();
    expect(makeChoice(s, 'arc.border.3', 'wake').ok).toBe(false);
    expect(makeChoice(s, 'arc.border.3', 'law').ok).toBe(true);
    // Only the law's branch shows.
    const ids = jobsAt(s, 'waymark-waypoint').map((o) => o.job.id);
    expect(ids).toContain('arc.border.4.law');
    expect(ids.some((id) => id === 'arc.border.4.wake' || id === 'arc.border.4.truce')).toBe(false);
    expect(acceptJob(s, 'arc.border.4.law').ok).toBe(true);
    s.jobs['arc.border.4.law']!.kills = 4;
    advanceJobs(s, { dockedAt: null, systemId: 'wolf-1061' });
    expect(done(s, 'arc.border.4.law')).toBe(true);
    expect(acceptJob(s, 'arc.border.5.law').ok).toBe(true);
    expect(arcStatus(s, 'border')).toMatchObject({ phase: 'active', step: 5, of: 5 });
    s.jobs['arc.border.5.law']!.kills = 5;
    advanceJobs(s, { dockedAt: null, systemId: 'ross-154' });
    expect(done(s, 'arc.border.5.law')).toBe(true);
    expect(arcStatus(s, 'border').phase).toBe('complete');
    expect(checkMilestones(s).map((m) => m.id)).toContain('story-border');
    // The tide no longer moves the front: the Authority holds it, and Regent Concourse never falls.
    for (let t = 0; t < BORDER.tide.periodSeconds; t += 3_600) {
      expect(frontState(longBorder, s.clock + t).phase).toBe('pushed-back');
      expect(occupied('regent-concourse', s.clock + t)).toBeNull();
    }
  });

  it('can be finished as an outlaw: Regent Concourse is the Wake’s for good', () => {
    const s = pilot();
    s.reputation['hollow-wake'] = 30;
    s.reputation.sta = -40;
    s.law.fines.sta = 900;
    // Hunted by the Authority, the outlaw still gets Kettering's work on an emergency berth.
    dock(s, 'waymark-waypoint');
    expect(dockAccess(s, 'waymark-waypoint')).toBe('emergency');
    expect(jobsAt(s, 'waymark-waypoint').map((o) => o.job.id)).toEqual(['arc.border.1']);
    toTheChoice(s);
    const choice = currentObjective(s, 'arc.border.3');
    if (choice?.kind !== 'choice') throw new Error('a choice expected');
    expect(optionLock(s, choice.options.find((x) => x.id === 'law')!)).toMatch(/Transit Authority/);
    expect(makeChoice(s, 'arc.border.3', 'wake').ok).toBe(true);
    expect(acceptJob(s, 'arc.border.4.wake').ok).toBe(true);
    s.location = { systemId: 'ross-154', dockedAt: null, flight: null, lastDockId: 'waymark-waypoint' };
    countPiracy(s, 'ross-154', 'sta');
    countPiracy(s, 'ross-154', 'sta');
    expect(done(s, 'arc.border.4.wake')).toBe(true);
    expect(acceptJob(s, 'arc.border.5.wake').ok).toBe(true);
    s.jobs['arc.border.5.wake']!.kills = 4;
    advanceJobs(s, { dockedAt: null, systemId: 'wolf-1061' });
    expect(done(s, 'arc.border.5.wake')).toBe(true);
    for (let t = 0; t < BORDER.tide.periodSeconds; t += 3_600) expect(occupied('regent-concourse', s.clock + t)?.id).toBe(longBorder.id);
    // Waymark Waypoint, Kettering's home, never falls: it takes in anyone, for repairs at least.
    expect(dockAccess(s, 'waymark-waypoint')).not.toBe('refused');
    expect(occupied('waymark-waypoint', s.clock)).toBeNull();
  });

  it('can be finished as neither: the envoys cross the line, and the truce quiets it', () => {
    const s = pilot();
    s.reputation.sta = -10;
    toTheChoice(s);
    // Wary of the Authority and no friend of the Wake: only the truce is open.
    const choice = currentObjective(s, 'arc.border.3');
    if (choice?.kind !== 'choice') throw new Error('a choice expected');
    expect(choice.options.filter((x) => !optionLock(s, x)).map((x) => x.id)).toEqual(['truce']);
    expect(makeChoice(s, 'arc.border.3', 'truce').ok).toBe(true);
    expect(acceptJob(s, 'arc.border.4.truce').ok).toBe(true);
    dock(s, 'regent-concourse');
    dock(s, 'flotsam-diggings');
    dock(s, 'waymark-waypoint');
    expect(done(s, 'arc.border.4.truce')).toBe(true);
    expect(acceptJob(s, 'arc.border.5.truce').ok).toBe(true);
    s.location.dockedAt = null;
    // The envoys set off in Ross 154 and keep with the player, to cross the line with them.
    expect(escortsIn(s, 'ross-154')).toEqual([expect.objectContaining({ jobId: 'arc.border.5.truce', follow: true, convoy: { names: ['Kettering Line II', 'Garrison cutter', 'Roost launch'], waves: 1 } })]);
    s.flags.clearance = true;
    const route = findRoute(SYSTEMS, 'ross-154', 'wolf-1061')!;
    expect(route.hops).toHaveLength(1);
    expect(performJump(s, route, route.totalFee).filter((e) => e.kind === 'failed')).toEqual([]);
    // Over the line, raiders wait at the beacon, and the envoys make for Flotsam Diggings.
    expect(escortsIn(s, 'wolf-1061')).toEqual([expect.objectContaining({ jobId: 'arc.border.5.truce', to: 'flotsam-diggings', beacon: true })]);
    expect(escortsIn(s, 'wolf-1061')[0]!.follow).toBeUndefined();
    escortArrived(s, 'arc.border.5.truce');
    escortArrived(s, 'arc.border.5.truce');
    escortArrived(s, 'arc.border.5.truce');
    expect(done(s, 'arc.border.5.truce')).toBe(true);
    expect(frontState(longBorder, s.clock + 50_000)).toMatchObject({ phase: 'truce', ending: 'truce' });
    expect(borderNews('ross-154', s.clock).find((n) => n.state.front.id === longBorder.id)!.headline).toMatch(/truce/i);
  });
});

describe('fronts that end (docs/PROCGEN.md §20.7)', () => {
  const ended = FRONTS.filter((f) => !STORY_FRONTS.has(f.id));
  /** Boards that may post a front's law operation: its faction's stations with a job board within reach of the lawful system. */
  const lawPosters = (f: Front) =>
    ALL_LOCATIONS.filter(
      (l) => l.status === 'functional' && l.services.includes('contracts') && l.factionId === f.faction && (jumpsFrom(WORLD.links, l.systemId).get(f.lawSystem) ?? 99) <= BORDER.campaign.law.maxJumps,
    );
  const decisiveAt = (locationId: string, epoch: number) => boardFor(locationId, epoch).filter((c) => c.contract?.decisive);
  /** A pilot whose war work on a front came to `amount` (three contracts' worth) at clock 0; the boards of time slot 1 see it. */
  function earned(f: Front, amount: number): GameState {
    const s = pilot();
    for (let i = 0; i < 3; i++) pushFront(s, f.id, amount / 3);
    s.clock = CONTRACTS.epochSeconds;
    return s;
  }
  /** Takes a posted contract on and flies it through. */
  function fly(s: GameState, job: JobDef): void {
    s.contracts[job.id] = structuredClone(job);
    s.jobs[job.id] = { status: 'active', objectiveIndex: 0, acceptedAt: s.clock };
    const o = job.objectives[0]!;
    if (o.kind === 'assault') s.jobs[job.id]!.assault = 'done';
    if (o.kind === 'defend') s.jobs[job.id]!.kills = o.count;
    if (o.kind !== 'assault' && o.kind !== 'defend') throw new Error(`unexpected ${o.kind}`);
    s.location = { systemId: o.systemId, dockedAt: null, flight: null, lastDockId: s.location.lastDockId };
    advanceJobs(s, { dockedAt: null, systemId: o.systemId });
  }

  it('are the four fronts no story settles, each with a law station to ask and a den to answer', () => {
    expect(STORY_FRONTS).toEqual(new Set([LONG_BORDER_FRONT]));
    expect(ended).toHaveLength(4);
    for (const f of ended) expect(lawPosters(f).length, f.id).toBeGreaterThan(0);
  });

  it('offer each side its decisive operation only once the pilot’s own deeds have earned it', () => {
    for (const f of ended) {
      // Nothing without the momentum, on any board, in any time slot.
      pilot();
      for (let e = 0; e < 40; e++) for (const l of [...lawPosters(f), getLocation(f.denId)]) expect(decisiveAt(l.id, e)).toEqual([]);
      useWorldLog(null);
      // The law's: its stations ask for the den across the line knocked out, with a wing of theirs.
      earned(f, 54);
      for (const l of lawPosters(f)) {
        const [op] = decisiveAt(l.id, 1);
        expect(op, `${f.id} at ${l.id}`).toBeDefined();
        expect(op!.contract).toMatchObject({ kind: 'war', front: f.id, side: 'law', decisive: true });
        expect(op!.objectives).toEqual([expect.objectContaining({ kind: 'assault', systemId: f.wakeSystem, locationId: f.denId })]);
        expect(op!.difficulty).toBe(3);
        expect(op!.repReward['hollow-wake']).toBe(BORDER.campaign.law.wakeStanding);
        expect(op!.reward).toBeGreaterThanOrEqual(BORDER.campaign.law.pay * CONTRACTS.payVariation[0]);
        expect(op!.reward).toBeLessThanOrEqual(MAX_REWARD);
      }
      expect(decisiveAt(f.denId, 1)).toEqual([]);
      useWorldLog(null);
      // The Wake's: the den asks a pilot it trusts to hold it against the faction's last sweep.
      earned(f, -54);
      const [hold] = decisiveAt(f.denId, 1);
      expect(hold?.contract).toMatchObject({ kind: 'war', front: f.id, side: 'wake', decisive: true });
      expect(hold!.objectives).toEqual([expect.objectContaining({ kind: 'defend', systemId: f.wakeSystem, locationId: f.denId, count: BORDER.campaign.wake.sweep, faction: f.faction })]);
      expect(hold!.repReward).toEqual({ 'hollow-wake': BORDER.campaign.wake.wakeStanding });
      expect(hold!.reward).toBeLessThanOrEqual(MAX_REWARD);
      for (const l of lawPosters(f)) expect(decisiveAt(l.id, 1)).toEqual([]);
      useWorldLog(null);
    }
    // Too little, or faded with time, is not enough.
    const f = ended[0]!;
    earned(f, 30);
    expect(decisiveAt(lawPosters(f)[0]!.id, 1)).toEqual([]);
    const s = earned(f, 54);
    const later = Math.ceil((BORDER.fadeSeconds * Math.log(54 / BORDER.campaign.momentum)) / CONTRACTS.epochSeconds) + 2;
    expect(decisiveAt(lawPosters(f)[0]!.id, later)).toEqual([]);
    // The Long Border's front is left to its story, whatever the pilot does there.
    pushFront(s, LONG_BORDER_FRONT, 200);
    for (const l of ALL_LOCATIONS.filter((x) => x.systemId === longBorder.lawSystem || x.id === longBorder.denId)) expect(decisiveAt(l.id, 1)).toEqual([]);
  });

  it('done for the law, hold the front for good: the den’s raids stop, war work ends, and the lanes around it prosper', () => {
    const f = getFront('gj-1~yz-ceti')!;
    const s = earned(f, 54);
    s.reputation.frontier = 30;
    const [op] = decisiveAt(lawPosters(f)[0]!.id, 1);
    // Knocking out a den asks for a combat record, as any den assault does.
    expect(acceptJob(s, op!.id)).toEqual({ ok: false, message: expect.stringMatching(/combat rating/) });
    const before = quote('hearthstone-works', 'machinery', s.reputation, marketContext(s)).buy!;
    const slot = Number(op!.id.split('.')[2]);
    const posted = new Map(boardFor(lawPosters(f)[0]!.id, slot).map((c) => [c.id, c.title]));
    fly(s, op!);
    expect(done(s, op!.id)).toBe(true);
    expect(s.world.border[f.id]?.ending).toBe('law');
    // The same time slot's board changes (the operation goes, a run comes), and no id is reused for another contract.
    for (const c of boardFor(lawPosters(f)[0]!.id, slot)) if (posted.has(c.id)) expect(c.title).toBe(posted.get(c.id));
    for (let t = 0; t < BORDER.tide.periodSeconds; t += 3_600) {
      expect(frontState(f, s.clock + t).phase).toBe('pushed-back');
      expect(occupied('hearthstone-works', s.clock + t)).toBeNull();
    }
    // Its marks: the lawful system's stations and the free port across the line ship more, for good.
    expect(Object.keys(s.world.marks ?? {}).sort()).toEqual(['front.law.hearthstone-works', 'front.law.heather-smelter', 'front.law.hitching-freeport']);
    expect(quote('hearthstone-works', 'machinery', s.reputation, marketContext(s)).buy!).toBeLessThan(before);
    const epoch = boardEpoch(s.clock) + 1;
    expect(boardFor('hearthstone-works', epoch).some((c) => c.title.startsWith('Reopened lanes: '))).toBe(true);
    // No more war work on it, and no second decisive operation.
    for (let e = epoch; e < epoch + 40; e++) {
      for (const l of [...lawPosters(f), getLocation(f.denId)]) expect(boardFor(l.id, e).filter((c) => c.contract?.front === f.id)).toEqual([]);
    }
    expect(borderNews('yz-ceti', s.clock).find((n) => n.state.front.id === f.id)?.headline).toMatch(/holds the YZ Ceti – GJ 1 line/);
  });

  it('done for the Wake, give it the line for good: a station falls, or the lanes stay blockaded', () => {
    const yz = getFront('gj-1~yz-ceti')!;
    const s = earned(yz, -54);
    s.reputation['hollow-wake'] = 30;
    const [hold] = decisiveAt(yz.denId, 1);
    fly(s, hold!);
    expect(done(s, hold!.id)).toBe(true);
    expect(s.world.border[yz.id]?.ending).toBe('wake');
    expect(occupied('hearthstone-works', s.clock + BORDER.tide.periodSeconds / 3)?.id).toBe(yz.id);
    expect(Object.keys(s.world.marks ?? {}).sort()).toEqual(['front.wake.cutlass-nest', 'front.wake.heather-smelter']);
    // A front with no station to lose is blockaded for good instead, and the news says so.
    const wise = getFront('yz-canis-minoris~wise-0722-0540')!;
    useWorldLog(null);
    const t = earned(wise, -54);
    t.reputation['hollow-wake'] = 30;
    const [hold2] = decisiveAt(wise.denId, 1);
    fly(t, hold2!);
    expect(frontState(wise, t.clock + 12_345)).toMatchObject({ phase: 'blockade', ending: 'wake' });
    const words = borderNews('wise-0722-0540', t.clock).find((n) => n.state.front.id === wise.id)!;
    expect(words.headline).toMatch(/holds the lanes into WISE 0722−0540/);
    expect(words.detail).toMatch(/For good/);
  });

  it('are never offered on a front once it is settled, and a settled front left before them gets its marks on load', () => {
    const f = getFront('gj-1~yz-ceti')!;
    const s = earned(f, 54);
    s.reputation.frontier = 30;
    const [op] = decisiveAt(lawPosters(f)[0]!.id, 1);
    s.world.border[f.id] = { deeds: s.world.border[f.id]!.deeds, ending: 'wake' };
    expect(contractBlock(s, op!)).toBe('That front is settled');
    // The Long Border settled the line before fronts left marks: on load, the marks come.
    const old = pilot();
    old.world.border[LONG_BORDER_FRONT] = { deeds: [], ending: 'law' };
    markSettledFronts(old);
    expect(Object.keys(old.world.marks ?? {}).sort()).toEqual(['front.law.flotsam-diggings', 'front.law.jackpot-stillworks', 'front.law.regent-concourse', 'front.law.waymark-waypoint']);
    const truce = pilot();
    truce.world.border[LONG_BORDER_FRONT] = { deeds: [], ending: 'truce' };
    markSettledFronts(truce);
    expect(truce.world.marks).toBeUndefined();
  });

  it('leave marks that pass the guardrails, and broken ones are caught', () => {
    const marks = allMarks().filter((m) => m.front);
    expect(validateMarks()).toEqual([]);
    for (const f of FRONTS) {
      expect(marks.some((m) => m.front!.ending === 'law' && m.front!.ids.includes(f.id)), `${f.id} law`).toBe(true);
      expect(marks.some((m) => m.front!.ending === 'wake' && m.front!.ids.includes(f.id)), `${f.id} wake`).toBe(true);
    }
    // Every run a mark promises is on its station's board once the mark is left (its fronts settled that way).
    for (const mark of allMarks().filter((x) => x.run)) {
      const s = pilot();
      s.world.marks = { [mark.id]: 0 };
      for (const id of mark.front?.ids ?? []) s.world.border[id] = { deeds: [], ending: mark.front!.ending };
      const runs = [0, 1, 2].flatMap((e) => boardFor(mark.locationId, e)).filter((c) => c.title.startsWith(`${mark.run!.title}: `));
      expect(runs.length, mark.id).toBe(3);
      expect(runs.every((c) => c.destinationLocationId === mark.run!.to), mark.id).toBe(true);
      useWorldLog(null);
    }
    const m = marks[0]!;
    const rules = (broken: typeof m) => validateMarks([...allMarks().filter((x) => x.id !== m.id), broken]).map((i) => i.message);
    expect(rules({ ...m, front: { ids: ['nowhere~nothing'], ending: 'law' } })).toContain('left by a border front that does not exist');
    expect(rules({ ...m, market: { ...m.market, price: 0.4 } })).toContain('price or stock out of bounds');
    expect(rules({ ...m, locationId: 'maw-roost', market: { ...m.market, goods: ['habitat-modules'] } })).toContain('changes goods the station does not trade');
  });
});

describe('border saves', () => {
  it('keep the border log, and reject a damaged one', () => {
    const s = pilot();
    pushFront(s, longBorder.id, 5);
    s.world.border['gj-1~yz-ceti'] = { deeds: [], ending: 'wake' };
    const back = migrateSave(JSON.parse(JSON.stringify(s)));
    expect(back.world.border).toEqual(s.world.border);
    expect(() => migrateSave({ ...structuredClone(s), world: { ...s.world, border: { x: { deeds: [['a', 1]] } } } })).toThrow();
    expect(() => migrateSave({ ...structuredClone(s), world: { ...s.world, border: { x: { deeds: [], ending: 'draw' } } } })).toThrow();
  });
});
