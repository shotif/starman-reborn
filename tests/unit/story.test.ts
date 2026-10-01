import { describe, expect, it } from 'vitest';
import { dockAt } from '../../src/app/rules.ts';
import { migrateSave } from '../../src/app/save/migrate.ts';
import { createNewGame, type GameState } from '../../src/app/state.ts';
import { LAW } from '../../src/content/law/rules.ts';
import { ARC_JOBS } from '../../src/content/story/arcs.ts';
import { getLocation, getSystem, SYSTEMS } from '../../src/data/systems.ts';
import { cargoCount } from '../../src/economy/cargo.ts';
import { acceptJob, advanceJobs, countPiracy, currentObjective, deliverJob, escortArrived, escortLost, escortsIn, getJob, handOver, jobsAt, leaveSystem, rescuesIn } from '../../src/economy/jobs.ts';
import { performJump } from '../../src/app/rules.ts';
import { findRoute } from '../../src/galaxy/routing.ts';
import { checkMilestones } from '../../src/economy/progress.ts';
import { arcStatus, briefingFor, choiceHere, debriefFor, denDown, knockOutDen, makeChoice, markSeen, pendingBeats, storyWaiting } from '../../src/economy/story.ts';
import { validateStory } from '../../src/economy/storyGuards.ts';
import { DENS } from '../../src/content/dens/rules.ts';

/** Story arcs (docs/PROCGEN.md §14): three faction arcs played through with the game's own rules. */

function pilot(): GameState {
  const s = createNewGame(17);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 20_000;
  return s;
}

/** Flies (instantly) to a station and docks there. */
function dock(s: GameState, locationId: string) {
  s.location.systemId = getLocation(locationId).systemId;
  return dockAt(s, locationId).jobEvents;
}

function inSpace(s: GameState, systemId: GameState['location']['systemId']) {
  s.location.systemId = systemId;
  s.location.dockedAt = null;
  return advanceJobs(s, { dockedAt: null, systemId });
}

const done = (s: GameState, id: string) => s.jobs[id]?.status === 'complete';

