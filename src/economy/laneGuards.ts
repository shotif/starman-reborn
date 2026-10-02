import { createNewGame } from '../app/state.ts';
import { CONVOY_NAMES } from '../content/contracts/rules.ts';
import { HAULER_NAMES } from '../content/economy/hauls.ts';
import { LAW } from '../content/law/rules.ts';
import { LANE_FICTION, LANE_LINES } from '../content/lanes/lines.ts';
import { ADRIFT_GOODS, LANE_KINDS, LANE_SHIPS, LANES, type LaneKind, type LaneRules } from '../content/lanes/rules.ts';
import { PASSENGERS } from '../content/passengers/rules.ts';
import { rng } from '../content/random.ts';
import type { Issue } from '../content/validate.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { getLocation, SYSTEMS, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { MAX_REWARD } from './contractGuards.ts';
import { laneBand, laneChoices, laneEncounter, laneOfferFor, laneSlot, stageLane, type LaneOffer } from './lanes.ts';
import { isLawful, lawIn } from './law.ts';
import { useWorldLog } from './events.ts';

/** What each kind's lines may use. */
const FIELDS: Record<LaneKind, readonly string[]> = {
  mayday: ['ship', 'name', 'credits', 'odds', 'system'],
  lifepod: ['ship', 'name', 'station', 'owner', 'fare', 'system'],
  toll: ['toll', 'system'],
  customs: ['owner', 'fine', 'bribe', 'odds', 'system'],
  scientist: ['name', 'sight', 'station', 'fare', 'credits', 'system'],
  cargo: ['qty', 'good', 'station', 'credits', 'odds', 'system'],
  trader: ['ship', 'name', 'credits', 'system'],
};

/** A quiet pilot's tour of the lanes (minutes in a system, then a jump), for how often encounters come. */
const TOUR = { stay: 480, jump: 120, systems: 120 };

/**
 * Guardrails for lane encounters (docs/PROCGEN.md §27.6): rules in range (chances rising with
 * lawlessness, traps only out of secure space, pay under the contracts' ceiling, tolls rising with the
 * threat); lines with no number of their own or field they cannot fill, short enough for the HUD and
 * the card, and choices the engine knows; ship names their own; and over every system and many slots,
 * none in Sol, each kind only where it fits, every kind somewhere, a fair share of slots holding one,
 * and a quiet pilot touring the lanes meeting one every quarter to half an hour or so.
 */
export function validateLanes(rules: LaneRules = LANES, slots = 240): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const K = rules.kinds;

  // The rules.
  const c = rules.chance;
  if (!(c.secure > 0 && c.secure <= c.patrolled && c.patrolled <= c.lawless && c.lawless < 1)) report('rules', 'chance', 'chances not rising with lawlessness within 0–1');
  if (!(rules.slotSeconds >= 300 && rules.cooldown >= rules.slotSeconds && rules.cooldown <= 3 * rules.slotSeconds)) report('rules', 'cooldown', 'slots or cooldown out of range');
  if (!(rules.hailSeconds >= 20 && rules.hailSeconds <= 120)) report('rules', 'hail', 'a hail that waits too briefly or too long');
  for (const k of LANE_KINDS) if (!(K[k].weight > 0)) report('rules', k, 'no weight');
  for (const [k, bait] of [['mayday', K.mayday.bait], ['cargo', K.cargo.bait]] as const) {
    if (bait.secure !== 0 || !(bait.patrolled >= 0 && bait.patrolled <= bait.lawless && bait.lawless <= 0.6)) report('rules', k, 'bait in secure space, or too often');
  }
  if (!(K.customs.sting > 0 && K.customs.sting <= 0.5 && K.customs.declare > 0 && K.customs.declare < 1 && K.customs.bribe > 0 && K.customs.bribe < K.customs.declare)) report('rules', 'customs', 'a sting, a declared share or a bribe out of range');
  if (!(K.customs.stingFine > 0 && K.customs.stingStanding < 0 && K.customs.dumpStanding < 0)) report('rules', 'customs', 'a sting or a dump that costs nothing');
  if (!(K.toll.toll[1] > 0 && K.toll.toll[1] < K.toll.toll[2] && K.toll.toll[2] < K.toll.toll[3])) report('rules', 'toll', 'tolls not rising with the threat');
  const pays = [K.mayday.reward[1], K.lifepod.fare[1], K.toll.toll[3], K.trader.fix];
  if (pays.some((p) => !(p > 0 && p <= MAX_REWARD)) || K.mayday.reward[0] > K.mayday.reward[1] || K.lifepod.fare[0] > K.lifepod.fare[1]) report('rules', 'pay', 'pay out of range');
  if (!(K.cargo.returnShare > 0 && K.cargo.returnShare < 1 && K.cargo.qty[0] >= 1 && K.cargo.qty[0] <= K.cargo.qty[1])) report('rules', 'cargo', 'a return share or a quantity out of range');
  if (ADRIFT_GOODS.some((g) => LAW.contraband.includes(g))) report('rules', 'cargo', 'contraband adrift');
  if (PASSENGERS.passage.party[0] > 1) report('rules', 'passage', 'passages do not take one passenger');

  // The words.
  for (const k of LANE_KINDS) {
    const lines = LANE_LINES[k];
    const check = (where: string, text: string, max: number) => {
      if (/\d/.test(text)) report('lines', `${k}.${where}`, `a number written into the line: “${text}”`);
      for (const [, f] of text.matchAll(/\{(\w+)\}/g)) if (!FIELDS[k].includes(f!)) report('lines', `${k}.${where}`, `{${f}} it cannot fill`);
      if (text.length > max) report('lines', `${k}.${where}`, `${text.length} characters (at most ${max})`);
    };
    check('hail', lines.hail, 160);
    check('scene', lines.scene, 300);
    if (lines.risk) check('risk', lines.risk, 120);
    check('lapse', lines.lapse, 160);
    for (const [id, o] of Object.entries(lines.options)) {
      check(`${id}.label`, o.label, 32);
      check(`${id}.outcome`, o.outcome, 200);
      if (o.trap) check(`${id}.trap`, o.trap, 200);
    }
  }
  if (/\d/.test(LANE_FICTION) || !LANE_FICTION.startsWith('Fiction:')) report('lines', 'fiction', 'the fiction line');
  const taken = new Set([...HAULER_NAMES, ...CONVOY_NAMES]);
  if (new Set(LANE_SHIPS).size !== LANE_SHIPS.length || LANE_SHIPS.some((n) => taken.has(n))) report('names', 'ships', 'a lane ship named twice, or like a hauler or a convoy');

  if (rules !== LANES) return issues;

  // The world: every system, many slots, and a quiet pilot touring the lanes.
  const stats = laneWorldStats(slots, (o, state) => checkOffer(o, report, state));
  if (stats.share < 0.25 || stats.share > 0.65) report('world', 'slots', `${Math.round(100 * stats.share)}% of slots hold an encounter (25–65%)`);
  for (const k of LANE_KINDS) if (!stats.kinds[k]) report('coverage', k, 'never met anywhere');
  if (stats.tourMinutes < 15 || stats.tourMinutes > 25) report('world', 'tour', `a pilot on tour meets one every ${stats.tourMinutes.toFixed(1)} minutes (15–25)`);
  return issues;
}

