import { createNewGame } from '../app/state.ts';
import { findShip } from '../content/catalog.ts';
import { CONTRACTS, CONVOY_NAMES } from '../content/contracts/rules.ts';
import { CREW, CREW_DEEDS } from '../content/crew/rules.ts';
import { HAULER_NAMES } from '../content/economy/hauls.ts';
import { EVENTS } from '../content/events/rules.ts';
import { LANE_LINES } from '../content/lanes/lines.ts';
import { LANE_SHIPS, LANES } from '../content/lanes/rules.ts';
import { LAW } from '../content/law/rules.ts';
import { rng } from '../content/random.ts';
import { ROSTER } from '../content/rivals/rules.ts';
import type { Issue } from '../content/validate.ts';
import { WORLD_SEED } from '../content/world/rules.ts';
import {
  DERELICT_LOGS,
  KIND_WORDS,
  MYSTERY_LINES,
  POD_NAMES,
  POD_SUBTITLE,
  SITE_CHOICES,
  SITE_FICTION,
  SITE_NAMES,
  SITE_NOTES,
  SITE_RADIO,
  SITE_SUBTITLES,
  WRECK_LOGS,
  WRECK_NAMES,
} from '../content/wrecks/lines.ts';
import { MYSTERIES, MYSTERY_IDS, type MysteryEnd, type MysteryRule } from '../content/wrecks/mysteries.ts';
import { SITE_KINDS, WRECKS, type SiteKind, type WreckRules } from '../content/wrecks/rules.ts';
import { ALL_LOCATIONS, getLocation, isInventedSystem, SYSTEMS, WORLD } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { placeSite } from '../world/sites.ts';
import { MAX_REWARD } from './contractGuards.ts';
import { FACTIONS } from './factions.ts';
import { laneEncounter, laneOfferFor, stageLane } from './lanes.ts';
import { isLawful } from './law.ts';
import { useWorldLog } from './events.ts';
import { mysteryPlaces, scanFind, scanSlot, siteSpec, type SiteSpec } from './wrecks.ts';

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
/** Words that would say something about a real body: a line naming one ({body}) holds none of them. */
const CLAIMS = /\b(orbits?|orbiting|surface|atmosphere|air|water|ice|ocean|life|habitable|moons?|rings?|mass|radius|temperature|years?|days?|discovered|young|giant|rocky|gas)\b/i;
const MYSTERY_FIELDS = ['ship', 'sister', 'body', 'system', 'station', 'fence'];

/** A quiet pilot's tour (minutes in a system, a jump, how many systems), scanning a body once a visit. */
const TOUR = { stay: 480, jump: 120, systems: 120 };

/**
 * Guardrails for wrecks to fly to (docs/PROCGEN.md §31.9): dangers and finds rising with
 * lawlessness and never a trap in secure space; windows long enough for the trips they ask for and
 * no longer than six hours; sites clear of the docks a hail needs to be clear of; boarding inside the
 * reach of a ship in distress; raiders lying dark sprung inside a scan's reach, so a scan can come
 * first; pay under the contracts' ceiling, a fence paying more than the insurers but not much more;
 * hulls from the catalogue; the crew's deeds known. The words: no number, no he or she, no star, only
 * their fields, short enough, and a real body ({body}) only ever something a site drifts near, with
 * nothing said about it. The names their own. And over the world: none in Sol or at Pyre, every site
 * clear of docks and bodies, every kind and trail somewhere, trails that go where they should, wreck
 * salvage under a recovery contract’s pay, and a quiet pilot meeting a wreck or derelict every 12 to
 * 90 minutes or so.
 */