describe('story arcs', () => {
  it('pass their guardrails', () => {
    expect(validateStory()).toEqual([]);
  });

  it('catch broken arcs', () => {
    const broken = (edit: (jobs: typeof ARC_JOBS extends readonly (infer J)[] ? J[] : never) => void) => {
      const jobs = structuredClone(ARC_JOBS) as (typeof ARC_JOBS)[number][];
      edit(jobs);
      return validateStory(jobs).map((i) => i.rule);
    };
    const job = (jobs: (typeof ARC_JOBS)[number][], id: string) => jobs.find((j) => j.id === id)!;
    // A missing step breaks the chain.
    expect(broken((jobs) => jobs.splice(jobs.findIndex((j) => j.id === 'arc.sta.2'), 1))).toContain('chain');
    // A lawful arc asking for piracy.
    expect(broken((jobs) => (job(jobs, 'arc.frontier.2').objectives = [{ kind: 'piracy', systemId: 'procyon', faction: 'frontier', count: 1, text: 'x' }]))).toContain('law');
    // A lawful mission sending the pilot to dock at a raider den.
    expect(broken((jobs) => (job(jobs, 'arc.sta.1').objectives[0] = { kind: 'visit', locationId: 'maw-roost', text: 'x' }))).toContain('places');
    // Somewhere out of reach.
    expect(broken((jobs) => (job(jobs, 'arc.sta.1').objectives[0] = { kind: 'visit', locationId: 'wildcard-haven', text: 'x' }))).toContain('reach');
    // An escort may set off in another system, but not more than two jumps from where it is going.
    expect(broken(() => {})).toEqual([]);
    expect(broken((jobs) => {
      const o = job(jobs, 'arc.border.5.truce').objectives[0]!;
      if (o.kind === 'escort') job(jobs, 'arc.border.5.truce').objectives[0] = { ...o, fromLocationId: 'earth-port' };
    })).toContain('places');
    // A choice where every way ends the arc, or the next step does not follow the ways on.
    expect(broken((jobs) => {
      const o = job(jobs, 'arc.sta.4').objectives[0]!;
      if (o.kind === 'choice') for (const x of o.options) x.ends = true;
    })).toContain('choice');
    expect(broken((jobs) => (job(jobs, 'arc.frontier.5').requires!.choice = { id: 'frontier.quarantine', oneOf: ['seal'] }))).toContain('choice');
    // Words for a choice that has none, and a stranger speaking.
    expect(broken((jobs) => delete (job(jobs, 'arc.wake.5').story!.variant!.briefing as Record<string, string>).warn)).toContain('text');
    expect(broken((jobs) => (job(jobs, 'arc.sta.1').story!.debrief = [{ who: 'nobody' as 'salt', text: 'x' }]))).toContain('text');
    // A finale that pays less than the step before it.
    expect(broken((jobs) => (job(jobs, 'arc.sta.5').reward = 500))).toContain('pay');
    // The Wake's arc open to anyone.
    expect(broken((jobs) => delete job(jobs, 'arc.wake.1').requires)).toContain('law');
  });

  it('show only the step in hand of each arc: the first, then each next one once the step before is done', () => {
    const s = createNewGame(3);
    const ids = (loc: string) => jobsAt(s, loc).map((o) => o.job.id).filter((id) => id.startsWith('arc.'));
    expect(ids('earth-port')).toEqual(['arc.sta.1']);
    expect(jobsAt(s, 'earth-port').find((o) => o.job.id === 'arc.sta.1')!.status).toBe('locked');
    s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
    expect(jobsAt(s, 'earth-port').find((o) => o.job.id === 'arc.sta.1')!.status).toBe('available');
    expect(ids('meridian-outpost')).toEqual(['arc.frontier.1']);
    expect(ids('dawnfield-institute')).toEqual([]);
    s.jobs['arc.sta.1'] = { status: 'active', objectiveIndex: 0, acceptedAt: 0 };
    expect(ids('earth-port')).toEqual(['arc.sta.1']);
    // Done, a step leaves the board (the journal keeps it) and the next one shows.
    s.jobs['arc.sta.1'] = { status: 'complete', objectiveIndex: 2, acceptedAt: 0 };
    expect(ids('earth-port')).toEqual(['arc.sta.2']);
  });

  it('Clean Manifests: an audit, a wreck, a witness, a choice and a den assault', () => {
    const s = pilot();
    expect(storyWaiting(s)?.job.id).toBe('arc.sta.1');
    expect(acceptJob(s, 'arc.sta.1').ok).toBe(true);
    expect(arcStatus(s, 'sta')).toMatchObject({ phase: 'active', step: 1, of: 5 });
    dock(s, 'barnard-relay');
    // Words at the relay, told once.
    const beats = pendingBeats(s, false);
    expect(beats.map((b) => b.key)).toEqual(['arc.sta.1:b0']);
    markSeen(s, beats);
    expect(pendingBeats(s, false)).toEqual([]);
    dock(s, 'earth-port');
    expect(done(s, 'arc.sta.1')).toBe(true);
    expect(pendingBeats(s, false).map((b) => b.kind)).toEqual(['debrief']);

    expect(acceptJob(s, 'arc.sta.2').ok).toBe(true);
    s.location.dockedAt = null;
    inSpace(s, 'ross-154');
    expect(pendingBeats(s, true).map((b) => b.key)).toContain('arc.sta.2:c0');
    s.jobs['arc.sta.2']!.recovered = true;
    advanceJobs(s, { dockedAt: null, systemId: 'ross-154' });
    dock(s, 'earth-port');
    expect(done(s, 'arc.sta.2')).toBe(true);

    expect(acceptJob(s, 'arc.sta.3').ok).toBe(true);
    dock(s, 'waymark-waypoint');
    expect(currentObjective(s, 'arc.sta.3')).toMatchObject({ kind: 'escort', shipName: 'Kettering Line II' });
    s.location.dockedAt = null;
    escortArrived(s, 'arc.sta.3');
    expect(done(s, 'arc.sta.3')).toBe(true);

    expect(acceptJob(s, 'arc.sta.4').ok).toBe(true);
    s.location.systemId = 'sol';
    s.location.dockedAt = 'earth-port';
    expect(choiceHere(s, 'earth-port')?.job.id).toBe('arc.sta.4');
    const credits = s.credits;
    const sta = s.reputation.sta;
    const out = makeChoice(s, 'arc.sta.4', 'internal');
    expect(out.ok).toBe(true);
    expect(s.credits).toBe(credits + 1_200);
    expect(s.reputation.sta).toBe(sta + 12);
    expect(done(s, 'arc.sta.4')).toBe(true);
    // The finale speaks of the choice made.
    const finale = ARC_JOBS.find((j) => j.id === 'arc.sta.5')!;
    expect(briefingFor(s, finale)).toMatch(/off the record/);
    expect(acceptJob(s, 'arc.sta.5').ok).toBe(true);
    s.jobs['arc.sta.5']!.assault = 'done';
    advanceJobs(s, { dockedAt: null, systemId: 'wolf-1061' });
    expect(done(s, 'arc.sta.5')).toBe(true);
    expect(debriefFor(s, finale)[0]!.text).toMatch(/officially nothing happened/);
    expect(arcStatus(s, 'sta').phase).toBe('complete');
    expect(checkMilestones(s).map((m) => m.id)).toContain('story-sta');
  });

  it('a choice can end an arc: selling the evidence pays, and no finale ever comes', () => {
    const s = pilot();
    for (const id of ['arc.sta.1', 'arc.sta.2', 'arc.sta.3']) s.jobs[id] = { status: 'complete', objectiveIndex: 2, acceptedAt: 0 };
    expect(acceptJob(s, 'arc.sta.4').ok).toBe(true);
    s.location.dockedAt = 'earth-port';
    expect(makeChoice(s, 'arc.sta.4', 'bribe').ok).toBe(true);
    const status = arcStatus(s, 'sta');
    expect(status.phase).toBe('ended');
    expect(status.endedBy?.id).toBe('bribe');
    expect(jobsAt(s, 'earth-port').some((o) => o.job.id === 'arc.sta.5')).toBe(false);
    expect(acceptJob(s, 'arc.sta.5').ok).toBe(false);
  });

  it('choices are made at their dock, once', () => {
    const s = pilot();
    for (const id of ['arc.frontier.1', 'arc.frontier.2', 'arc.frontier.3']) s.jobs[id] = { status: 'complete', objectiveIndex: 2, acceptedAt: 0 };
    s.location = { systemId: 'procyon', dockedAt: 'stonecrop-gardens', flight: null, lastDockId: 'stonecrop-gardens' };
    expect(acceptJob(s, 'arc.frontier.4').ok).toBe(true);
    s.location.dockedAt = 'dawnfield-institute';
    expect(makeChoice(s, 'arc.frontier.4', 'seal').ok).toBe(false);
    s.location.dockedAt = 'stonecrop-gardens';
    expect(makeChoice(s, 'arc.frontier.4', 'nonsense').ok).toBe(false);
    expect(makeChoice(s, 'arc.frontier.4', 'burn').ok).toBe(true);
    expect(makeChoice(s, 'arc.frontier.4', 'seal').ok).toBe(false);
    expect(s.story.choices['frontier.quarantine']).toBe('burn');
  });

  it('The Stonecrop Blight: clean water, and a convoy that must bring two ships of three home', () => {
    const s = pilot();
    expect(acceptJob(s, 'arc.frontier.1').ok).toBe(true);
    dock(s, 'stonecrop-gardens');
    dock(s, 'dawnfield-institute');
    expect(done(s, 'arc.frontier.1')).toBe(true);
    expect(acceptJob(s, 'arc.frontier.2').ok).toBe(true);
    s.ship.cargo.water = 6;
    dock(s, 'stonecrop-gardens');
    expect(deliverJob(s, 'arc.frontier.2', 'stonecrop-gardens')).toMatchObject({ ok: true, reward: 900 });
    s.jobs['arc.frontier.3'] = { status: 'complete', objectiveIndex: 2, acceptedAt: 0 };
    s.jobs['arc.frontier.4'] = { status: 'complete', objectiveIndex: 1, acceptedAt: 0 };
    s.story.choices['frontier.quarantine'] = 'seal';
    s.location.dockedAt = 'dawnfield-institute';
    expect(acceptJob(s, 'arc.frontier.5').ok).toBe(true);
    // Two lost of three: the convoy fails, and the mission goes back to Ansari.
    expect(escortLost(s, 'arc.frontier.5').map((e) => e.kind)).toEqual(['objective']);
    const failed = escortLost(s, 'arc.frontier.5');
    expect(failed.map((e) => e.kind)).toEqual(['failed']);
    expect(failed[0]!.text).toMatch(/another try/);
    expect(s.jobs['arc.frontier.5']).toBeUndefined();
    // Again: one lost, two in.
    expect(acceptJob(s, 'arc.frontier.5').ok).toBe(true);
    escortArrived(s, 'arc.frontier.5');
    escortLost(s, 'arc.frontier.5');
    expect(done(s, 'arc.frontier.5')).toBe(false);
    escortArrived(s, 'arc.frontier.5');
    expect(done(s, 'arc.frontier.5')).toBe(true);
    expect(arcStatus(s, 'frontier').phase).toBe('complete');
  });

  it('a story escort left behind goes back to its giver instead of failing for good', () => {
    const s = pilot();
    for (const id of ['arc.sta.1', 'arc.sta.2']) s.jobs[id] = { status: 'complete', objectiveIndex: 2, acceptedAt: 0 };
    acceptJob(s, 'arc.sta.3');
    dock(s, 'waymark-waypoint');
    s.location.dockedAt = null;
    expect(leaveSystem(s, 'ross-154').map((e) => e.kind)).toEqual(['failed']);
    expect(s.jobs['arc.sta.3']).toBeUndefined();
    expect(jobsAt(s, 'earth-port').find((o) => o.job.id === 'arc.sta.3')?.status).toBe('available');
  });

  it('Salt’s Crew: for pilots the Wake trusts; contraband to carry, haulers to take, and a traitor', () => {
    const s = pilot();
    s.location = { systemId: '70-ophiuchi', dockedAt: 'graveyard-nest', flight: null, lastDockId: 'graveyard-nest' };
    expect(acceptJob(s, 'arc.wake.1').ok).toBe(false);
    s.reputation['hollow-wake'] = LAW.wakeFriendly;
    expect(acceptJob(s, 'arc.wake.1').ok).toBe(true);
    expect(cargoCount(s.ship.cargo, 'spoofers')).toBe(6);
    dock(s, 'regent-concourse');
    expect(deliverJob(s, 'arc.wake.1', 'regent-concourse').ok).toBe(true);
    dock(s, 'graveyard-nest');
    expect(done(s, 'arc.wake.1')).toBe(true);
    expect(acceptJob(s, 'arc.wake.2').ok).toBe(true);
    inSpace(s, 'ross-154');
    countPiracy(s, 'ross-154', 'sta');
    countPiracy(s, 'ross-154', 'sta');
    expect(done(s, 'arc.wake.2')).toBe(true);
    s.jobs['arc.wake.3'] = { status: 'complete', objectiveIndex: 2, acceptedAt: 0 };
    // Selling Salt out is a pardon from the law, and the end of the arc.
    s.law.fines.sta = 2_000;
    s.reputation.sta = -60;
    dock(s, 'graveyard-nest');
    expect(acceptJob(s, 'arc.wake.4').ok).toBe(true);
    expect(makeChoice(s, 'arc.wake.4', 'betray').ok).toBe(true);
    expect(s.law.fines).toEqual({});
    expect(s.reputation.sta).toBe(LAW.pardonFloor + 20);
    expect(arcStatus(s, 'wake').phase).toBe('ended');
  });

  it('the Wake’s finale counts sweep ships downed', () => {
    const s = pilot();
    s.reputation['hollow-wake'] = 40;
    for (const id of ['arc.wake.1', 'arc.wake.2', 'arc.wake.3', 'arc.wake.4']) s.jobs[id] = { status: 'complete', objectiveIndex: 2, acceptedAt: 0 };
    s.story.choices['wake.fiske'] = 'loyal';
    s.location = { systemId: '70-ophiuchi', dockedAt: 'graveyard-nest', flight: null, lastDockId: 'graveyard-nest' };
    expect(acceptJob(s, 'arc.wake.5').ok).toBe(true);
    s.jobs['arc.wake.5']!.kills = 4;
    advanceJobs(s, { dockedAt: null, systemId: '70-ophiuchi' });
    expect(done(s, 'arc.wake.5')).toBe(true);
  });

  it('a den knocked out stays dark for a while, then is rebuilt', () => {
    const s = pilot();
    knockOutDen(s, 'maw-roost');
    expect(denDown(s, 'maw-roost')).toBe(true);
    s.clock += DENS.downSeconds;
    expect(denDown(s, 'maw-roost')).toBe(false);
  });
});