/**
 * How the world's slots fill: the share holding an encounter, how many of each kind, and how often a
 * quiet pilot touring the lanes (minutes in a system, then a jump onward) meets one, in minutes.
 */
export function laneWorldStats(slots = 240, each?: (o: LaneOffer, state: ReturnType<typeof createNewGame>) => void): { share: number; kinds: Partial<Record<LaneKind, number>>; tourMinutes: number } {
  const kinds: Partial<Record<LaneKind, number>> = {};
  let offers = 0;
  let total = 0;
  const state = createNewGame(1);
  state.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  useWorldLog(state.world);
  try {
    for (const s of SYSTEMS) {
      for (let slot = 10; slot < 10 + slots; slot += 7) {
        total++;
        const o = laneEncounter(s.id, slot);
        if (!o) continue;
        offers++;
        kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
        each?.(o, state);
      }
    }
    const tour = createNewGame(2);
    tour.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
    useWorldLog(tour.world);
    const r = rng(WORLD_SEED, 'lane-tour');
    let here = 'barnard' as SystemId;
    let met = 0;
    tour.clock = 6 * 3_600;
    const from = tour.clock;
    for (let i = 0; i < TOUR.systems; i++) {
      for (let t = 0; t < TOUR.stay; t += 30) {
        tour.clock += 30;
        const o = laneOfferFor(tour, here);
        if (o) {
          stageLane(tour, o);
          met++;
        }
      }
      tour.clock += TOUR.jump;
      const next = (WORLD.links.get(here) ?? []).filter((x) => x !== 'sol');
      if (next.length) here = r.pick(next);
    }
    return { share: offers / Math.max(1, total), kinds, tourMinutes: (tour.clock - from) / 60 / Math.max(1, met) };
  } finally {
    useWorldLog(null);
  }
}

/** One encounter, as the slot holds it: where it may be, and what it says and offers. */
function checkOffer(o: LaneOffer, report: (rule: string, subject: string, message: string) => void, state: ReturnType<typeof createNewGame>): void {
  const K = LANES.kinds;
  if (o.systemId === 'sol') report('world', o.id, 'an encounter in Sol');
  if (o.id !== `${o.systemId}.${o.slot}` || laneSlot(o.start) !== o.slot) report('world', o.id, 'an id or start that does not name its slot');
  const band = laneBand(o.systemId);
  if (o.trap && o.kind !== 'customs' && (o.kind === 'mayday' ? K.mayday.bait[band] : o.kind === 'cargo' ? K.cargo.bait[band] : 0) <= 0) report('world', o.id, `a trap where ${o.kind} is never one`);
  if (o.kind === 'toll' && (band !== 'lawless' || !o.level || o.toll !== K.toll.toll[o.level])) report('world', o.id, 'a toll outside lawless space, or of the wrong amount');
  if (o.kind === 'customs' && (!isLawful(lawIn(o.systemId)) || o.owner !== lawIn(o.systemId))) report('world', o.id, 'customs where no law is');
  if (o.stationId) {
    const st = getLocation(o.stationId);
    if (st.status !== 'functional' || st.dockable === false || st.stationType === 'pirate-den') report('world', o.id, `${o.stationId} is not an open station`);
    if ((o.kind === 'lifepod' || o.kind === 'cargo' || o.kind === 'trader') && st.systemId !== o.systemId) report('world', o.id, 'a station in another system');
    if (o.kind === 'scientist' && st.stationType !== 'research-station') report('world', o.id, 'a scientist bound for a station that is not a research station');
  }
  for (const v of [o.credits, o.fare, o.toll]) if (v !== undefined && !(v > 0 && v <= MAX_REWARD)) report('world', o.id, `pay of ${v}`);
  const ids = laneChoices(state, o).map((x) => x.id);
  const known = Object.keys(LANE_LINES[o.kind].options);
  if (ids.join() !== known.join()) report('world', o.id, 'choices that are not the lines’');
}
