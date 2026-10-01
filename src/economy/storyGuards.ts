import { findShip } from '../content/catalog.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { LAW } from '../content/law/rules.ts';
import { ARC_JOBS, ARC_ORDER, ARCS, CHARACTERS } from '../content/story/arcs.ts';
import { MARK_LIMITS, type LastingMark } from '../content/story/marks.ts';
import type { Line } from '../content/story/types.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../data/systems.ts';
import { getFront } from './border.ts';
import { JOBS, LIFELINE_ID, type JobDef, type Objective } from './jobs.ts';
import { LAWFUL } from './law.ts';
import { marketTables } from './markets.ts';
import { allMarks, markById } from './marks.ts';
import { objectiveSystem } from './story.ts';

/** How far a story mission may send the player from where it is given. */
export const STORY_MAX_JUMPS = 4;
const BRIEFING_MAX = 520;
const LINE_MAX = 300;

/**
 * Story guardrails (docs/PROCGEN.md §14.4, §20): every arc is a chain that can be finished (a
 * choice may branch it, each way to its own finale), sends the player only to real, open places
 * within reach, speaks with people who exist, keeps its choices meaningful (every way on leads
 * somewhere, every ending ends, one way on is open to every pilot), pays sensibly, and never asks
 * a lawful pilot for a crime; an arc of nobody's asks for one only of a pilot who chose the Wake.
 */