export function validateWrecks(rules: WreckRules = WRECKS, mysteries: Record<string, MysteryRule> = MYSTERIES, slots = 120): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const D = rules.danger;

  // The rules.
  const bands = (name: string, b: { secure: number; patrolled: number; lawless: number }, trap: boolean) => {
    if (trap && b.secure !== 0) report('rules', name, 'a trap in secure space');
    if (!(b.secure >= 0 && b.secure <= b.patrolled && b.patrolled <= b.lawless && b.lawless <= 0.6 && b.lawless > 0)) report('rules', name, 'odds not rising with lawlessness within 0–0.6');
  };
  bands('guard', D.guard, true);
  bands('dark', D.dark, true);
  bands('scan', rules.scan.chance, false);
  const trip = (jumps: number) => jumps * (EVENTS.jumpSeconds + 900);
  const farthest = Math.max(...Object.values(mysteries).flatMap((m) => [m.find.jumps[1], m.end.jumps, m.fence?.jumps ?? 0]));
  if (rules.open.lane < 1.5 * trip(1) || rules.open.scan < 1.5 * trip(1) || rules.open.step < 1.5 * trip(farthest)) report('rules', 'open', 'a window too short for the trip it asks for');
  if (Math.max(rules.open.lane, rules.open.scan, rules.open.step) > 21_600) report('rules', 'open', 'a window longer than six hours');
  if (!(rules.maxOpen >= 2 && rules.maxOpen <= 6)) report('rules', 'maxOpen', 'too few or too many sites at once');
  if (rules.place.clearOfDocks < LANES.quiet.dockClear) report('rules', 'place', 'sites nearer the docks than a hail may come');
  if (!(rules.place.fromArrival[0] > 0 && rules.place.fromArrival[0] < rules.place.fromArrival[1] && rules.place.nearBody[0] > 0 && rules.place.nearBody[0] < rules.place.nearBody[1] && rules.place.clearOfBodies > 0)) report('rules', 'place', 'distances out of order');
  if (!(rules.board.range > 0 && rules.board.range < rules.reach && rules.board.seconds >= 4 && rules.board.seconds <= 20 && rules.board.maxSpeed > 0 && rules.board.quiet > 0)) report('rules', 'board', 'boarding out of range');
  if (!(D.spring > 0 && D.spring < rules.scanRange)) report('rules', 'spring', 'raiders lying dark sprung beyond a scan’s reach');
  if (!(D.darkSize[0] >= 1 && D.darkSize[0] <= D.darkSize[1] && D.darkSize[1] <= 4)) report('rules', 'dark', 'too many raiders lying dark');
  const K = rules.kinds;
  if (!(K.wreck.pods[0] >= 1 && K.wreck.pods[0] <= K.wreck.pods[1] && K.wreck.pods[1] <= 5 && K.wreck.value[0] > 0 && K.wreck.value[0] <= K.wreck.value[1])) report('rules', 'wreck', 'pods or their value out of range');
  if (!(K.wreck.cargo >= 0 && K.wreck.cargo < 1 && K.wreck.cargoQty[0] >= 1 && K.wreck.cargoQty[0] <= K.wreck.cargoQty[1]) || K.wreck.goods.some((g) => LAW.contraband.includes(g))) report('rules', 'wreck', 'cargo out of range, or contraband');
  if (!(K.derelict.minJumps >= 1 && K.derelict.scale[0] > 1 && K.derelict.scale[0] <= K.derelict.scale[1] && K.derelict.salvage[0] > 0 && K.derelict.salvage[0] <= K.derelict.salvage[1] && K.derelict.salvage[1] <= MAX_REWARD && K.derelict.dataCore >= 0 && K.derelict.dataCore <= 1)) report('rules', 'derelict', 'a derelict out of range');
  for (const id of K.derelict.hulls) if (!findShip(id)) report('rules', id, 'a derelict hull not in the catalogue');
  if (!(K.pod.cargoPods[0] >= 1 && K.pod.cargoPods[0] <= K.pod.cargoPods[1] && K.pod.cargoPods[1] <= 4)) report('rules', 'pod', 'cargo split into too many pods');
  if (!(rules.leads.chance > 0 && rules.leads.chance < 1) || rules.keep.sites < 8 || rules.keep.seconds < rules.open.step) report('rules', 'leads', 'leads or keeping out of range');
  const pays = (name: string, e: MysteryEnd) => {
    if (!(e.pay > 0 && e.pay <= MAX_REWARD) || e.jumps < 1 || !e.types.length) report('rules', name, 'an ending’s pay or reach out of range');
  };
  for (const [id, m] of Object.entries(mysteries)) {
    pays(id, m.end);
    if (!m.from.length || !(m.find.jumps[0] >= 1 && m.find.jumps[0] <= m.find.jumps[1])) report('rules', id, 'a trail with nowhere to start or go');
    if (m.fence) {
      pays(`${id}.fence`, m.fence);
      if (!(m.fence.pay > m.end.pay && m.fence.pay <= 1.6 * m.end.pay)) report('rules', id, 'a fence paying no more than the insurers, or far more');
    }
  }
  for (const [key, deed] of Object.entries(CREW.siteDeeds)) {
    const [what, how] = key.split('.');
    if (!CREW_DEEDS.includes(deed) || !['ship', 'lifepod'].includes(what!) || !['taken', 'lapsed'].includes(how!)) report('rules', key, 'a crew deed for something sites never do');
  }

  // The words.
  const stars = SYSTEMS.map((s) => s.displayName.split(' ')[0]!).filter((w) => w.length > 3);
  const check = (subject: string, text: string, allowed: readonly string[], max: number) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (GENDERED.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    if (text.length > max) report('lines', subject, `${text.length} characters (at most ${max})`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
    for (const s of stars) if (new RegExp(`\\b${s}\\b`).test(text)) report('lines', subject, `a star written into the line (${s})`);
    if (text.includes('{body}')) {
      if ([...text.matchAll(/(\S+) \{body\}/g)].some(([, w]) => !['near', 'by', 'off'].includes(w!)) || text.startsWith('{body}')) report('lines', subject, '{body} not only as somewhere a site drifts near');
      if (CLAIMS.test(text)) report('lines', subject, `a line naming a real body says something about it: “${text}”`);
    }
  };
  for (const [k, t] of Object.entries(SITE_SUBTITLES)) check(`subtitle.${k}`, t, k === 'derelict' ? ['body'] : [], 80);
  for (const [k, t] of Object.entries(SITE_NAMES)) check(`name.${k}`, t, ['ship'], 48);
  for (const [k, t] of Object.entries(POD_NAMES)) check(`pod.${k}`, t, [], 24);
  check('pod.subtitle', POD_SUBTITLE, [], 40);
  for (const [k, t] of Object.entries(SITE_RADIO)) check(`radio.${k}`, t, k === 'wreck' || k === 'derelict' ? ['ship'] : [], 160);
  WRECK_LOGS.forEach((t, i) => check(`log.wreck.${i}`, t, [], 300));
  DERELICT_LOGS.forEach((t, i) => check(`log.derelict.${i}`, t, [], 300));
  const NOTE_FIELDS: Record<string, readonly string[]> = { marked: ['ship', 'until'], found: ['body', 'kind'], broken: ['why'], boarded: ['ship', 'what'], salvaged: ['ship', 'what'], noBerth: [], full: [] };
  for (const [k, t] of Object.entries(SITE_NOTES)) {
    if (typeof t === 'string') check(`note.${k}`, t, NOTE_FIELDS[k] ?? ['ship'], 160);
    else for (const [w, x] of Object.entries(t)) check(`note.${k}.${w}`, x, k === 'lapsed' ? ['ship'] : [], 160);
  }
  for (const [k, t] of Object.entries(KIND_WORDS)) check(`kind.${k}`, t, [], 40);
  for (const [m, lines] of Object.entries(MYSTERY_LINES)) for (const [k, t] of Object.entries(lines)) check(`mystery.${m}.${k}`, t, MYSTERY_FIELDS, k === 'title' ? 60 : 300);
  for (const [k, t] of Object.entries(SITE_CHOICES)) check(`choice.${k}`, t, [], 32);
  for (const k of ['wreck', 'derelict'] as const) {
    const l = LANE_LINES[k];
    for (const [w, t] of [['hail', l.hail], ['scene', l.scene], ...Object.entries(l.options).map(([id, o]) => [`${id}.outcome`, o.outcome])] as const) check(`lane.${k}.${w}`, t, ['ship', 'body', 'owner', 'odds', 'system'], 300);
  }
  if (/\d/.test(SITE_FICTION) || !SITE_FICTION.startsWith('Fiction:')) report('lines', 'fiction', 'the fiction line');
  const taken = new Set([...LANE_SHIPS, ...HAULER_NAMES, ...CONVOY_NAMES, ...ROSTER.map((r) => r.shipName)]);
  const places = new Set([...ALL_LOCATIONS.map((l) => l.name), ...SYSTEMS.map((s) => s.displayName), ...Object.values(FACTIONS).map((f) => f.name)]);
  if (new Set(WRECK_NAMES).size !== WRECK_NAMES.length || WRECK_NAMES.length < 8) report('names', 'wrecks', 'wreck names repeated, or too few');
  for (const n of WRECK_NAMES) if (taken.has(n) || places.has(n)) report('names', n, 'a wreck named like another ship or a place');

  if (rules !== WRECKS || mysteries !== MYSTERIES) return issues;

  // The world: every system and many slots, and a quiet pilot on tour.
  const stats = wreckWorldStats(slots, (s) => checkSite(s, report));
  for (const k of SITE_KINDS) if (!stats.kinds[k]) report('coverage', k, 'never met anywhere');
  for (const m of MYSTERY_IDS) {
    const { from, placed } = stats.trails[m];
    if (!from || placed < from * 0.5) report('coverage', m, `a trail that can start from ${placed} of ${from} systems where it may (half at least)`);
  }
  const recovery = CONTRACTS.reward.recovery;
  if (stats.wreckSalvage >= recovery.base + recovery.danger) report('balance', 'wreck', `a wreck’s salvage (${Math.round(stats.wreckSalvage)} cr on average) above a recovery contract’s pay`);
  if (stats.tourMinutes < 12 || stats.tourMinutes > 90) report('world', 'tour', `a pilot on tour meets a wreck or derelict every ${stats.tourMinutes.toFixed(1)} minutes (12–90)`);
  return issues;
}

