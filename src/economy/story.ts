import { applyCredits, type GameState } from '../app/state.ts';
import { EMBERS } from '../content/story/embers.ts';
import { startPyre } from './embers.ts';
import { LAW } from '../content/law/rules.ts';
import { ARC_JOBS, ARC_ORDER, ARCS, CHARACTERS } from '../content/story/arcs.ts';
import type { Arc, ArcId, Line, StoryOption } from '../content/story/types.ts';
import { getLocation } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { leaveMark } from './answers.ts';
import { adjustReputation, FACTIONS, standingTier, TIER_LABEL } from './factions.ts';
import { advanceJobs, currentObjective, jobLockReason, storyVisible, type JobDef, type JobEvent, type Objective } from './jobs.ts';
import { LAWFUL } from './law.ts';

/**
 * Story arcs in play (docs/PROCGEN.md §14): where each arc stands, the words that go with each
 * step (told once), choices and their consequences, and raider dens knocked out along the way.
 */

export function arcMissions(arcId: ArcId): JobDef[] {
  return ARC_JOBS.filter((j) => j.story!.arc === arcId).sort((a, b) => a.story!.step - b.story!.step);
}

/** Steps in an arc (an arc that branches after a choice has more missions than steps). */
export function arcSteps(arcId: ArcId): number {
  return Math.max(...arcMissions(arcId).map((m) => m.story!.step));
}

export function isStoryJob(jobId: string): boolean {
  return ARC_JOBS.some((j) => j.id === jobId);
}

export type ArcPhase = 'locked' | 'available' | 'active' | 'complete' | 'ended';

export interface ArcStatus {
  arc: Arc;
  phase: ArcPhase;
  /** The step in hand (the next one when none is active). */
  step: number;
  of: number;
  /** The mission in hand, or waiting to be taken. */
  job: JobDef | null;
  lockReason: string | null;
  /** Choices made so far: what was asked and what the player chose. */
  choices: { prompt: string; option: StoryOption }[];
  /** The choice that ended the arc early, if one did. */
  endedBy: StoryOption | null;
}

export function arcStatus(state: GameState, arcId: ArcId): ArcStatus {
  const missions = arcMissions(arcId);
  const of = arcSteps(arcId);
  const choices: ArcStatus['choices'] = [];
  let endedBy: StoryOption | null = null;
  for (const m of missions) {
    for (const o of m.objectives) {
      if (o.kind !== 'choice') continue;
      const option = o.options.find((x) => x.id === state.story.choices[o.choiceId]);
      if (!option) continue;
      choices.push({ prompt: o.prompt, option });
      if (option.ends) endedBy = option;
    }
  }
  const base = { arc: ARCS[arcId], of, choices, endedBy, lockReason: null };
  const finale = missions.find((m) => m.story!.finale && state.jobs[m.id]?.status === 'complete');
  if (finale) return { ...base, phase: 'complete', step: of, job: finale };
  if (endedBy) {
    const at = missions.find((m) => m.objectives.some((o) => o.kind === 'choice' && o.options.includes(endedBy!)))!;
    return { ...base, phase: 'ended', step: at.story!.step, job: at };
  }
  const active = missions.find((m) => state.jobs[m.id]?.status === 'active');
  if (active) return { ...base, phase: 'active', step: active.story!.step, job: active };
  const next = missions.find((m) => !state.jobs[m.id] && storyVisible(state, m)) ?? missions[0]!;
  const lockReason = state.jobs[next.id] ? null : jobLockReason(state, next);
  return { ...base, phase: lockReason ? 'locked' : 'available', step: next.story!.step, job: next, lockReason };
}

export function arcStatuses(state: GameState): ArcStatus[] {
  return ARC_ORDER.map((id) => arcStatus(state, id));
}

/**
 * The briefing, in the words that follow an earlier choice when there are such words, then what the
 * speaker has to say about the choices made in other arcs.
 */
export function briefingFor(state: GameState, job: JobDef): string {
  const v = job.story?.variant;
  const pick = v ? state.story.choices[v.choiceId] : undefined;
  const echoes = (job.story?.echoes ?? []).flatMap((e) => {
    const made = state.story.choices[e.choiceId];
    const said = made ? e.said[made] : undefined;
    return said ? [said] : [];
  });
  return [(pick && v?.briefing[pick]) || job.briefing, ...echoes].join(' ');
}

/** Why a story option is not open to this pilot (the standing it asks for), or null. */
export function optionLock(state: GameState, option: StoryOption): string | null {
  const need = option.requires?.minRep;
  if (!need || (state.reputation[need.faction] ?? 0) >= need.value) return null;
  return `Needs ${TIER_LABEL[standingTier(need.value)]} standing with the ${FACTIONS[need.faction].name}`;
}

/** What is said when the mission is complete. */
export function debriefFor(state: GameState, job: JobDef): readonly Line[] {
  const v = job.story?.variant;
  const pick = v ? state.story.choices[v.choiceId] : undefined;
  return (pick && v?.debrief[pick]) || job.story?.debrief || [];
}

export function speakerName(who: Line['who']): string {
  return who === 'comm' ? '' : CHARACTERS[who].name;
}