describe('First Harvest, out among the frontier farms (docs/PROCGEN.md §14.6)', () => {
  /** Through the choice, with the harvest ready to go. */
  function toTheHarvest(s: GameState) {
    dock(s, 'squall-relay');
    expect(jobsAt(s, 'squall-relay').map((o) => o.job.id)).toContain('arc.harvest.1');
    expect(acceptJob(s, 'arc.harvest.1').ok).toBe(true);
    dock(s, 'harrow-farmstead');
    expect(done(s, 'arc.harvest.1')).toBe(true);
    // Dead in the water: the drive parts are handed over at the farm, and taken out to the Wrenna in Achird.
    expect(acceptJob(s, 'arc.harvest.2').ok).toBe(true);
    expect(cargoCount(s.ship.cargo, 'ship-parts')).toBe(4);
    inSpace(s, 'achird');
    expect(rescuesIn(s, 'achird')).toEqual([{ jobId: 'arc.harvest.2', name: 'Wrenna', model: 'ship.freighter.1.halden', commodity: 'ship-parts', qty: 4, guard: 1 }]);
    expect(handOver(s, 'arc.harvest.2').missing).toBe(0);
    expect(cargoCount(s.ship.cargo, 'ship-parts')).toBe(0);
    expect(pendingBeats(s, true).some((b) => b.lines.some((l) => l.text.includes('drive’s turning over')))).toBe(true);
    dock(s, 'harrow-farmstead');
    expect(done(s, 'arc.harvest.2')).toBe(true);
    // Readings: a confirmed planet and a contested one, and the contested one stays contested.
    expect(acceptJob(s, 'arc.harvest.3').ok).toBe(true);
    s.discoveredBodies.push('hd-219134-d', 'hd-219134-f');
    inSpace(s, 'hd-219134');
    dock(s, 'curlew-institute');
    expect(done(s, 'arc.harvest.3')).toBe(true);
    const words = pendingBeats(s, false).flatMap((b) => b.lines.map((l) => l.text)).join(' ');
    expect(words).toMatch(/the archives disagree, and a farm’s instruments won’t settle that/);
    expect(getSystem('hd-219134').confirmedBodies.find((p) => p.id === 'hd-219134-f')?.status).toBe('contested');
    dock(s, 'harrow-farmstead');
    expect(acceptJob(s, 'arc.harvest.4').ok).toBe(true);
  }

  it('is given at Squall Relay, at the core’s edge, after the opening delivery, and needs nobody’s standing', () => {
    const fresh = createNewGame(17);
    fresh.location = { ...fresh.location, systemId: 'ev-lacertae', dockedAt: 'squall-relay' };
    expect(jobsAt(fresh, 'squall-relay').find((o) => o.job.id === 'arc.harvest.1')?.status ?? 'locked').toBe('locked');
    const s = pilot();
    s.reputation = { sta: -40, frontier: -40, 'hollow-wake': -40 };
    dock(s, 'squall-relay');
    expect(jobsAt(s, 'squall-relay').map((o) => o.job.id)).toContain('arc.harvest.1');
    expect(briefingFor(s, getJob('arc.harvest.1', s))).toMatch(/long-range jump drive/);
  });

  it('can end at Doppler Freeport: the harvest convoy crosses with the player, and the milestone is earned', () => {
    const s = pilot();
    toTheHarvest(s);
    expect(makeChoice(s, 'arc.harvest.4', 'freeport').ok).toBe(true);
    expect(jobsAt(s, 'harrow-farmstead').map((o) => o.job.id)).toEqual(expect.arrayContaining(['arc.harvest.5.freeport']));
    expect(jobsAt(s, 'harrow-farmstead').map((o) => o.job.id)).not.toContain('arc.harvest.5.relay');
    expect(acceptJob(s, 'arc.harvest.5.freeport').ok).toBe(true);
    s.location.dockedAt = null;
    expect(escortsIn(s, 'hd-219134')).toEqual([expect.objectContaining({ follow: true, convoy: { names: ['Wrenna', 'Furrow', 'Late Swallow'], waves: 1 } })]);
    const route = findRoute(SYSTEMS, 'hd-219134', 'achird')!;
    performJump(s, route, route.totalFee);
    expect(escortsIn(s, 'achird')).toEqual([expect.objectContaining({ to: 'doppler-freeport', beacon: true })]);
    escortArrived(s, 'arc.harvest.5.freeport');
    escortArrived(s, 'arc.harvest.5.freeport');
    escortLost(s, 'arc.harvest.5.freeport');
    expect(done(s, 'arc.harvest.5.freeport')).toBe(true);
    expect(arcStatus(s, 'harvest').phase).toBe('complete');
    expect(checkMilestones(s).map((m) => m.id)).toContain('story-harvest');
  });

  it('can end at Squall Relay instead, across the core’s edge', () => {
    const s = pilot();
    toTheHarvest(s);
    const before = s.reputation.frontier;
    expect(makeChoice(s, 'arc.harvest.4', 'relay').ok).toBe(true);
    expect(s.reputation.frontier).toBe(before + 5);
    expect(acceptJob(s, 'arc.harvest.5.relay').ok).toBe(true);
    s.location.dockedAt = null;
    const route = findRoute(SYSTEMS, 'hd-219134', 'ev-lacertae')!;
    expect(route.hops).toHaveLength(1);
    performJump(s, route, route.totalFee);
    expect(escortsIn(s, 'ev-lacertae')).toEqual([expect.objectContaining({ to: 'squall-relay', beacon: true })]);
    for (let i = 0; i < 3; i++) escortArrived(s, 'arc.harvest.5.relay');
    expect(done(s, 'arc.harvest.5.relay')).toBe(true);
    expect(debriefFor(s, getJob('arc.harvest.5.relay', s))[0]!.who).toBe('halloway');
  });
});

describe('story saves', () => {
  it('upgrade a v7 save with no choices and no dens down, and reject damaged story data', () => {
    const { story: _s, dens: _d, ...rest } = createNewGame(5);
    const v7 = { ...structuredClone(rest), version: 7 };
    const s = migrateSave(v7);
    expect(s.story).toEqual({ choices: {}, seen: [] });
    expect(s.dens).toEqual({});
    expect(() => migrateSave({ ...structuredClone(s), story: { choices: { a: 3 }, seen: [] } })).toThrow();
    expect(() => migrateSave({ ...structuredClone(s), dens: { nowhere: 3 } })).toThrow();
  });
});
