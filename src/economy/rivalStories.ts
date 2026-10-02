import { applyCredits, type GameState, type RivalStory } from '../app/state.ts';
import { COMBAT } from '../content/combat/rules.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { rng } from '../content/random.ts';
import { RIVALS, ROSTER, type RivalDef } from '../content/rivals/rules.ts';
import { STORY, STORY_NOTES } from '../content/rivals/storyLines.ts';
import { RIVAL_STORY } from '../content/rivals/stories.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { getLocation, getSystem, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { advanceJobs, failJob, type JobDef, type JobEvent } from './jobs.ts';
import { isLawful, lawIn, patrolsScanIn } from './law.ts';
import {
  duelPostedAt,
  duelSystem,
  isAlly,
  nextRun,
  rivalById,
  rivalKnockedOut,
  rivalName,
  rivalTier,
  rivalWhere,
  runOf,
  shift,
  standingWith,
  storiesOf,
  turnOf,
} from './rivals.ts';

/**
 * Rival stories (docs/PROCGEN.md §28): one story per rival per save. A friend (standing at least
 * RIVAL_STORY.friend.standing, known a while) asks for a loan at their table; once it is back, a
 * deed: flying escort on their next run, or bringing parts when their drive fails on one; then they
 * are an ally who flies on the player's wing now and then. An enemy (made hostile) opens a feud with
 * customs tipped off or hired guns waiting, then calls the player out to a duel, one on one, each in
 * their own ship as it is fitted. The story is a record in the save's world log; what it holds the
 * rival to is worked out from it (economy/rivals.ts), and `settleRivalStories` moves it on as the
 * clock passes its moments, wherever the player is.
 */

const F = RIVAL_STORY.friend;
const E = RIVAL_STORY.enemy;

/** A story's job ids: `rs.<rival>.<what>` (not counted among contracts, never pruned). */
export const storyJobId = (r: RivalDef, what: 'escort' | 'rescue' | 'duel') => `rs.${r.id}.${what}`;

/** The rival whose story a job belongs to, if any. */
export function storyRivalOf(state: GameState, jobId: string): RivalDef | undefined {
  const id = state.contracts[jobId]?.contract?.rival;
  return id ? rivalById(id) : undefined;
}

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
const cr = (n: number) => `${n.toLocaleString('en-GB')} cr`;
const pathOf = (r: RivalDef) => RIVAL_STORY.paths[r.id] ?? { deed: 'escort' as const, opening: 'tipoff' as const };

function storyFor(state: GameState, r: RivalDef): RivalStory | undefined {
  return state.world.rivals?.stories?.[r.id];
}

