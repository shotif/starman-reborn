import type { Hauler } from '../app/state.ts';
import { FLEET } from '../content/fleet/rules.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { haulDock, haulRisk, haulTimes, routeSystems, runLuck, runRaid, runWay, type RunRaid, type RunWay } from './fleet.ts';
import { systemEventAt } from './events.ts';
import { security } from './tradeComputer.ts';

/** A run to check (docs/PROCGEN.md §18.6): its route, when it began loading, its way and the raid it meets. */
export interface RunSample {
  from: string;
  to: string;
  since: number;
  way: RunWay;
  raid: RunRaid | null;
}

/**
 * Guardrails for the player's captains on the lanes (docs/PROCGEN.md §18.6): every run takes a
 * finite time; its way runs through the route's systems along real lanes, out and home again, in
 * legs in order with a jump between, starting when the loading is done and taking the run's time
 * each way; its raid strikes in a system of the way out, at the middle of its leg there, where the
 * rules say (a system with a raid under way when it set out, else the least secure); and the rules
 * make sense.
 */
export function validateFleetLanes(samples: readonly RunSample[] = sampleRuns()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });

  // The rules.
  for (const [danger, level] of Object.entries(FLEET.lanes.ambush)) if (![1, 2, 3].includes(level)) report('rules', `ambush.${danger}`, 'a threat level out of 1–3');
  if (Object.values(FLEET.risk.raided).some((p) => p < 0 || p > 1) || FLEET.risk.shipLost < 0 || FLEET.risk.shipLost > 1) report('rules', 'risk', 'a chance out of 0–1');
  if (FLEET.risk.payout < 0 || FLEET.risk.payout > 1) report('rules', 'payout', 'insurance pays back more than the ship');

  for (const r of samples) {
    const subject = `${r.from} → ${r.to}`;
    const { load, oneWay, run } = haulTimes(r.from, r.to);
    if (!Number.isFinite(run) || oneWay <= 0 || run !== load + 2 * oneWay) {
      report('times', subject, `a run of ${run} s`);
      continue;
    }
    const path = routeSystems(getLocation(r.from).systemId, getLocation(r.to).systemId);
    const depart = r.since + load;
    checkWay(report, `${subject} out`, r.way.out, path, depart, oneWay);
    checkWay(report, `${subject} back`, r.way.back, [...path].reverse(), depart + oneWay, oneWay);
    if (r.raid) checkRaid(report, subject, r.raid, r.way.out, depart);
  }
  return issues;
}

type Report = (rule: string, subject: string, message: string) => void;

function checkWay(report: Report, subject: string, legs: RunWay['out'], path: readonly SystemId[], depart: number, seconds: number): void {
  if (legs.length !== path.length || legs.some((l, i) => l.systemId !== path[i])) {
    report('way', subject, 'its legs are not the route’s systems, in order');
    return;
  }
  for (let i = 1; i < path.length; i++) if (!WORLD.links.get(path[i - 1]!)?.includes(path[i]!)) report('way', subject, `no lane ${path[i - 1]}–${path[i]}`);
  const kinds = legs.map((l) => l.kind);
  const shape = legs.length === 1 ? kinds[0] === 'local' : kinds[0] === 'out' && kinds.at(-1) === 'in' && kinds.slice(1, -1).every((k) => k === 'transit');
  if (!shape) report('way', subject, `legs of the wrong kinds (${kinds.join(', ')})`);
  if (legs[0]!.start !== depart || legs.at(-1)!.end !== depart + seconds) report('timing', subject, 'its legs do not span the run’s time each way');
  // Every jump takes the same time (the timetable's, scaled to the run's), give or take a second's rounding.
  const jumps: number[] = [];
  legs.forEach((l, i) => {
    if (l.end <= l.start) report('timing', subject, `leg ${i} takes no time`);
    if (i > 0) jumps.push(l.start - legs[i - 1]!.end);
  });
  if (jumps.some((j) => j <= 0 || Math.abs(j - jumps[0]!) > 1)) report('timing', subject, 'a jump out of time');
}

function checkRaid(report: Report, subject: string, raid: RunRaid, out: RunWay['out'], setOff: number): void {
  const leg = out.find((l) => l.systemId === raid.systemId);
  if (!leg) {
    report('raid', subject, `raiders strike in ${raid.systemId}, off the way`);
    return;
  }
  if (Math.abs(raid.at - (leg.start + leg.end) / 2) > 1e-6) report('raid', subject, 'raiders strike away from the middle of the leg');
  const systems = out.map((l) => l.systemId);
  const raided = systems.find((s) => systemEventAt(s, setOff)?.kind === 'raid');
  const expected = raided ?? systems.reduce((worst, s) => (security(s) < security(worst) ? s : worst));
  if (raid.systemId !== expected) report('raid', subject, `raiders strike in ${raid.systemId}, not ${expected}`);
  if (!['patrolled', 'thin', 'lawless'].includes(raid.level)) report('raid', subject, `an unknown danger ${raid.level}`);
}

/**
 * Runs to check: from every dock a captain loads at, to every other within two jumps, and from
 * Halcyon Ring to every dock in reach (the frontier's long routes among them), each with the raid it
 * meets on the first run its luck sends raiders against (searching the save's seed).
 */
export function sampleRuns(): RunSample[] {
  const docks = ALL_LOCATIONS.filter((l) => l.status === 'functional' && haulDock(l.id));
  const pairs: [string, string][] = [];
  for (const a of docks) {
    const jumps = jumpsFrom(WORLD.links, a.systemId);
    for (const b of docks) {
      if (a.id !== b.id && ((jumps.get(b.systemId) ?? Infinity) <= 2 || a.id === 'earth-port')) pairs.push([a.id, b.id]);
    }
  }
  return pairs.map(([from, to], i) => {
    const since = 600 + (i % 50) * 3_600;
    const hauler: Hauler = { captain: 'Test', route: { from, to, commodity: 'food' }, insured: false, hired: since, leg: 'out', since, cost: 0, waiting: null, waits: 0, recalled: false, runs: 0, earned: 0 };
    const way = runWay(hauler);
    const odds = haulRisk(from, to, since + FLEET.haulers.loadSeconds).raided;
    let raid: RunRaid | null = null;
    for (let seed = 0; seed < 4_000 && !raid; seed++) {
      if (runLuck(seed, 'ship-1', since, 0).raid >= odds) continue;
      raid = runRaid(seed, { id: 'ship-1', hauler });
    }
    return { from, to, since, way, raid };
  });
}