export function validateStory(arcJobs: readonly JobDef[] = ARC_JOBS): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const ids = new Set<string>();
  const functional = new Set(ALL_LOCATIONS.filter((l) => l.status === 'functional').map((l) => l.id));
  const isDen = (id: string) => getLocation(id).stationType === 'pirate-den';
  const leftBy = new Map<string, string>();
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
    const steps = Math.max(0, ...missions.map((m) => m.story!.step));
    if (steps < 4 || steps > 6) report('arc', arcId, `${steps} steps (four to six)`);
    if (!CHARACTERS[arc.giver] || missions[0]?.story?.speaker !== arc.giver) report('arc', arcId, 'the arc does not start with its giver');
    const lawful = arc.factionId !== null && LAWFUL.includes(arc.factionId as (typeof LAWFUL)[number]);
    const outlaw = arc.factionId === 'hollow-wake';
    const finaleReward = Math.max(...missions.map((m) => m.reward));
    const atStep = (step: number) => missions.filter((m) => m.story!.step === step);
    const choices = new Map(missions.flatMap((m) => m.objectives.filter((o): o is Extract<Objective, { kind: 'choice' }> => o.kind === 'choice').map((o) => [o.choiceId, o] as const)));
    for (let step = 1; step <= steps; step++) {
      const here = atStep(step);
      if (!here.length) report('chain', arcId, `no mission at step ${step}`);
      // A branch: missions sharing a step each follow different answers to one choice.
      if (here.length > 1) {
        const ways = here.map((m) => m.requires?.choice);
        const taken = ways.flatMap((w) => w?.oneOf ?? []);
        if (ways.some((w) => !w || w.id !== ways[0]!.id) || new Set(taken).size !== taken.length) report('chain', arcId, `the missions at step ${step} must follow different answers to one choice`);
      }
    }

    missions.forEach((job) => {
      const story = job.story!;
      const subject = job.id;
      if (ids.has(job.id) || !job.id.startsWith(`arc.${arcId}.`)) report('ids', subject, 'duplicate id, or not named arc.<arc>.<step>');
      ids.add(job.id);
      if (!!story.finale !== (story.step === steps)) report('chain', subject, 'the missions of the last step, and only they, are finales');
      if (story.step > 1) {
        // It follows a mission of the step before, on its own branch.
        const prev = atStep(story.step - 1).find((m) => m.id === job.requires?.jobComplete);
        const branch = prev?.requires?.choice;
        if (!prev) report('chain', subject, `does not follow a mission of step ${story.step - 1}`);
        else if (branch && (job.requires?.choice?.id !== branch.id || job.requires.choice.oneOf.some((x) => !branch.oneOf.includes(x)))) report('chain', subject, `leaves the branch of ${prev.id}`);
      } else if (!outlaw && job.requires?.jobComplete !== LIFELINE_ID) report('chain', subject, 'an arc not the Wake’s starts after the opening delivery');
      if (story.settles) {
        if (!story.finale) report('chain', subject, 'only a finale settles a front');
        if (!getFront(story.settles.front)) report('chain', subject, `no border front ${story.settles.front}`);
      }
      if (story.leaves) {
        if (!story.finale) report('chain', subject, 'only a finale leaves a lasting mark');
        if (!markById(story.leaves)) report('chain', subject, `no lasting mark ${story.leaves}`);
        else if (leftBy.has(story.leaves)) report('chain', subject, `${story.leaves} is already left by ${leftBy.get(story.leaves)}`);
        leftBy.set(story.leaves, job.id);
      }

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
        if (o.kind === 'escort' && (jumpsFrom(WORLD.links, getLocation(o.fromLocationId).systemId).get(o.systemId) ?? 99) > CONTRACTS.maxJumps.escort) {
          report('places', subject, `the escort sets off more than ${CONTRACTS.maxJumps.escort} jumps from where it is going`);
        }
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

      // The law: lawful arcs never ask for a crime; the Wake's arc is for pilots it trusts; an arc of
      // nobody's asks for a crime only on the branch of a choice only the Wake's friends can make.
      const contraband = (c: string) => (LAW.contraband as readonly string[]).includes(c);
      const crime = job.objectives.some((o) => o.kind === 'piracy' || o.kind === 'defend' || (o.kind === 'deliver' && contraband(o.commodity))) || (story.cargo && contraband(story.cargo.commodity));
      if (lawful && crime) report('law', subject, 'a lawful arc asks for a crime');
      if (crime && !lawful && !outlaw) {
        const way = job.requires?.choice;
        const options = way ? choices.get(way.id)?.options.filter((x) => way.oneOf.includes(x.id)) ?? [] : [];
        const wakeOnly = options.length > 0 && options.every((x) => x.requires?.minRep.faction === 'hollow-wake' && x.requires.minRep.value >= LAW.wakeFriendly);
        if (!wakeOnly) report('law', subject, 'asks for a crime of a pilot who did not choose the Wake');
      }
      if (outlaw && story.step === 1 && (job.requires?.minRep?.faction !== 'hollow-wake' || job.requires.minRep.value < LAW.wakeFriendly)) report('law', subject, 'the Wake’s arc is for pilots the Wake trusts');

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
        if (!o.options.some((x) => !x.ends && !x.requires)) report('choice', subject, 'one way on must be open to every pilot');
        for (const x of o.options) {
          const need = x.requires?.minRep;
          if (need && (need.value < -30 || need.value > 40)) report('choice', subject, `${x.id}: asks for standing out of range`);
        }
        const next = atStep(story.step + 1);
        if (next.length) {
          const allowed = next.flatMap((n) => (n.requires?.choice?.id === o.choiceId ? n.requires.choice.oneOf : []));
          if (onward.some((id) => !allowed.includes(id)) || allowed.some((id) => !onward.includes(id))) report('choice', subject, 'the next step must follow exactly the options that go on');
          for (const n of next) {
            const v = n.story?.variant;
            if (v?.choiceId === o.choiceId) {
              for (const id of onward) if (!v.briefing[id] || !v.debrief[id]) report('text', n.id, `no words for the choice ${id}`);
            }
          }
        }
      }
      if (story.variant && !missions.some((m) => m.story!.step < story.step && m.objectives.some((o) => o.kind === 'choice' && o.choiceId === story.variant!.choiceId))) {
        report('text', subject, 'its words follow a choice made nowhere before it');
      }
      // Echoes: words for choices made in the other arcs, each a real answer to a real question.
      for (const e of story.echoes ?? []) {
        const asked = arcJobs.flatMap((m) => m.objectives).find((o): o is Extract<Objective, { kind: 'choice' }> => o.kind === 'choice' && o.choiceId === e.choiceId);
        if (!asked || choices.has(e.choiceId)) report('text', subject, `echoes ${e.choiceId}, which no other arc asks`);
        for (const [id, text] of Object.entries(e.said)) {
          if (asked && !asked.options.some((x) => x.id === id)) report('text', subject, `echoes ${e.choiceId}: no answer ${id}`);
          if (!text.trim() || text.length > LINE_MAX) report('text', subject, `an echo of ${e.choiceId} is empty or longer than ${LINE_MAX} characters`);
        }
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
    });
  }
  return issues;
}

