import { getCatalog, shipModel } from '../content/catalog.ts';
import { CREW_ROLES } from '../content/crew/rules.ts';
import { EVENTS } from '../content/events/rules.ts';
import { CODEX_GRANT, RATINGS } from '../content/progress/rules.ts';
import { CLASS_HULLS, CLASS_NAMES, CLUB_NAMES, COURSE_NAMES, KIND_NAMES, KIND_NOTES, RACE_CARD, RACE_LINES, RACE_NEWS, RACING_FICTION, RIVAL_START } from '../content/racing/lines.ts';
import { COURSE_KINDS, RACE_CLASSES, RACING, type RacingRules } from '../content/racing/rules.ts';
import { RANKS } from '../content/ranks/rules.ts';
import { rng } from '../content/random.ts';
import { ROSTER } from '../content/rivals/rules.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import { jumpsFrom } from '../content/world/network.ts';
import type { Issue } from '../content/validate.ts';
import { ALL_LOCATIONS, getLocation, SYSTEMS, WORLD } from '../data/systems.ts';
import type { ShipParams } from '../flight/ShipBody.ts';
import { courseIssues, placedLine, type CourseLine } from '../world/courses.ts';
import { flyOn, newPilotState, racerOnLine, simulateRun, skillFor, type Obstruction } from '../world/racingPilot.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { MAX_REWARD } from './contractGuards.ts';
import { FACTIONS, TIER_LABEL } from './factions.ts';
import { isLawful } from './law.ts';
import { performanceOf } from './loadout.ts';
import { classPar, cleanTime, clubRecord, gridOf, lineUp, raceClass, rivalsOfClub, venues } from './racing.ts';

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
const stock = (model: string): ShipParams => performanceOf({ model, fittings: { ...shipModel(model).stock } }).flight;

/**
 * Guardrails for races on the lanes (docs/PROCGEN.md §33.8): the rules in range; pay that never
 * out-earns trading; words with no number, no he or she, no star, only their fields and short enough;
 * club names of their own; ten to twenty clubs in well-policed space, Sol's among them; every course
 * clear of bodies, docks, lanes and belts, and flyable in every class's fastest and slowest hull,
 * even with the stick held to what touch manages; no racer in a sampled heat beating the record; and a
 * pilot of the racing pilot's skill winning and placing about as often as the levels intend.
 * `heats`: heats sampled per course and class.
 */