/**
 * Makes a story choice at its dock: records it, applies its standing, credits and pardon, and
 * completes the mission it belongs to.
 */
export function makeChoice(state: GameState, jobId: string, optionId: string): { ok: boolean; message: string; events: JobEvent[] } {
  const o = currentObjective(state, jobId);
  if (o?.kind !== 'choice') return { ok: false, message: 'Nothing to decide here.', events: [] };
  if (state.location.dockedAt !== o.locationId) return { ok: false, message: `Dock at ${getLocation(o.locationId).name} to decide.`, events: [] };
  const option = o.options.find((x) => x.id === optionId);
  if (!option) return { ok: false, message: 'Unknown choice.', events: [] };
  const lock = optionLock(state, option);
  if (lock) return { ok: false, message: lock, events: [] };
  state.story.choices[o.choiceId] = option.id;
  // Last Light at Pyre's choice made: Pyre's warning comes a minute later (docs/PROCGEN.md §42.1).
  if (o.choiceId === EMBERS.choice) startPyre(state);
  if (option.pardon) {
    // A deal with the law: every fine cleared and standing lifted to Wary.
    state.law.pending = [];
    for (const f of LAWFUL) {
      delete state.law.fines[f];
      const now = state.reputation[f] ?? 0;
      if (now < LAW.pardonFloor) adjustReputation(state.reputation, f, LAW.pardonFloor - now);
    }
  }
  for (const [faction, delta] of Object.entries(option.rep) as [keyof typeof option.rep, number][]) adjustReputation(state.reputation, faction, delta);
  if (option.credits) {
    applyCredits(state, option.credits, 'reward', `${getJobTitle(jobId)}: ${option.label}`);
    state.stats.rewards += option.credits;
  }
  // An arc that ends here may change a station for good, as a finale does (docs/PROCGEN.md §14.7).
  if (option.ends && option.leaves) leaveMark(state, option.leaves);
  const events = advanceJobs(state, { dockedAt: state.location.dockedAt, systemId: state.location.systemId });
  return { ok: true, message: option.outcome, events };
}

function getJobTitle(jobId: string): string {
  return ARC_JOBS.find((j) => j.id === jobId)?.title ?? jobId;
}

/** A choice waiting at this dock (the story mission and its objective), if there is one. */
export function choiceHere(state: GameState, locationId: string): { job: JobDef; objective: Extract<Objective, { kind: 'choice' }> } | null {
  for (const job of ARC_JOBS) {
    const o = currentObjective(state, job.id);
    if (o?.kind === 'choice' && o.locationId === locationId) return { job, objective: o };
  }
  return null;
}

// ---------------------------------------------------------------- beats

export interface Beat {
  /** Recorded in GameState.story.seen once told. */
  key: string;
  jobId: string;
  title: string;
  kind: 'beat' | 'comm' | 'debrief';
  lines: readonly Line[];
}

/** The system an objective takes place in, when it has one. */
export function objectiveSystem(o: Objective | undefined): SystemId | null {
  if (!o) return null;
  if ('systemId' in o) return o.systemId;
  if ('locationId' in o) return getLocation(o.locationId).systemId;
  return null;
}

/**
 * Words not yet told: beats for objectives done, the debrief of missions complete, and (in flight)
 * comms for the system the player is in while its objective is current.
 */
export function pendingBeats(state: GameState, inFlight: boolean): Beat[] {
  const seen = new Set(state.story.seen);
  const out: Beat[] = [];
  for (const job of ARC_JOBS) {
    const p = state.jobs[job.id];
    const story = job.story!;
    if (!p || (p.status !== 'active' && p.status !== 'complete')) continue;
    const done = p.status === 'complete' ? job.objectives.length : p.objectiveIndex;
    for (const b of story.beats ?? []) {
      const key = `${job.id}:b${b.after}`;
      if (b.after < done && !seen.has(key)) out.push({ key, jobId: job.id, title: job.title, kind: 'beat', lines: b.lines });
    }
    if (inFlight && p.status === 'active') {
      for (const c of story.comms ?? []) {
        const key = `${job.id}:c${c.at}`;
        if (c.at === p.objectiveIndex && objectiveSystem(job.objectives[c.at]) === state.location.systemId && !seen.has(key)) {
          out.push({ key, jobId: job.id, title: job.title, kind: 'comm', lines: c.lines });
        }
      }
    }
    if (p.status === 'complete') {
      const key = `${job.id}:done`;
      const lines = debriefFor(state, job);
      if (lines.length && !seen.has(key)) out.push({ key, jobId: job.id, title: job.title, kind: 'debrief', lines });
    }
  }
  return out;
}

export function markSeen(state: GameState, beats: readonly Beat[]): void {
  for (const b of beats) if (!state.story.seen.includes(b.key)) state.story.seen.push(b.key);
}

export { denDown, knockOutDen } from './dens.ts';

/** A story mission waiting for the player somewhere (for the what-next hint), or null. */
export function storyWaiting(state: GameState): { arc: Arc; job: JobDef } | null {
  if (ARC_JOBS.some((j) => state.jobs[j.id]?.status === 'active')) return null;
  for (const s of arcStatuses(state)) if (s.phase === 'available' && s.job) return { arc: s.arc, job: s.job };
  return null;
}