/** A clock time as the game says it: day and hour of the voyage ("day 2, 14:05"). */
export function clockWords(t: number): string {
  const day = Math.floor(t / 86_400) + 1;
  const h = Math.floor((t % 86_400) / 3_600);
  const m = Math.floor((t % 3_600) / 60);
  return `day ${day}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- at their table

/** What a rival's story offers the player at their table now. */
export type StoryOffer =
  | { kind: 'loan'; amount: number; back: number; text: string; lock: string | null }
  | { kind: 'escort'; dest: string; reward: number; text: string; lock: string | null }
  | { kind: 'ally'; lock: string | null };

/** What the player gets back for a loan. */
export const loanBack = (amount: number) => Math.round(amount * (1 + F.loan.interest));

/** What a rival's story offers at their table now (the player docked where they are), or null. */
export function storyOffer(state: GameState, r: RivalDef): StoryOffer | null {
  const story = storyFor(state, r);
  const tier = rivalTier(state, r.id);
  if (tier === 'hostile') return null;
  const lines = STORY[r.voice];
  if (!story) {
    const met = state.rivals?.[r.id]?.met;
    if (standingWith(state, r.id) < F.standing || met === undefined || state.clock - met < F.knownSeconds) return null;
    const amount = F.loan.amount[r.style];
    const back = loanBack(amount);
    return { kind: 'loan', amount, back, text: fill(lines.loanAsk, { amount: cr(amount), back: cr(back) }), lock: state.credits < amount ? `You need ${cr(amount)}.` : null };
  }
  if (story.path !== 'friend') return null;
  if (!story.deed && story.loan?.repaid !== undefined && !story.ended && pathOf(r).deed === 'escort') {
    const run = escortRun(state, r);
    if (!run) return null;
    return { kind: 'escort', dest: run.to, reward: F.escort.reward, text: fill(lines.escortAsk, { dest: getLocation(run.to).name }), lock: null };
  }
  if (isAlly(state, r)) return { kind: 'ally', lock: allyLock(state, r) };
  return null;
}

/** The run a friend asks the player to fly escort on: their next, from where they sit now. */
function escortRun(state: GameState, r: RivalDef) {
  const here = state.location.dockedAt;
  const run = nextRun(r, state.clock);
  return run && run.from === here && run.to !== here ? run : null;
}

/** Why an ally cannot fly with the player now, or null. */
function allyLock(state: GameState, r: RivalDef): string | null {
  if (state.crew.some((w) => w.ally === r.id)) return `${r.first} is on your wing.`;
  if (state.crew.length >= COMBAT.wingmen.max) return `Your wing is full (${COMBAT.wingmen.max}).`;
  const last = storyFor(state, r)?.wings?.at(-1);
  if (last && state.clock - last.at < F.ally.every) {
    const h = Math.max(1, Math.ceil((last.at + F.ally.every - state.clock) / 3_600));
    return `${r.first} has a run of their own to fly. Ask again in about ${h} h.`;
  }
  return null;
}

export interface StoryAct {
  ok: boolean;
  message: string;
  /** What the rival says. */
  line?: string;
}

/** Lends a friend what they ask: it comes back with interest when their next run docks. */
export function lendTo(state: GameState, r: RivalDef): StoryAct {
  const offer = storyOffer(state, r);
  if (offer?.kind !== 'loan') return { ok: false, message: `${r.first} has not asked you for anything.` };
  if (offer.lock) return { ok: false, message: offer.lock };
  applyCredits(state, -offer.amount, 'fleet', `Loan to ${rivalName(r)}`);
  storiesOf(state)[r.id] = { path: 'friend', began: state.clock, loan: { amount: offer.amount } };
  shift(state, r.id, F.loan.standing);
  return { ok: true, message: fill(STORY_NOTES.lent, { rival: rivalName(r), amount: cr(offer.amount) }), line: STORY[r.voice].loanThanks };
}

/** Takes on a friend's escort: their next run, from here, with the player alongside. */
export function takeEscort(state: GameState, r: RivalDef): StoryAct {
  const offer = storyOffer(state, r);
  const story = storyFor(state, r);
  const run = escortRun(state, r);
  if (offer?.kind !== 'escort' || !story || !run) return { ok: false, message: `${r.first} has no run for you to fly.` };
  const from = getLocation(run.from);
  const dest = getLocation(run.to);
  const id = storyJobId(r, 'escort');
  const name = rivalName(r);
  const cargo = run.commodity ? `${COMMODITIES[run.commodity].name.toLowerCase()} ` : '';
  const job: JobDef = {
    id,
    title: `Escort ${r.first}’s run`,
    giverLocationId: from.id,
    factionId: null,
    briefing: `${name} is taking a ${cargo}run to ${dest.name} in the ${r.shipName}, and raiders have been sniffing round. Fly alongside from ${from.name} and see it in.`,
    objectives: [{ kind: 'escort', systemId: dest.systemId, fromLocationId: from.id, locationId: dest.id, model: r.ship, shipName: r.shipName, level: F.escort.level, text: `See the ${r.shipName} safely to ${dest.name}` }],
    reward: F.escort.reward,
    repReward: {},
    difficulty: F.escort.level,
    difficultyNote: 'A friend’s run',
    destinationLocationId: dest.id,
    contract: { kind: 'escort', rival: r.id },
  };
  state.contracts[id] = job;
  state.jobs[id] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  story.deed = { kind: 'escort', at: state.clock, job: id, from: from.id, to: dest.id };
  return { ok: true, message: `${name} is waiting at the ${r.shipName}. Launch, and see it to ${dest.name}.` };
}

/** Asks an ally to fly on the player's wing, until the player next docks. */
export function askAlly(state: GameState, r: RivalDef): StoryAct {
  const offer = storyOffer(state, r);
  if (offer?.kind !== 'ally') return { ok: false, message: `${r.first} will not fly with you.` };
  if (offer.lock) return { ok: false, message: offer.lock };
  const story = storyFor(state, r)!;
  const wings = (story.wings ??= []);
  wings.push({ at: state.clock });
  if (wings.length > 6) wings.splice(0, wings.length - 6);
  state.crew.push({ id: `ally.${r.id}`, name: rivalName(r), model: r.ship, fee: 0, skill: 'sharp', ally: r.id });
  return { ok: true, message: fill(STORY_NOTES.allyJoins, { rival: rivalName(r) }), line: STORY[r.voice].allyYes };
}

/** Ends an ally's flight on the wing: they stay where the player is docked (or go home). */
function endWing(state: GameState, r: RivalDef, resume: string): void {
  const wing = storyFor(state, r)?.wings?.at(-1);
  if (wing && wing.end === undefined) {
    wing.end = state.clock;
    wing.resume = resume;
  }
  state.crew = state.crew.filter((w) => w.ally !== r.id);
}

/** Lets an ally go: they stay at this dock. */
export function partWays(state: GameState, r: RivalDef): StoryAct {
  if (!state.crew.some((w) => w.ally === r.id)) return { ok: false, message: `${r.first} is not on your wing.` };
  endWing(state, r, state.location.dockedAt ?? r.home);
  return { ok: true, message: `${rivalName(r)} leaves your wing.` };
}

/** The player docked: allies on the wing leave it here (their flight was until the next dock). */
export function alliesDock(state: GameState, locationId: string): string[] {
  const notes: string[] = [];
  for (const w of state.crew.filter((x) => x.ally)) {
    const r = rivalById(w.ally!);
    if (!r) continue;
    endWing(state, r, locationId);
    notes.push(fill(STORY_NOTES.allyLeaves, { rival: rivalName(r), station: getLocation(locationId).name }));
  }
  return notes;
}

/** An ally's ship was lost on the player's wing: they ejected, and are home refitting. */
export function allyLost(state: GameState, r: RivalDef, systemId: SystemId): void {
  if (!state.world.rivals?.down[r.id] || state.world.rivals.down[r.id]!.at !== state.clock) rivalKnockedOut(state, r, systemId);
  endWing(state, r, r.home);
}

// ---------------------------------------------------------------- what the clock brings

/** Something a story said as the clock passed one of its moments. */
export interface StoryNote {
  rival: RivalDef;
  text: string;
  tone: 'good' | 'bad' | 'info';
  /** What the rival says over the radio. */
  line?: string;
  /** A job it posted (a rescue, a duel): a flight in its system brings its ship into the scene. */
  job?: string;
}

/** When a friend's loan comes back: as their first run set off since the loan docks (Infinity if none has yet). */
export function repayAt(r: RivalDef, story: RivalStory, until: number): number {
  for (let n = Math.max(0, turnOf(story.began)); n <= turnOf(until) + 1; n++) {
    const run = runOf(r, n);
    if (run && run.depart >= story.began && run.lostAt === undefined) return run.arrive;
  }
  return Infinity;
}

/**
 * Where a friend's drive fails: on the first run setting off at least `after` from `from` that has
 * a leg of its own, `at` of the way along its longest leg.
 */
export function failurePoint(r: RivalDef, from: number): { at: number; systemId: SystemId; to: string } | null {
  for (let n = turnOf(from); n <= turnOf(from) + 48; n++) {
    const run = runOf(r, n);
    if (!run || run.depart < from || run.lostAt !== undefined || !run.legs.length) continue;
    const leg = [...run.legs].sort((a, b) => b.end - b.start - (a.end - a.start))[0]!;
    if (leg.end - leg.start < 120) continue;
    return { at: Math.round(leg.start + (leg.end - leg.start) * F.rescue.at), systemId: leg.systemId, to: run.to };
  }
  return null;
}

/** Whether a planned drive failure still falls on a run being flown then, in its system (no knock-out in between). */
function failsOnRun(r: RivalDef, deed: NonNullable<RivalStory['deed']>): boolean {
  if (rivalWhere(r, deed.at).kind === 'down') return false;
  for (const n of [turnOf(deed.at), turnOf(deed.at) - 1]) {
    const run = runOf(r, n);
    if (run && run.lostAt === deed.at && run.legs.some((l) => l.systemId === deed.systemId && l.start <= deed.at && deed.at < l.end)) return true;
  }
  return false;
}

/** The parts a rescue asks for, at their base price, and what the friend pays all told. */
export const rescuePay = () => COMMODITIES['ship-parts'].basePrice * F.rescue.qty + F.rescue.reward;

function postRescue(state: GameState, r: RivalDef, story: RivalStory): StoryNote {
  const deed = story.deed!;
  const id = deed.job;
  const system = getSystem(deed.systemId!).displayName;
  const name = rivalName(r);
  const job: JobDef = {
    id,
    title: `Parts for ${r.first}`,
    giverLocationId: r.home,
    factionId: null,
    briefing: `${name}’s ${r.shipName} is adrift in ${system} with a dead drive. Bring ${F.rescue.qty} ship components alongside before the tow gets there. ${r.first} pays for the parts, and more besides.`,
    objectives: [{ kind: 'rescue', systemId: deed.systemId!, shipName: r.shipName, model: r.ship, commodity: 'ship-parts', qty: F.rescue.qty, guard: null, text: `Bring ${F.rescue.qty} ship components to the ${r.shipName}` }],
    reward: rescuePay(),
    repReward: {},
    difficulty: 1,
    difficultyNote: 'A friend in need',
    destinationLocationId: r.home,
    contract: { kind: 'rescue', rival: r.id },
  };
  state.contracts[id] = job;
  state.jobs[id] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  return {
    rival: r,
    tone: 'bad',
    text: fill(STORY_NOTES.distress, { rival: name, ship: r.shipName, system, qty: F.rescue.qty, until: clockWords(deed.at + F.rescue.giveUp) }),
    line: fill(STORY[r.voice].distress, { system, qty: F.rescue.qty }),
    job: id,
  };
}

function postDuel(state: GameState, r: RivalDef, story: RivalStory, posted: number): StoryNote {
  story.duel = { posted };
  const sys = duelSystem(r);
  const system = getSystem(sys).displayName;
  const name = rivalName(r);
  const id = storyJobId(r, 'duel');
  const job: JobDef = {
    id,
    title: `A duel with ${r.first}`,
    giverLocationId: r.home,
    factionId: null,
    briefing: `${name} has called you out: a duel off the jump beacon in ${system}, one on one, each in their own ship as it is fitted, until one yields. Win, and the ${cr(E.duel.purse)} purse is yours and the feud is over. Yield or leave, and ${r.first} takes a ${cr(E.duel.stake)} stake. Come with your hull sound.`,
    objectives: [{ kind: 'duel', systemId: sys, rival: r.id, text: `Meet ${r.first} at the beacon in ${system} for the duel` }],
    reward: E.duel.purse,
    repReward: {},
    difficulty: 3,
    difficultyNote: `Open until ${clockWords(posted + E.duel.open)}`,
    destinationLocationId: r.home,
    contract: { kind: 'bounty', rival: r.id },
  };
  state.contracts[id] = job;
  state.jobs[id] = { status: 'active', objectiveIndex: 0, acceptedAt: state.clock };
  return { rival: r, tone: 'bad', text: fill(STORY_NOTES.challenge, { rival: name, system, until: clockWords(posted + E.duel.open) }), line: fill(STORY[r.voice].challenge, { system }), job: id };
}

/** A story's job still open after its story moved on is closed. */
function closeJob(state: GameState, jobId: string, reason: string): JobEvent[] {
  if (state.jobs[jobId]?.status !== 'active') return [];
  const ev = failJob(state, jobId, reason);
  return ev ? [ev] : [];
}

/**
 * Moves every story on to the clock (docs/PROCGEN.md §28): loans come back, drives fail, rescues
 * and escorts are settled or given up, duels are posted or missed. Safe to call at any time, and
 * idempotent; returns what was said, and the jobs closed.
 */
export function settleRivalStories(state: GameState): { notes: StoryNote[]; jobs: JobEvent[] } {
  const notes: StoryNote[] = [];
  const jobs: JobEvent[] = [];
  const stories = state.world.rivals?.stories;
  if (!stories) return { notes, jobs };
  for (const r of ROSTER) {
    const story = stories[r.id];
    if (!story) continue;
    if (story.path === 'friend') settleFriend(state, r, story, notes, jobs);
    else settleEnemy(state, r, story, notes, jobs);
  }
  return { notes, jobs };
}

function settleFriend(state: GameState, r: RivalDef, story: RivalStory, notes: StoryNote[], jobs: JobEvent[]): void {
  const name = rivalName(r);
  const loan = story.loan;
  // The loan comes back as their next run docks.
  if (loan && loan.repaid === undefined) {
    const at = repayAt(r, story, state.clock);
    if (at <= state.clock) {
      loan.repaid = at;
      const back = loanBack(loan.amount);
      applyCredits(state, back, 'fleet', `Loan repaid by ${name}`);
      notes.push({ rival: r, tone: 'good', text: fill(STORY_NOTES.repaid, { rival: name, amount: cr(back) }), line: fill(STORY[r.voice].repaid, { amount: cr(back) }) });
    }
  }
  if (story.ended && story.ended.how !== 'friends') {
    for (const what of ['escort', 'rescue'] as const) jobs.push(...closeJob(state, storyJobId(r, what), `${r.first} and you have fallen out`));
    return;
  }
  // A rescue's drive failure is worked out once the loan is back, on a run at least `after` from then.
  if (!story.deed && loan?.repaid !== undefined && pathOf(r).deed === 'rescue') {
    const p = failurePoint(r, Math.max(loan.repaid, state.clock) + F.rescue.after);
    if (p) story.deed = { kind: 'rescue', at: p.at, job: storyJobId(r, 'rescue'), to: p.to, systemId: p.systemId };
  }
  const deed = story.deed;
  if (!deed || deed.end !== undefined) return;
  const progress = state.jobs[deed.job];
  if (deed.kind === 'rescue') {
    if (!progress) {
      if (state.clock < deed.at) return;
      // Knocked out before their drive could fail, or off the run it was to fail on: it fails on a later run.
      if (!failsOnRun(r, deed)) {
        delete story.deed;
        return;
      }
      notes.push(postRescue(state, r, story));
      return;
    }
    if (progress.status === 'active' && state.clock >= deed.at + F.rescue.giveUp) {
      jobs.push(...closeJob(state, deed.job, 'the tow got there first'));
    }
    if (progress.status === 'active') return;
    const end = progress.completedAt ?? state.clock;
    const system = getSystem(deed.systemId!).displayName;
    if (progress.status === 'complete') {
      Object.assign(deed, { end, resume: deed.to, done: true });
      shift(state, r.id, F.deedStanding);
      story.ended = { at: end, how: 'friends' };
      notes.push({ rival: r, tone: 'good', text: `${name} is underway again, and owes you one.`, line: STORY[r.voice].rescued });
    } else if (state.world.rivals?.down[r.id]?.at === end) {
      // The stranded ship was destroyed.
      Object.assign(deed, { end, resume: r.home });
      story.ended = { at: end, how: 'lost-ship' };
    } else {
      Object.assign(deed, { end: Math.min(end, deed.at + F.rescue.giveUp), resume: r.home });
      shift(state, r.id, F.rescue.towed);
      story.ended = { at: deed.end!, how: 'towed' };
      notes.push({ rival: r, tone: 'bad', text: fill(STORY_NOTES.towed, { rival: name, system }), line: STORY[r.voice].towed });
    }
    return;
  }
  // An escort: done, its ship lost, left behind, given up, or waited out.
  if (progress?.status === 'active' && state.clock >= deed.at + F.escort.wait) {
    jobs.push(...closeJob(state, deed.job, `${r.first} went alone`));
  }
  if (!progress || progress.status === 'active') return;
  const end = progress.completedAt ?? state.clock;
  if (progress.status === 'complete') {
    Object.assign(deed, { end, resume: deed.to, done: true });
    shift(state, r.id, F.deedStanding);
    story.ended = { at: end, how: 'friends' };
    notes.push({ rival: r, tone: 'good', text: `${name} is safely in, and owes you one.`, line: STORY[r.voice].escortThanks });
  } else if (state.world.rivals?.down[r.id]?.at === end) {
    Object.assign(deed, { end, resume: r.home });
    story.ended = { at: end, how: 'lost-ship' };
  } else {
    Object.assign(deed, { end: Math.min(end, deed.at + F.escort.wait), resume: deed.from ?? r.home });
    shift(state, r.id, F.escort.letDown);
    story.ended = { at: deed.end!, how: 'let-down' };
    notes.push({ rival: r, tone: 'bad', text: fill(STORY_NOTES.letDown, { rival: name }) });
  }
}

function settleEnemy(state: GameState, r: RivalDef, story: RivalStory, notes: StoryNote[], jobs: JobEvent[]): void {
  const name = rivalName(r);
  const job = storyJobId(r, 'duel');
  if (story.ended) {
    if (story.ended.how !== 'won') jobs.push(...closeJob(state, job, story.ended.how === 'amends' ? 'you made amends' : 'the duel is off'));
    return;
  }
  if (!story.duel) {
    const posted = duelPostedAt(r, story);
    if (state.clock < posted) return;
    notes.push(postDuel(state, r, story, posted));
    return;
  }
  const until = story.duel.posted + E.duel.open;
  if (story.duel.started === undefined && state.clock >= until) {
    story.ended = { at: until, how: 'no-show' };
    jobs.push(...closeJob(state, job, 'you never came'));
    notes.push({ rival: r, tone: 'bad', text: fill(STORY_NOTES.noShow, { rival: name, system: getSystem(duelSystem(r)).displayName }), line: STORY[r.voice].noShow });
  }
}

// ---------------------------------------------------------------- a feud's opening, in flight

const homeJumps = (r: RivalDef) => jumpsFrom(WORLD.links, getLocation(r.home).systemId);
const security = (systemId: SystemId) => WORLD.profiles.get(systemId)?.security ?? 1;

/** A feud's opening under way now, of a kind, and not yet spent. */
function openingNow(state: GameState, r: RivalDef, kind: 'tipoff' | 'ambush'): RivalStory | null {
  const story = storyFor(state, r);
  if (story?.path !== 'enemy' || story.ended || story.spent !== undefined || pathOf(r).opening !== kind) return null;
  const seconds = kind === 'ambush' ? E.ambush.seconds : E.tipoff.seconds;
  return state.clock >= story.began && state.clock < story.began + seconds ? story : null;
}

/** The rival who has tipped customs off about the player in a system now, if any: lawful space within reach of their home. */
export function tipoffIn(state: GameState, systemId: SystemId): RivalDef | null {
  if (!isLawful(lawIn(systemId))) return null;
  return ROSTER.find((r) => openingNow(state, r, 'tipoff') && (homeJumps(r).get(systemId) ?? 99) <= E.tipoff.jumps) ?? null;
}

/** Customs scanned the player on a rival's tip: spent. What the game says. */
export function spendTipoff(state: GameState, r: RivalDef): string {
  const story = storyFor(state, r);
  if (story) story.spent = state.clock;
  return fill(STORY_NOTES.tipoff, { rival: rivalName(r) });
}

/** Whether a patrol of this system would scan the player on a tip (the system's patrols scan at all). */
export const tippedPatrols = (state: GameState, systemId: SystemId) => !!patrolsScanIn(systemId) && !!tipoffIn(state, systemId);

/** Hired guns waiting for the player in a system now (lawless space within reach of the rival's home), if any. */
export interface StoryAmbush {
  rival: RivalDef;
  /** Seconds into the flight they strike. */
  delay: number;
  /** Hired guns, and whether the rival (a bounty hunter) flies with them. */
  guns: number;
  withRival: boolean;
  level: 1 | 2 | 3;
}

export function ambushIn(state: GameState, systemId: SystemId): StoryAmbush | null {
  if (security(systemId) >= RIVALS.hostile.lawless || systemId === 'sol') return null;
  for (const r of ROSTER) {
    if (!openingNow(state, r, 'ambush') || (homeJumps(r).get(systemId) ?? 99) > E.ambush.jumps) continue;
    const hunter = r.style === 'hunter';
    const [a, b] = E.ambush.delay;
    const delay = Math.round(a + rng(WORLD_SEED, 'rival-ambush', r.id, Math.floor(state.clock)).next() * (b - a));
    return { rival: r, delay, guns: hunter ? E.ambush.hunterGuns : E.ambush.guns, withRival: hunter, level: E.ambush.level };
  }
  return null;
}

/** The hired guns struck: the opening is spent. What the game says. */
export function spendAmbush(state: GameState, r: RivalDef): string {
  const story = storyFor(state, r);
  if (story) story.spent = state.clock;
  return fill(STORY_NOTES.ambush, { rival: rivalName(r) });
}

// ---------------------------------------------------------------- the duel

/** A duel open in a system now: the rival waiting off its beacon (or fighting), and the job. */
export interface StoryDuel {
  rival: RivalDef;
  jobId: string;
  started: boolean;
}

export function duelIn(state: GameState, systemId: SystemId): StoryDuel | null {
  for (const r of ROSTER) {
    const story = storyFor(state, r);
    if (story?.path !== 'enemy' || story.ended || !story.duel || duelSystem(r) !== systemId) continue;
    const jobId = storyJobId(r, 'duel');
    // A duel under way goes on past its window (a game saved in the middle of one comes back to it).
    const started = story.duel.started !== undefined;
    if (state.jobs[jobId]?.status !== 'active' || (!started && state.clock >= story.duel.posted + E.duel.open)) continue;
    return { rival: r, jobId, started };
  }
  return null;
}

/** The duel has started. */
export function duelStarted(state: GameState, r: RivalDef): void {
  const story = storyFor(state, r);
  if (story?.duel && story.duel.started === undefined) story.duel.started = state.clock;
}

/** The rival yielded: the purse (the job's pay), and the feud is over. */
export function duelWon(state: GameState, r: RivalDef): { events: JobEvent[]; text: string; line: string } {
  const story = storyFor(state, r);
  const jobId = storyJobId(r, 'duel');
  const progress = state.jobs[jobId];
  if (!story || story.ended || progress?.status !== 'active') return { events: [], text: '', line: '' };
  progress.duel = 'won';
  const events = advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId });
  setStanding(state, r, E.duel.wonStanding);
  story.ended = { at: state.clock, how: 'won' };
  return { events, text: fill(STORY_NOTES.won, { rival: rivalName(r), amount: cr(E.duel.purse) }), line: STORY[r.voice].yields };
}

/** The player yielded, or left the duel once it had started: the stake, and the feud is over. */
export function duelLost(state: GameState, r: RivalDef, how: 'lost' | 'forfeit'): { events: JobEvent[]; text: string; line: string } {
  const story = storyFor(state, r);
  if (!story || story.ended || !story.duel) return { events: [], text: '', line: '' };
  const stake = Math.min(E.duel.stake, state.credits);
  if (stake > 0) applyCredits(state, -stake, 'fee', `Duel stake to ${rivalName(r)}`);
  setStanding(state, r, E.duel.lostStanding);
  story.ended = { at: state.clock, how };
  const events = closeJob(state, storyJobId(r, 'duel'), how === 'lost' ? 'you yielded' : 'you left the duel');
  return { events, text: fill(how === 'lost' ? STORY_NOTES.lost : STORY_NOTES.forfeit, { rival: rivalName(r), amount: cr(stake) }), line: how === 'lost' ? STORY[r.voice].wins : STORY[r.voice].forfeit };
}

function setStanding(state: GameState, r: RivalDef, value: number): void {
  ((state.rivals ??= {})[r.id] ??= { standing: 0 }).standing = value;
}

// ---------------------------------------------------------------- how a story stands

/** A short line on how a rival's story stands, for the journal and their table, or null with none. */
export function storyStatus(state: GameState, r: RivalDef): string | null {
  const story = storyFor(state, r);
  if (!story) return null;
  const E2 = story.ended;
  if (story.path === 'friend') {
    if (E2?.how === 'friends') return state.crew.some((w) => w.ally === r.id) ? 'An ally, flying on your wing.' : isAlly(state, r) ? 'An ally: will fly on your wing now and then.' : 'A friend who owes you one.';
    if (E2?.how === 'towed') return 'Towed home after their drive failed: your help never came.';
    if (E2?.how === 'let-down') return 'Flew their run alone after waiting for your escort.';
    if (E2?.how === 'lost-ship') return 'Lost their ship while you were with them.';
    if (E2?.how === 'fell-out') return 'You fell out.';
    const deed = story.deed;
    if (deed?.kind === 'escort') return `Waiting for you to fly escort to ${getLocation(deed.to).name}.`;
    if (deed?.kind === 'rescue' && state.jobs[deed.job]?.status === 'active') return `Adrift in ${getSystem(deed.systemId!).displayName}: bring ${F.rescue.qty} ship components by ${clockWords(deed.at + F.rescue.giveUp)}.`;
    if (story.loan && story.loan.repaid === undefined) return `Owes you ${cr(loanBack(story.loan.amount))}, back when their next run docks.`;
    return 'Paid back your loan.';
  }
  if (E2?.how === 'won') return 'Lost a duel to you. You are square.';
  if (E2?.how === 'lost' || E2?.how === 'forfeit') return 'Won a duel against you. You are square.';
  if (E2?.how === 'amends') return 'Took your amends. The feud is over.';
  if (E2?.how === 'no-show') return 'Waited at the beacon for a duel you never came to.';
  if (story.duel) return `Waiting for you at the beacon in ${getSystem(duelSystem(r)).displayName}, until ${clockWords(story.duel.posted + E.duel.open)}: a duel.`;
  return 'Has it in for you. Watch yourself near their home.';
}

/** The tag a rival wears in the bar: an ally, a feud, or a story to talk about. */
export function storyTag(state: GameState, r: RivalDef): 'Ally' | 'Feud' | 'Story' | null {
  const story = storyFor(state, r);
  if (isAlly(state, r)) return 'Ally';
  if (story?.path === 'enemy' && !story.ended) return 'Feud';
  const offer = storyOffer(state, r);
  return offer && offer.kind !== 'ally' ? 'Story' : null;
}

/** Rivals with a story in this save, the newest first. */
export function rivalsWithStories(state: GameState): RivalDef[] {
  const stories = state.world.rivals?.stories ?? {};
  return ROSTER.filter((r) => stories[r.id]).sort((a, b) => stories[b.id]!.began - stories[a.id]!.began);
}