/**
 * Lasting-mark guardrails (docs/PROCGEN.md §14.7, §20.7): a mark changes an open station (or a
 * raider den) with a market, on goods it trades, within the bounds of a world event; a standing run
 * needs a job board, and carries the station's own produce to another open station within freight
 * reach that takes it, paid within reason; marks on one station never touch the same goods unless
 * no ending can leave both; and every mark is left either by exactly one finale or by the endings
 * of real border fronts.
 */
export function validateMarks(marks: readonly LastingMark[] = allMarks(), arcJobs: readonly JobDef[] = ARC_JOBS): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const live = (id: string) => ALL_LOCATIONS.some((l) => l.id === id && l.status === 'functional');
  const open = (id: string) => live(id) && getLocation(id).stationType !== 'pirate-den';
  const within = ([lo, hi]: readonly [number, number], x: number) => x >= lo && x <= hi;
  // Two marks can both be left unless they answer the same front with different endings.
  const exclusive = (a: LastingMark, b: LastingMark) => !!a.front && !!b.front && a.front.ending !== b.front.ending && a.front.ids.some((id) => b.front!.ids.includes(id));
  const seen = new Set<string>();
  for (const m of marks) {
    if (seen.has(m.id)) report('marks', m.id, 'duplicate id');
    seen.add(m.id);
    if (m.front) {
      if (!m.front.ids.length || m.front.ids.some((id) => !getFront(id))) report('marks', m.id, 'left by a border front that does not exist');
      if (arcJobs.some((j) => j.story?.leaves === m.id)) report('marks', m.id, 'left by a front and by a finale');
    } else if (arcJobs.filter((j) => j.story?.leaves === m.id && j.story.finale).length !== 1) report('marks', m.id, 'no finale leaves it');
    if (!m.headline.trim() || m.headline.length > 80 || !m.detail.trim() || m.detail.length > LINE_MAX) report('text', m.id, 'headline or detail empty or too long');
    if (!live(m.locationId)) {
      report('places', m.id, `${m.locationId} is not an open station`);
      continue;
    }
    const loc = getLocation(m.locationId);
    const here = marketTables().get(m.locationId);
    if (!here) report('places', m.id, `${m.locationId} has no market`);
    if (!m.market.goods.length || m.market.goods.some((c) => !here?.entries.has(c))) report('market', m.id, 'changes goods the station does not trade');
    if (!within(MARK_LIMITS.price, m.market.price) || !within(MARK_LIMITS.stock, m.market.stock)) report('market', m.id, 'price or stock out of bounds');
    for (const other of marks) {
      if (other !== m && other.locationId === m.locationId && !exclusive(m, other) && other.market.goods.some((c) => m.market.goods.includes(c))) report('market', m.id, `touches the same goods as ${other.id}`);
    }
    if (!m.run) continue;
    if (!m.run.title.trim() || !m.run.why.trim() || m.run.why.length > LINE_MAX) report('text', m.id, 'the run needs a title and a reason');
    if (!loc.services.includes('contracts') || loc.stationType === 'pirate-den') report('places', m.id, `${m.locationId} has no job board for the run`);
    if (here?.entries.get(m.run.commodity)?.role !== 'produce') report('run', m.id, `the station does not make ${m.run.commodity}`);
    if (!open(m.run.to) || m.run.to === m.locationId) report('run', m.id, `${m.run.to} is not another open station`);
    else {
      const there = marketTables().get(m.run.to)?.entries.get(m.run.commodity);
      if (!there || there.role === 'produce') report('run', m.id, `${m.run.to} does not take ${m.run.commodity}`);
      const jumps = jumpsFrom(WORLD.links, loc.systemId).get(getLocation(m.run.to).systemId) ?? Infinity;
      if (jumps > CONTRACTS.maxJumps.freight) report('run', m.id, `${m.run.to} is beyond freight reach`);
    }
    if (!within(MARK_LIMITS.premium, m.run.premium)) report('run', m.id, 'pays out of bounds');
  }
  return issues;
}