/** Where a site lies, and what it holds: never in Sol or at Pyre, clear of docks and bodies, a derelict near its body. */
function checkSite(s: SiteSpec, report: (rule: string, subject: string, message: string) => void): void {
  if (s.systemId === 'sol' || isInventedSystem(s.systemId)) report('world', s.id, 'a site in Sol or at Pyre');
  const def = sceneDefFor(s.systemId);
  const at = placeSite(def, s.id, s.body);
  const P = WRECKS.place;
  if (def.stations.some((st) => st.position.distanceTo(at) < P.clearOfDocks)) report('world', s.id, 'a site too near a dock');
  if (def.planets.some((p) => p.position.distanceTo(at) < p.radius + P.clearOfBodies) || def.stars.some((x) => x.position.distanceTo(at) < x.radius * 1.3 + P.clearOfBodies)) report('world', s.id, 'a site too near a body');
  if (s.kind === 'derelict') {
    const body = def.planets.find((p) => p.id === s.body) ?? def.stars.find((x) => x.id === s.body);
    if (!body || !s.bodyName) report('world', s.id, 'a derelict near no body of its system');
    else {
      const surface = def.stars.includes(body as (typeof def.stars)[number]) ? body.radius * 1.3 : body.radius;
      if (at.distanceTo(body.position) - surface > P.clearOfBodies + P.nearBody[1] + P.clearOfDocks + 1) report('world', s.id, 'a derelict far from its body');
    }
  }
  if (s.pods.some((p) => (p.credits ?? 0) > MAX_REWARD) || s.salvage > MAX_REWARD) report('world', s.id, 'salvage above the ceiling');
  if (s.dark !== null && !(s.darkCount >= 1)) report('world', s.id, 'raiders lying dark, none of them');
}