export function validateRacing(rules: RacingRules = RACING, heats = 3): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const ordered = (p: readonly number[]) => p.every((v, i) => i === 0 || v >= p[i - 1]!);

  // The rules.
  if (!(rules.heatSeconds >= 1_200 && rules.heatSeconds <= 3_600)) report('rules', 'heat', 'a heat too short or too long');
  const maxRadius = Math.max(...getCatalog().ships.map((m) => m.radius));
  for (const kind of COURSE_KINDS) {
    const S = rules[kind];
    if (![S.gates, S.leg, S.length, S.ring, S.arc].every((p) => p[0] > 0 && p[0] <= p[1]) || S.gates[0] < 4) report('rules', kind, 'a range out of order');
    if (S.gate < (kind === 'sprint' ? maxRadius * 10 : 200)) report('rules', kind, 'gates too narrow to thread on touch');
    if (S.cruise !== (kind === 'run')) report('rules', kind, 'cruise allowed on the wrong course');
    if (rules.clear.apart < rules.sprint.gate * 6) report('rules', kind, 'gates too close together');
  }
  if (rules.maxTurn > (120 * Math.PI) / 180) report('rules', 'turns', 'a turn sharper than 120°');
  if (!(rules.start.box > rules.sprint.gate && rules.start.countdown >= 2 && rules.start.countdown <= 5 && rules.start.earlyClose < rules.heatSeconds / 2)) report('rules', 'start', 'a start box, countdown or early close out of range');
  if (!(rules.cutoff >= 2 && rules.cutoff <= 4)) report('rules', 'cutoff', 'the marshals close too soon or too late');
  const hulls = RACE_CLASSES.flatMap((c) => rules.classes[c].hulls);
  if (new Set(hulls).size !== hulls.length || new Set(getCatalog().ships.map((m) => m.class)).size !== hulls.length) report('rules', 'classes', 'a hull class in no class, or in two');
  for (const c of RACE_CLASSES) if (!rules.classes[c].hulls.includes(shipModel(rules.classes[c].ref).class)) report('rules', c, 'a reference hull of another class');
  const L = rules.levels;
  if (!L.tiers.every((t, i) => t[0] >= 1 && t[0] <= t[1] && t[1] <= 3 && (i === 0 || t[0] >= L.tiers[i - 1]![0]))) report('rules', 'levels', 'tiers not rising');
  if (!L.skill.every((t, i) => t[0] >= 0.8 && t[0] <= t[1] && t[1] <= 1.05 && (i === 0 || t[0] > L.skill[i - 1]![0]))) report('rules', 'levels', 'skill not rising within 0.8–1.05');
  if (!(ordered(L.purse) && L.purse[2] === 1 && L.purse[0] > 0)) report('rules', 'levels', 'purses not rising to the full purse');
  if (!(rules.record[0] > 0.9 && rules.record[0] <= rules.record[1] && rules.record[1] < 1)) report('rules', 'record', 'a record not a little better than the best racer');
  const P = rules.pilot;
  if (P.step !== 1 / 60 || P.steer[0] < 0.7 || P.offset > 0.6 || P.slip.chance[0] >= 0.35 || P.slip.chance[1] > P.slip.chance[0]) report('rules', 'pilot', 'the racing pilot out of range');
  const F = rules.field;
  if (!(F.size >= 4 && F.size <= 8 && F.size <= F.members && F.club + F.rivals >= F.size && F.size - F.rivals >= 3 && F.jitter > 0 && F.jitter <= 0.05)) report('rules', 'field', 'a field too small, too big or without enough club racers');
  for (const [style, [a, b]] of Object.entries(rules.rivalSkill)) if (!(a >= 0.8 && a <= b && b <= 1.05)) report('rules', style, 'a rival’s skill out of range');

  // The pay.
  const pay = rules.pay;
  for (const kind of COURSE_KINDS) {
    if (pay.fee[kind] < pay.purse[kind] * 0.1) report('balance', kind, 'a fee too small for its purse');
    if (pay.purse[kind] > MAX_REWARD * 0.25) report('balance', kind, 'a purse over a quarter of the contracts’ ceiling');
  }
  const shares = pay.places as readonly number[];
  if (!(shares[0] === 1 && shares.every((v, i) => i === 0 || v < shares[i - 1]!) && shares.reduce((x, y) => x + y, 0) <= 1.7)) report('balance', 'places', 'places not falling, or paying too much');
  if (((pay.purse.run - pay.fee.run) * 3_600) / rules.heatSeconds > 2_000) report('balance', 'hourly', 'racing out-earns trading');
  if (pay.record * 4 * rules.venues.count[1] > CODEX_GRANT) report('balance', 'record', 'record purses worth more than cataloguing the sky');
  if (!(rules.standing.raced > 0 && rules.standing.raced <= 3 && rules.standing.upTo <= 40)) report('balance', 'standing', 'standing with rivals out of range');
  if (rules.keep.results < 8 || !(rules.news.jumps >= 0 && rules.news.jumps <= EVENTS.newsJumps && rules.news.seconds >= 1_800 && rules.news.seconds <= 7_200)) report('rules', 'news', 'results kept too few, or the News too far or too long');
  const R = RATINGS.racing.ranks;
  if (!(R.length === 6 && R[0]![1] === 0 && R.every(([, n], i) => i === 0 || n > R[i - 1]![1]))) report('rules', 'rating', 'not six ranks rising from nothing');

  // The words.
  const reserved = new Set<string>([
    ...Object.values(TIER_LABEL),
    ...Object.entries(RATINGS).flatMap(([k, r]) => (k === 'racing' ? [] : r.ranks.map(([n]) => n))),
    ...Object.values(RANKS.ladders).flatMap((l) => l.names),
    ...CREW_ROLES.map((r) => r.charAt(0).toUpperCase() + r.slice(1)),
  ]);
  for (const [n] of R) if (reserved.has(n) || n.length > 12 || /\d/.test(n)) report('names', n, 'a Racing rank named like a standing, rank, rating or crew role, or too long');
  const words = new Set<string>([
    ...ALL_LOCATIONS.flatMap((l) => l.name.split(/\s+/)),
    ...SYSTEMS.flatMap((s) => s.displayName.split(/\s+/)),
    ...Object.values(FACTIONS).flatMap((f) => f.name.split(/\s+/)),
    ...Object.values(CHARACTERS).flatMap((c) => [...c.name.split(' '), ...(c.role ? c.role.split(/\s+/) : [])]),
    ...ROSTER.flatMap((r) => [r.first, r.last, ...r.nick.split(/\s+/), ...r.shipName.split(/\s+/)]),
    ...Object.values(RANKS.ladders).flatMap((l) => l.names.flatMap((n) => n.split(/\s+/))),
  ]);
  const common = new Set(['Club', 'Flyers', 'Racing', 'Society']);
  if (new Set(CLUB_NAMES).size !== CLUB_NAMES.length) report('names', 'clubs', 'a club named twice');
  for (const n of CLUB_NAMES) {
    if (n.length > 24 || /\d/.test(n)) report('names', n, 'a club name too long, or with a number');
    if (n.split(/\s+/).some((w) => !common.has(w) && words.has(w))) report('names', n, 'a club sharing a word with a place, faction, character, rival or rank');
  }
  const stars = SYSTEMS.map((s) => s.displayName.split(' ')[0]!).filter((w) => w.length > 3);
  const check = (subject: string, text: string, allowed: readonly string[], max: number) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (GENDERED.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    if (text.length > max) report('lines', subject, `${text.length} characters (at most ${max})`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
    for (const s of stars) if (new RegExp(`\\b${s}\\b`).test(text)) report('lines', subject, `a star written into the line (${s})`);
  };
  for (const [k, t] of Object.entries(RACE_LINES.objective)) check(`objective.${k}`, t, ['course', 'n', 'of'], 60);
  for (const [k, t] of Object.entries(RACE_LINES)) if (typeof t === 'string') check(`line.${k}`, t, ['n', 'time', 'class'], 120);
  for (const t of RACE_LINES.countdown) check('countdown', t, [], 12);
  for (const [v, list] of Object.entries(RIVAL_START)) for (const t of list) check(`rival.${v}`, t, [], 80);
  for (const [k, t] of Object.entries(RACE_CARD)) for (const x of typeof t === 'string' ? [t] : t) check(`card.${k}`, x, ['course', 'place', 'prize', 'points', 'faction'], 120);
  for (const [k, n] of Object.entries(RACE_NEWS)) {
    check(`news.${k}.headline`, n.headline, ['club', 'course', 'station', 'time', 'class'], 60);
    check(`news.${k}.text`, n.text, ['club', 'course', 'station', 'time', 'class'], 160);
  }
  for (const [k, t] of Object.entries({ ...COURSE_NAMES })) check(`course.${k}`, t, ['body', 'from', 'to'], 24);
  for (const t of [...Object.values(CLASS_NAMES), ...Object.values(CLASS_HULLS), ...Object.values(KIND_NAMES), ...Object.values(KIND_NOTES)]) check('names', t, [], 60);
  if (/\d/.test(RACING_FICTION) || !RACING_FICTION.startsWith('Fiction:')) report('lines', 'fiction', 'the fiction line');

  if (rules !== RACING) return issues;

  // The world: the clubs.
  const list = venues();
  if (list.length < rules.venues.count[0] || list.length > rules.venues.count[1] || list.length > CLUB_NAMES.length) report('world', 'clubs', `${list.length} clubs`);
  if (!list.some((v) => v.systemId === 'sol')) report('world', 'sol', 'no club in Sol');
  const fromSol = jumpsFrom(WORLD.links, 'sol');
  if (list.filter((v) => v.level === 1 && (fromSol.get(v.systemId) ?? Infinity) <= 3).length < 2) report('world', 'novices', 'fewer than two novice clubs near Sol');
  for (const level of [1, 2, 3]) if (!list.some((v) => v.level === level)) report('world', `level ${level}`, 'no club at this level');
  for (const v of list) {
    const loc = getLocation(v.locationId);
    if (v.systemId === 'pyre' || (WORLD.profiles.get(v.systemId)?.security ?? 1) < rules.venues.minSecurity || (loc.factionId && !isLawful(loc.factionId)) || loc.status !== 'functional') report('world', v.locationId, 'a club somewhere it should not be');
  }
  for (const f of ['sta', 'frontier'] as const) if (list.filter((v) => getLocation(v.locationId).factionId === f).length < 3) report('world', f, 'fewer than three clubs');
  for (const r of ROSTER) if (!list.some((v) => rivalsOfClub(v, raceClass(r.ship)).some((x) => x.id === r.id))) report('world', r.id, 'a rival with no club to race at');

  // The courses: clear and flyable.
  for (const v of list) for (const kind of COURSE_KINDS) checkCourse(v.courses[kind], report);

  // The heats: nobody beats the record; the levels as hard as they should be.
  const tally = new Map<string, { heats: number; wins: number; podiums: number }>();
  for (const v of list)
    for (const kind of COURSE_KINDS)
      for (const cls of RACE_CLASSES) {
        const line = v.courses[kind];
        const record = clubRecord(line.id, cls)!;
        const players = { mk1: RACING.classes[cls].ref, mk2: cls === 'light' ? 'ship.courier.2.halden' : 'ship.freighter.2.halden' };
        const pars = Object.fromEntries(Object.entries(players).map(([k, m]) => [k, cleanTime(line, stock(m), 1, m)!]));
        for (let i = 0; i < heats; i++) {
          const heat = rng(WORLD_SEED, 'guard-heat', line.id, cls).int(0, 50_000) + i * 7;
          const field = lineUp(null, line.id, cls, heat);
          const times = field.map((r) => flyOn(racerOnLine(stock(r.model), line, r.slot, gridOf(field)), line, r.skill, newPilotState(), Math.ceil((rules.cutoff * classPar(line, cls)) / rules.pilot.step)).finish);
          times.forEach((t, j) => {
            if (t === null) report('world', `${line.id}.${cls}`, `${field[j]!.name} never finishes heat ${heat}`);
            else if (t < record.time) report('world', `${line.id}.${cls}`, `${field[j]!.name} beats the record in heat ${heat}`);
          });
          for (const [who, par] of Object.entries(pars)) {
            const key = `${who}.${v.level}`;
            const t = tally.get(key) ?? { heats: 0, wins: 0, podiums: 0 };
            const place = 1 + times.filter((x) => x !== null && x < par).length;
            t.heats++;
            if (place === 1) t.wins++;
            if (place <= 3) t.podiums++;
            tally.set(key, t);
          }
        }
      }
  const share = (key: string, what: 'wins' | 'podiums') => {
    const t = tally.get(key);
    return t && t.heats ? t[what] / t.heats : 0;
  };
  const band = (key: string, what: 'wins' | 'podiums', lo: number, hi: number, note: string) => {
    const x = share(key, what);
    if (x < lo || x > hi) report('balance', key, `${note}: ${Math.round(x * 100)}% (want ${Math.round(lo * 100)}–${Math.round(hi * 100)}%)`);
  };
  band('mk1.1', 'wins', 0.3, 0.9, 'a par pilot in a Mk I hull wins at novice clubs');
  band('mk2.2', 'wins', 0.15, 0.65, 'a par pilot in a Mk II hull wins at clubs');
  band('mk2.2', 'podiums', 0.5, 0.97, 'a par pilot in a Mk II hull places at clubs');
  band('mk2.3', 'podiums', 0.05, 0.6, 'a par pilot in a Mk II hull places at fast clubs');
  band('mk1.3', 'wins', 0, 0.05, 'a par pilot in a Mk I hull wins at fast clubs');
  return issues;
}

