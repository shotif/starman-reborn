import { findShip } from '../content/catalog.ts';
import { LAW } from '../content/law/rules.ts';
import { ARC_JOBS, ARC_ORDER, ARCS, CHARACTERS } from '../content/story/arcs.ts';
import type { Line } from '../content/story/types.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../data/systems.ts';
import { JOBS, LIFELINE_ID, type JobDef } from './jobs.ts';
import { LAWFUL } from './law.ts';
import { objectiveSystem } from './story.ts';

/** How far a story mission may send the player from where it is given. */
export const STORY_MAX_JUMPS = 4;
const BRIEFING_MAX = 520;
const LINE_MAX = 300;

/**
 * Story guardrails (docs/PROCGEN.md §14.4): every arc is a chain that can be finished, sends the
 * player only to real, open places within reach, speaks with people who exist, keeps its choices
 * meaningful (every way on leads somewhere, every ending ends), pays sensibly, and never asks a
 * lawful pilot for a crime.
 */
export function validateStory(arcJobs: readonly JobDef[] = ARC_JOBS): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const ids = new Set<string>();
  const functional = new Set(ALL_LOCATIONS.filter((l) => l.status === 'functional').map((l) => l.id));
  const isDen = (id: string) => getLocation(id).stationType === 'pirate-den';
  const checkLines = (subject: string, lines: readonly Line[]) => {
    for (const l of lines) {
      if (l.who !== 'comm' && !CHARACTERS[l.who]) report('text', subject, `unknown speaker ${l.who}`);
      if (!l.text.trim() || l.text.length > LINE_MAX) report('text', subject, `a line is empty or longer than ${LINE_MAX} characters`);
    }
  };

  if (!JOBS.some((j) => j.id === LIFELINE_ID)) report('opening', LIFELINE_ID, 'the opening delivery is missing');
  for (const c of Object.values(CHARACTERS)) {
    if (!functional.has(c.locationId)) report('people', c.id, `${c.locationId} is not an open station`);
  }

  for (const arcId of ARC_ORDER) {
    const arc = ARCS[arcId];
    const missions = arcJobs.filter((j) => j.story?.arc === arcId).sort((a, b) => a.story!.step - b.story!.step);
    if (missions.length < 4 || missions.length > 6) report('arc', arcId, `${missions.length} missions (four to six)`);
    if (!CHARACTERS[arc.giver] || missions[0]?.story?.speaker !== arc.giver) report('arc', arcId, 'the arc does not start with its giver');
    const lawful = LAWFUL.includes(arc.factionId as (typeof LAWFUL)[number]);
    let prev: JobDef | null = null;
    const finaleReward = Math.max(...missions.map((m) => m.reward));

    missions.forEach((job, i) => {
      const story = job.story!;
      const subject = job.id;
      if (ids.has(job.id) || !job.id.startsWith(`arc.${arcId}.`)) report('ids', subject, 'duplicate id, or not named arc.<arc>.<step>');
      ids.add(job.id);
      if (story.step !== i + 1) report('chain', subject, `step ${story.step} where ${i + 1} was expected`);
      if (!!story.finale !== (i === missions.length - 1)) report('chain', subject, 'the last mission, and only it, is the finale');
      if (prev && job.requires?.jobComplete !== prev.id) report('chain', subject, `does not follow ${prev.id}`);
      if (!prev && arcId !== 'wake' && job.requires?.jobComplete !== LIFELINE_ID) report('chain', subject, 'a lawful arc starts after the opening delivery');

      // People and places.
      const speaker = CHARACTERS[story.speaker];
      if (!speaker) report('people', subject, `unknown speaker ${story.speaker}`);
      else if (speaker.locationId !== job.giverLocationId) report('people', subject, `${speaker.name} is not at ${job.giverLocationId}`);
      if (job.factionId !== arc.factionId) report('people', subject, 'given by another faction');
      const places = [job.giverLocationId, job.destinationLocationId, ...job.objectives.flatMap((o) => ('locationId' in o ? [o.locationId] : [])), ...job.objectives.flatMap((o) => (o.kind === 'escort' ? [o.fromLocationId] : []))];
      for (const id of places) {
        if (!functional.has(id)) {
          report('places', subject, `${id} is not a functional station`);
          continue;
        }
        const loc = getLocation(id);
        const dockOnly = job.objectives.some((o) => (o.kind === 'assault' || o.kind === 'defend') && o.locationId === id);
        if (isDen(id) && !dockOnly && arcId !== 'wake') report('places', subject, `${id} is a raider den, open only to Wake friends`);
        if (!isDen(id) && loc.dockable === false) report('places', subject, `${id} cannot be docked at`);
      }
      const giverSystem = getLocation(job.giverLocationId).systemId;
      const jumps = jumpsFrom(WORLD.links, giverSystem);
      for (const [k, o] of job.objectives.entries()) {
        const sys = objectiveSystem(o);
        if ('systemId' in o && 'locationId' in o && getLocation(o.locationId).systemId !== o.systemId) report('places', subject, `objective ${k}: ${o.locationId} is not in ${o.systemId}`);
        if (o.kind === 'escort' && getLocation(o.fromLocationId).systemId !== o.systemId) report('places', subject, 'the escort starts in another system');
        if (sys && (jumps.get(sys) ?? 99) > STORY_MAX_JUMPS) report('reach', subject, `objective ${k} is more than ${STORY_MAX_JUMPS} jumps from the giver`);
        if (o.kind === 'assault' || o.kind === 'defend') {
          if (!isDen(o.locationId)) report('finale', subject, `${o.locationId} is not a raider den`);
          if (!story.finale) report('finale', subject, 'den fights are finales');
        }
        if (o.kind === 'escort') {
          if (!findShip(o.model)) report('escort', subject, `unknown ship ${o.model}`);
          if (o.convoy && (o.convoy.need < 1 || o.convoy.need > o.convoy.names.length || o.convoy.waves < 1)) report('escort', subject, 'a convoy needs ships, waves and a need it can meet');
        }
        if (o.kind === 'deliver' && story.cargo && story.cargo.commodity === o.commodity && story.cargo.qty < o.qty) report('cargo', subject, 'hands over less cargo than it asks for');
        if (!o.text.trim()) report('text', subject, `objective ${k} has no text`);
      }

      // The law: lawful arcs never ask for a crime; the Wake's arc is for pilots it trusts.
      const contraband = (c: string) => (LAW.contraband as readonly string[]).includes(c);
      const crime = job.objectives.some((o) => o.kind === 'piracy' || o.kind === 'defend' || (o.kind === 'deliver' && contraband(o.commodity))) || (story.cargo && contraband(story.cargo.commodity));
      if (lawful && crime) report('law', subject, 'a lawful arc asks for a crime');
      if (!lawful && i === 0 && (job.requires?.minRep?.faction !== 'hollow-wake' || job.requires.minRep.value < LAW.wakeFriendly)) report('law', subject, 'the Wake’s arc is for pilots the Wake trusts');

      // Choices: two or three ways, each with a consequence; every way on leads to the next step.
      for (const o of job.objectives) {
        if (o.kind !== 'choice') continue;
        if (o.locationId !== job.giverLocationId) report('choice', subject, 'a choice is made where the mission is given');
        if (o.options.length < 2 || o.options.length > 3 || new Set(o.options.map((x) => x.id)).size !== o.options.length) report('choice', subject, 'two or three distinct options');
        for (const x of o.options) {
          const deltas = Object.values(x.rep);
          if (!deltas.length || deltas.some((d) => Math.abs(d) > 50)) report('choice', subject, `${x.id}: standing must change, by at most 50`);
          if ((x.credits ?? 0) < 0 || (x.credits ?? 0) > 5_000) report('choice', subject, `${x.id}: credits out of range`);
          if (!x.label.trim() || !x.outcome.trim()) report('text', subject, `${x.id}: label and outcome`);
        }
        const onward = o.options.filter((x) => !x.ends).map((x) => x.id);
        if (!onward.length) report('choice', subject, 'every option ends the arc');
        const next = missions[i + 1];
        if (next) {
          const allowed = next.requires?.choice?.id === o.choiceId ? next.requires.choice.oneOf : [];
          if (onward.some((id) => !allowed.includes(id)) || allowed.some((id) => !onward.includes(id))) report('choice', subject, 'the next step must follow exactly the options that go on');
          const v = next.story?.variant;
          if (v?.choiceId === o.choiceId) {
            for (const id of onward) if (!v.briefing[id] || !v.debrief[id]) report('text', next.id, `no words for the choice ${id}`);
          }
        }
      }
      if (story.variant && !missions.slice(0, i).some((m) => m.objectives.some((o) => o.kind === 'choice' && o.choiceId === story.variant!.choiceId))) {
        report('text', subject, 'its words follow a choice made nowhere before it');
      }

      // Pay: decisions pay through their options; missions pay sensibly and the finale most of all.
      const decision = job.objectives.every((o) => o.kind === 'choice');
      if (decision ? job.reward !== 0 : job.reward < 300 || job.reward > 6_000) report('pay', subject, `reward ${job.reward}`);
      if (story.finale && job.reward < finaleReward) report('pay', subject, 'the finale pays the most in its arc');

      // Words.
      if (!job.briefing.trim() || job.briefing.length > BRIEFING_MAX) report('text', subject, `briefing empty or longer than ${BRIEFING_MAX} characters`);
      for (const b of Object.values(story.variant?.briefing ?? {})) if (b.length > BRIEFING_MAX) report('text', subject, 'a variant briefing is too long');
      for (const b of story.beats ?? []) {
        if (b.after < 0 || b.after >= job.objectives.length) report('text', subject, `a beat after objective ${b.after}, which does not exist`);
        checkLines(subject, b.lines);
      }
      for (const c of story.comms ?? []) {
        if (c.at < 0 || c.at >= job.objectives.length || !objectiveSystem(job.objectives[c.at])) report('text', subject, `comms at objective ${c.at}, which has no system`);
        checkLines(subject, c.lines);
      }
      checkLines(subject, story.debrief ?? []);
      for (const lines of Object.values(story.variant?.debrief ?? {})) checkLines(subject, lines);
      if (!story.finale && !(story.debrief ?? []).length && !decision) report('text', subject, 'a mission with no debrief');
      prev = job;
    });
  }
  return issues;
}
