import { afterEach, describe, expect, it } from 'vitest';
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
import { LASTING_MARKS, type LastingMark } from '../../src/content/story/marks.ts';
import { leaveMark } from '../../src/economy/answers.ts';
import { boardEpoch, boardFor } from '../../src/economy/contracts.ts';
import { marksNear, stationEventAt, useWorldLog } from '../../src/economy/events.ts';
import { quote } from '../../src/economy/markets.ts';
import { validateMarks } from '../../src/economy/storyGuards.ts';
import { marketContext } from '../../src/economy/trade.ts';

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

describe('First Harvest leaves its mark on Harrow Farmstead (docs/PROCGEN.md §14.7)', () => {
  afterEach(() => useWorldLog(null));

  /** Plays First Harvest through to the end it is given (the steps are checked above). */
  function harvestEndsAt(s: GameState, way: 'freeport' | 'relay') {
    dock(s, 'squall-relay');
    acceptJob(s, 'arc.harvest.1');
    dock(s, 'harrow-farmstead');
    acceptJob(s, 'arc.harvest.2');
    inSpace(s, 'achird');
    handOver(s, 'arc.harvest.2');
    dock(s, 'harrow-farmstead');
    acceptJob(s, 'arc.harvest.3');
    s.discoveredBodies.push('hd-219134-d', 'hd-219134-f');
    inSpace(s, 'hd-219134');
    dock(s, 'curlew-institute');
    dock(s, 'harrow-farmstead');
    acceptJob(s, 'arc.harvest.4');
    expect(makeChoice(s, 'arc.harvest.4', way).ok).toBe(true);
    const finale = `arc.harvest.5.${way}`;
    expect(acceptJob(s, finale).ok).toBe(true);
    s.location.dockedAt = null;
    const route = findRoute(SYSTEMS, 'hd-219134', way === 'freeport' ? 'achird' : 'ev-lacertae')!;
    performJump(s, route, route.totalFee);
    for (let i = 0; i < 3; i++) escortArrived(s, finale);
    expect(done(s, finale)).toBe(true);
  }

  /** Harrow's market and board as the player finds them, at a quiet moment (no world event there). */
  function harrow(s: GameState) {
    const ctx = marketContext(s);
    const price = (c: 'food' | 'fine-food' | 'medical') => quote('harrow-farmstead', c, s.reputation, ctx).buy!;
    return { food: price('food'), fineFood: price('fine-food'), medical: price('medical'), board: boardFor('harrow-farmstead', boardEpoch(s.clock)) };
  }

  /** The same, as if no mark had been left. */
  function unmarked(s: GameState) {
    useWorldLog({ ...s.world, marks: {} });
    const out = harrow(s);
    useWorldLog(s.world);
    return out;
  }

  function quietMoment(s: GameState) {
    while (stationEventAt('harrow-farmstead', s.clock)) s.clock += 600;
  }

  it('pass their guardrails, and broken marks are caught', () => {
    expect(validateMarks()).toEqual([]);
    const [a, b] = LASTING_MARKS as [LastingMark, LastingMark];
    const rules = (marks: LastingMark[]) => validateMarks(marks).map((i) => i.rule);
    expect(rules([{ ...a, locationId: 'maw-roost' }, b])).toContain('places');
    expect(rules([{ ...a, market: { ...a.market, goods: ['luxuries'] } }, b])).toContain('market');
    expect(rules([{ ...a, market: { ...a.market, price: 0.3 } }, b])).toContain('market');
    expect(rules([a, { ...b, market: { ...b.market, goods: ['food'] } }])).toContain('market');
    expect(rules([{ ...a, run: { ...a.run!, commodity: 'machinery' } }, b])).toContain('run');
    expect(rules([{ ...a, run: { ...a.run!, to: 'earth-port' } }, b])).toContain('run');
    expect(rules([{ ...a, run: { ...a.run!, premium: 3 } }, b])).toContain('run');
    expect(rules([a, b, { ...a, id: 'nobody.leaves.this' }])).toContain('marks');
    // In the arcs: only a finale leaves a mark, a real one, and each mark is left once.
    const story = (patch: (j: (typeof ARC_JOBS)[number]) => (typeof ARC_JOBS)[number]) => validateStory(ARC_JOBS.map(patch)).map((i) => i.message);
    expect(story((j) => (j.id === 'arc.harvest.3' ? { ...j, story: { ...j.story!, leaves: 'harvest.freeport' } } : j))).toContain('only a finale leaves a lasting mark');
    expect(story((j) => (j.id === 'arc.harvest.5.relay' ? { ...j, story: { ...j.story!, leaves: 'harvest.nowhere' } } : j))).toContain('no lasting mark harvest.nowhere');
    expect(story((j) => (j.id === 'arc.harvest.5.relay' ? { ...j, story: { ...j.story!, leaves: 'harvest.freeport' } } : j))).toContain('harvest.freeport is already left by arc.harvest.5.freeport');
  });

  it('sold at Doppler Freeport, the harvest leaves food plentiful at Harrow for good, and a fine-food run to Doppler on its board', () => {
    const s = pilot();
    useWorldLog(s.world);
    quietMoment(s);
    const before = harrow(s);
    expect(before.board.some((j) => j.title.startsWith('Harvest run'))).toBe(false);
    harvestEndsAt(s, 'freeport');
    expect(Object.keys(s.world.marks ?? {})).toEqual(['harvest.freeport']);
    quietMoment(s);
    const after = harrow(s);
    expect(after.food).toBeLessThan(before.food);
    expect(after.fineFood).toBeLessThan(before.fineFood);
    expect(after.medical).toBe(unmarked(s).medical);
    expect(after.food).toBeLessThan(unmarked(s).food);
    // Every board from now on carries the run, after the rest of the board, which is as it was.
    for (let k = 0; k < 12; k++) {
      const epoch = boardEpoch(s.clock) + k;
      const board = boardFor('harrow-farmstead', epoch);
      const runs = board.filter((j) => j.title.startsWith('Harvest run'));
      expect(runs).toHaveLength(1);
      expect(runs[0]!.title).toMatch(/^Harvest run: \d+ fine food to Doppler Freeport$/);
      expect(runs[0]!.destinationLocationId).toBe('doppler-freeport');
      expect(runs[0]!.contract?.urgent).toBeUndefined();
      expect(board.at(-1)).toBe(runs[0]);
      useWorldLog(null);
      const plain = boardFor('harrow-farmstead', epoch);
      useWorldLog(s.world);
      expect(board.slice(0, -1).map((j) => j.id)).toEqual(plain.map((j) => j.id));
    }
    // Nowhere else changes, and the news within two jumps says so.
    expect(boardFor('curlew-institute', boardEpoch(s.clock)).some((j) => j.title.startsWith('Harvest run'))).toBe(false);
    expect(marksNear('hd-219134')).toEqual([{ mark: LASTING_MARKS[0], jumps: 0 }]);
    expect(marksNear('achird')[0]?.jumps).toBe(1);
    expect(marksNear('sol')).toEqual([]);
  });

  it('fed to Squall Relay’s crews, it leaves medicine plentiful at Harrow, and a better-paid run of the relay’s share', () => {
    const s = pilot();
    useWorldLog(s.world);
    quietMoment(s);
    const before = harrow(s);
    harvestEndsAt(s, 'relay');
    expect(Object.keys(s.world.marks ?? {})).toEqual(['harvest.relay']);
    quietMoment(s);
    const after = harrow(s);
    expect(after.medical).toBeLessThan(before.medical);
    expect(after.food).toBe(unmarked(s).food);
    expect(after.medical).toBeLessThan(unmarked(s).medical);
    const run = boardFor('harrow-farmstead', boardEpoch(s.clock)).find((j) => j.title.startsWith('The relay’s share'));
    expect(run?.title).toMatch(/^The relay’s share: \d+ staple food to Squall Relay$/);
    expect(run?.briefing).toMatch(/answer Harrow’s calls first/);
  });

  it('is left once, kept in the save, and damaged marks are refused', () => {
    const s = pilot();
    expect(leaveMark(s, 'harvest.relay')?.id).toBe('harvest.relay');
    const at = s.world.marks!['harvest.relay'];
    s.clock += 500;
    expect(leaveMark(s, 'harvest.relay')).toBeNull();
    expect(s.world.marks!['harvest.relay']).toBe(at);
    expect(leaveMark(s, 'harvest.nowhere')).toBeNull();
    const saved = migrateSave(structuredClone(s));
    expect(saved.world.marks).toEqual({ 'harvest.relay': at });
    expect(() => migrateSave({ ...structuredClone(s), world: { ...s.world, marks: { 'harvest.nowhere': 1 } } })).toThrow();
    expect(() => migrateSave({ ...structuredClone(s), world: { ...s.world, marks: { 'harvest.relay': 'soon' } } })).toThrow();
    // A save from before marks has none, and that is fine.
    const { marks: _m, ...older } = s.world;
    expect(migrateSave({ ...structuredClone(s), world: older }).world.marks).toBeUndefined();
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