/**
 * A course clear in its scene (and Sol's across a whole cycle of the planets, as laid), and flyable:
 * the racing pilot gets round in each class's fastest and slowest hull inside the cutoff, the slowest
 * also with the stick held to what touch manages, never within 300 m of a star's or planet's surface.
 */
function checkCourse(laid: CourseLine, report: (rule: string, subject: string, message: string) => void): void {
  const def = sceneDefFor(laid.systemId);
  const line = placedLine(def, laid);
  const body = def.planets.find((p) => p.id === line.bodyId) ?? def.stars.find((s) => s.id === line.bodyId);
  if (!body) return report('world', line.id, 'a course round no body');
  for (const issue of courseIssues(def, line.gates, body.position, RACING[line.kind])) report('world', line.id, issue);
  const near: Obstruction[] = [
    ...def.planets.map((p) => ({ centre: p.position.clone().sub(body.position), radius: p.radius + 300 })),
    ...def.stars.map((s) => ({ centre: s.position.clone().sub(body.position), radius: s.radius * 1.3 + 300 })),
  ];
  for (const cls of RACE_CLASSES) {
    const sold = getCatalog().ships.filter((m) => RACING.classes[cls].hulls.includes(m.class) && m.maker !== 'wake');
    const speed = (m: (typeof sold)[number]) => {
      const f = stock(m.id);
      return f.maxSpeed + (f.boostSpeed * f.energyRegen) / (f.energyRegen + f.boostDrain);
    };
    const ordered = [...sold].sort((a, b) => speed(a) - speed(b));
    const slowest = ordered[0]!;
    const fastest = ordered[ordered.length - 1]!;
    const cutoff = RACING.cutoff * classPar(line, cls);
    for (const [m, s, steer] of [
      [slowest, 1, null],
      [fastest, 1, null],
      [slowest, 0.8, 0.7],
    ] as const) {
      const skill = { ...skillFor(s, null, line.gates.length), ...(steer ? { steer } : {}) };
      const run = simulateRun(line, stock(m.id), skill, cutoff, near);
      if (run.state.out) report('world', `${line.id}.${cls}`, `the ${m.name} at skill ${s} passes within 300 m of a body`);
      else if (run.finish === null) report('world', `${line.id}.${cls}`, `the ${m.name} at skill ${s} does not finish inside the cutoff`);
    }
  }
}