/**
 * How the world's sites fall: the kinds met (hails' and scans'), how many systems each trail can
 * start from of those where its kinds occur, a wreck's salvage on average, and how often a quiet pilot
 * touring the lanes (scanning a body once a visit) meets a wreck or a derelict, in minutes.
 */
export function wreckWorldStats(slots = 120, each?: (s: SiteSpec) => void): {
  kinds: Partial<Record<SiteKind, number>>;
  trails: Record<string, { from: number; placed: number }>;
  wreckSalvage: number;
  tourMinutes: number;
} {
  const kinds: Partial<Record<SiteKind, number>> = {};
  const trails: Record<string, { from: number; placed: number }> = Object.fromEntries(MYSTERY_IDS.map((m) => [m, { from: 0, placed: 0 }]));
  let salvage = 0;
  let wrecks = 0;
  const state = createNewGame(3);
  state.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  useWorldLog(state.world);
  try {
    const startsIn = new Map<string, Set<SystemId>>(MYSTERY_IDS.map((m) => [m, new Set()]));
    const placedIn = new Map<string, Set<SystemId>>(MYSTERY_IDS.map((m) => [m, new Set()]));
    const seen = (s: SiteSpec) => {
      kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
      each?.(s);
      if (s.kind === 'wreck') {
        salvage += s.pods.reduce((t, p) => t + (p.credits ?? 0), 0);
        wrecks++;
      }
      for (const m of MYSTERY_IDS) {
        if (!MYSTERIES[m].from.includes(s.kind)) continue;
        startsIn.get(m)!.add(s.systemId);
        if (!placedIn.get(m)!.has(s.systemId) && mysteryPlaces(m, s.id)) placedIn.get(m)!.add(s.systemId);
      }
    };
    for (const sys of SYSTEMS) {
      for (let slot = 10; slot < 10 + slots; slot += 5) {
        const f = scanFind(sys.id, slot);
        if (f) seen(f);
        const o = laneEncounter(sys.id, slot * 2);
        const lane = o && ['mayday', 'lifepod', 'cargo', 'wreck', 'derelict'].includes(o.kind) ? siteSpec(`lane.${o.id}`, state) : null;
        if (lane) seen(lane);
      }
    }
    for (const m of MYSTERY_IDS) trails[m] = { from: startsIn.get(m)!.size, placed: placedIn.get(m)!.size };
    // A quiet pilot on tour.
    const tour = createNewGame(4);
    tour.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
    useWorldLog(tour.world);
    const r = rng(WORLD_SEED, 'wreck-tour');
    let here = 'barnard' as SystemId;
    let met = 0;
    tour.clock = 6 * 3_600;
    const from = tour.clock;
    for (let i = 0; i < TOUR.systems; i++) {
      for (let t = 0; t < TOUR.stay; t += 30) {
        tour.clock += 30;
        const o = laneOfferFor(tour, here);
        if (!o) continue;
        stageLane(tour, o);
        if (o.kind === 'wreck' || o.kind === 'derelict') met++;
      }
      if (scanFind(here, scanSlot(tour.clock))) met++;
      tour.clock += TOUR.jump;
      const next = (WORLD.links.get(here) ?? []).filter((x) => x !== 'sol');
      if (next.length) here = r.pick(next);
    }
    return { kinds, trails, wreckSalvage: salvage / Math.max(1, wrecks), tourMinutes: (tour.clock - from) / 60 / Math.max(1, met) };
  } finally {
    useWorldLog(null);
  }
}

/** Trails' ends where they should be (docs/PROCGEN.md §31.6): open stations of the ending's kinds, never in Sol or at Pyre, the insurers lawful. */
export function checkTrail(m: (typeof MYSTERY_IDS)[number], from: string): string | null {
  const p = mysteryPlaces(m, from);
  if (!p) return null;
  if (p.find === 'sol' || isInventedSystem(p.find)) return 'a find in Sol or at Pyre';
  const end = getLocation(p.end);
  if (end.status !== 'functional' || end.dockable === false || !end.stationType || !MYSTERIES[m].end.types.includes(end.stationType)) return 'an ending at no station of its kinds';
  if (m === 'strongbox' && !isLawful(end.factionId ?? null)) return 'insurers outside the law';
  if (p.fence && getLocation(p.fence).stationType !== 'freeport') return 'a fence at no free port';
  return null;
}
