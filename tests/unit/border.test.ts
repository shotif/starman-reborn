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
import { atWar, borderNews, deedsAt, EXPOSED, FRONTS, frontState, getFront, occupied, pushFront, recordDeed, tideAt, type Front } from '../../src/economy/border.ts';
import { boardFor } from '../../src/economy/contracts.ts';
import { welcomeText } from '../../src/economy/dockText.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { acceptJob, advanceJobs, countPiracy, currentObjective, escortArrived, escortsIn, jobsAt, type JobDef } from '../../src/economy/jobs.ts';
import { dockAccess } from '../../src/economy/law.ts';
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
