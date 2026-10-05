import { findGear, findShip } from '../../content/catalog.ts';
import { STARTER_SHIP_ID } from '../../content/rules/index.ts';
import { ALL_LOCATIONS } from '../../data/systems.ts';
import { KNOWN_SYSTEM_IDS, PYRE_LOCATIONS, SYSTEM_IDS } from '../../data/systems.ts';
import { codexEntries } from '../../economy/progress.ts';
import { LANE_KINDS, LANES } from '../../content/lanes/rules.ts';
import { skyTimeline } from '../../economy/stellar.ts';
import type { SystemId } from '../../data/types.ts';
import { clampShip, newShipState } from '../../economy/loadout.ts';
import { COMMODITIES, COMMODITY_IDS } from '../../content/economy/goods.ts';
import { COMBAT } from '../../content/combat/rules.ts';
import { markById } from '../../economy/marks.ts';
import { FLEET } from '../../content/fleet/rules.ts';
import { OUTPOSTS } from '../../content/outposts/rules.ts';
import { OUTPOST_RAIDS } from '../../content/outposts/raids.ts';
import { FOLK, FOLK_RELATIONS } from '../../content/outposts/folk.ts';
import { scanBodies } from '../../economy/folk.ts';
import { ROSTER } from '../../content/rivals/rules.ts';
import { CREW, CREW_DEEDS, CREW_HEARTS, CREW_ROLES, type CrewDeed } from '../../content/crew/rules.ts';
import { SITE_KINDS, WRECKS } from '../../content/wrecks/rules.ts';
import { RANKS } from '../../content/ranks/rules.ts';
import { WING, WING_MEMORIES } from '../../content/wing/rules.ts';
import { BATTLE_KINDS, BATTLES } from '../../content/border/battles.ts';
import { getFront } from '../../economy/border.ts';
import { cycleOf } from '../../economy/battles.ts';
import { RACE_CLASSES, RACING } from '../../content/racing/rules.ts';
import { courseById, heatOf, type RaceEnd, type RacingLog } from '../../economy/racing.ts';
import { MYSTERY_IDS, type MysteryId } from '../../content/wrecks/mysteries.ts';
import { outpostId, outpostSite, siteOfStation } from '../../content/outposts/sites.ts';
import { miningRig } from '../../economy/fleetWork.ts';
import { createNewGame, SAVE_VERSION, type CommodityId, type CrewLog, type FormerOutpost, type GameState, type OutpostDefence, type OutpostRecord, type RivalStory, type WreckLog } from '../state.ts';

/**
 * Save format history:
 * - v1 (flight-and-dock milestone): flat record { version: 1, system, dockedAt, money, hull, shield,
 *   cargo, visited, seed, savedAt }. No jobs, reputation or market memory.
 * - v2 (economy milestone): GameState with a fixed courier: ship { hull, shield, shieldGenerator
 *   ('shield-mk1' | 'shield-mk2'), gun ('pulse-mk1' | 'pulse-mk2'), missiles, repairKits, cargo }.
 * - v3: ships and equipment from the catalogue (src/content): ship { model, fittings, hull,
 *   shield, ammo, repairKits, cargo }.
 * - v4: 21 goods instead of 3, and `markets` (stock the player's trades have moved at each
 *   station).
 * - v5: `contracts` (generated contracts the player accepted, as posted) and bounty progress in
 *   `jobs`.
 * - v6: contracts may be escorts, ace hunts or recoveries, urgent or follow-ups (offered follow-ups
 *   wait in `contracts` without a `jobs` entry); jobs may have failed, and carry escort and
 *   recovery progress. The data of a v5 save is valid v6.
 * - v7: `law` (fines owed to the lawful factions), smuggling and piracy contracts, two contraband
 *   goods; `codex`, `surveysSold`, `milestones`, and `stats.sales` / `stats.rewards` (the trade
 *   rating).
 * - v8: `story` (choices made in the faction arcs, beats already told) and `dens` (raider
 *   dens knocked out, and when); jobs may carry convoy and den assault progress; `stash` (salvaged
 *   equipment aboard) and `crew` (wingmen for hire); the ship's `decoys` and `systems` damage.
 * - v9: `priceWatch` and `rumours` (docs/PROCGEN.md §16); known markets may come from a rumour
 *   or the price watch, with per-good times.
 * - v10 (current): `world` (events ended early, what lingers in each system) and the law's
 *   `pending` crimes and `lastCrimeAt` (docs/PROCGEN.md §17); `fleet` (owned ships, haulers,
 *   storage and stakes, §18); contracts may be mining claims, whose jobs carry `mined` (§19);
 *   escorts across jumps carry `escortAt`, where their ships are (§10.2; absent in older v10
 *   saves, which means where they set off); a passenger contract carries its `party`, and its
 *   progress `seen` and `fright` (§23); a hauler may carry `sight`, a run the player saw safely
 *   past its raid (§18.6); `rivals` (standing with rival pilots) and the world log's `rivals`
 *   (rivals knocked out, claims bought back, §24); the world log's `sky` (when a far star's death
 *   begins, §25) and a job's `observed` (its observations), absent in older v10 saves; the world log's `lanes`
 *   (lane encounters met, §27), absent in older v10 saves; the world log's rival `stories`, a rival's
 *   `met` and a wingman's `ally` (§28), and an outpost's `opened` and `defence` (§29), absent in older
 *   v10 saves; `aboard`, the crew aboard and who left (§30), and a contract's `crew`, absent in
 *   older v10 saves; the world log's `wrecks` (sites marked in flight and the trails they led to,
 *   §31), absent in older v10 saves; `ranks`, the rank given or fallen to with each faction, and a
 *   commission's `requires.rank` (§32), absent in older v10 saves; the world log's `racing` (an entry
 *   open, the pilot's results and bests by course and class, §33), absent in older v10 saves. See
 *   GameState in src/app/state.ts. The wing's records on `crew` entries (fights, downs, trust, memory,
 *   hurt, notice, owed) and `wingFormer` (§34) are absent in older v10 saves, as are the border
 *   log's `battles` (battles seen to an end, §35).
 */
export interface SaveV1 {
  version: 1;
  savedAt: string;
  seed: number;
  system: SystemId;
  dockedAt: string | null;
  money: number;
  hull: number;
  shield: number;
  cargo: Record<string, number>;
  visited: SystemId[];
}

export class SaveFormatError extends Error {}

/** The shared world's stations, and Pyre's two (docs/PROCGEN.md §26). */
const SHARED_IDS: ReadonlySet<string> = new Set([...ALL_LOCATIONS.filter((l) => l.status === 'functional').map((l) => l.id), ...PYRE_LOCATIONS.map((l) => l.id)]);
/** Stations a save may name: the shared world's, and its own outpost once it is valid (set as a save is checked). */
let LOCATION_IDS: ReadonlySet<string> = SHARED_IDS;

/** The player's outposts (docs/PROCGEN.md §22, §36.6): up to three, at most one in a system, each valid. */
function assertValidOutposts(list: OutpostRecord[], fail: (msg: string) => never): void {
  if (!Array.isArray(list) || list.length > OUTPOSTS.max) fail('outposts');
  const systems = new Set<string>();
  for (const o of list) {
    assertValidOutpost(o, fail);
    const sys = outpostSite(o.site)!.systemId;
    if (systems.has(sys)) fail('two outposts in one system');
    systems.add(sys);
  }
}

/** Outposts given up (docs/PROCGEN.md §36.4): as many as are kept, each a site that was, sold or abandoned. */
function validFormer(list: FormerOutpost[]): boolean {
  return (
    Array.isArray(list) &&
    list.length <= OUTPOSTS.former &&
    list.every(
      (f) =>
        isRecord(f) &&
        typeof f.site === 'string' &&
        !!outpostSite(f.site) &&
        typeof f.name === 'string' &&
        typeof f.kind === 'string' &&
        Number.isInteger(f.stage) &&
        f.stage >= 0 &&
        f.stage <= OUTPOSTS.stages.length &&
        Number.isFinite(f.founded) &&
        Number.isFinite(f.ended) &&
        f.ended >= f.founded &&
        (f.how === 'sold' || f.how === 'abandoned') &&
        Number.isFinite(f.paid) &&
        f.paid >= 0 &&
        (f.how === 'sold' || f.paid === 0),
    )
  );
}

/** The player's outpost (docs/PROCGEN.md §22, §36): a real site, a kind it allows, its stage, deliveries and refining in range. */
function assertValidOutpost(o: OutpostRecord, fail: (msg: string) => never): void {
  const site = isRecord(o) && typeof o.site === 'string' ? outpostSite(o.site) : undefined;
  if (
    !site ||
    !site.kinds.includes(o.kind) ||
    typeof o.name !== 'string' ||
    !o.name.trim() ||
    o.name.length > 40 ||
    !Number.isInteger(o.stage) ||
    o.stage < 0 ||
    o.stage > OUTPOSTS.stages.length ||
    !isRecord(o.delivered) ||
    !Object.entries(o.delivered).every(([c, q]) => COMMODITY_IDS.includes(c as CommodityId) && Number.isFinite(q) && (q as number) >= 0) ||
    !Number.isFinite(o.founded) ||
    !Number.isFinite(o.since) ||
    !Number.isFinite(o.earned) ||
    // Dock fees (§38.2): whole credits, part of what it has earned.
    (o.fees !== undefined && (!Number.isInteger(o.fees) || o.fees < 0 || o.fees > o.earned)) ||
    (o.opened !== undefined && !Number.isFinite(o.opened)) ||
    // How far its news has been told (§39.5): from its founding on.
    (o.heard !== undefined && !(Number.isFinite(o.heard) && o.heard >= o.founded)) ||
    (o.defence !== undefined && !validDefence(o.defence, o.stage)) ||
    (o.refined !== undefined && !validRefined(o.refined, site.beltId ? o.stage : 0)) ||
    (o.folk !== undefined && !validFolk(o.folk, o, site.systemId))
  ) {
    fail('outpost');
  }
}

/**
 * Its people's record (docs/PROCGEN.md §41.5): only once it is open; a spirit of 0–100; asks done
 * per person within their story, and none by someone not there yet; the ask open of a known kind,
 * good, station or body, made and lapsing in order; works one per trade.
 */
function validFolk(f: NonNullable<OutpostRecord['folk']>, o: OutpostRecord, systemId: string): boolean {
  const time = (t: unknown) => Number.isFinite(t) && (t as number) >= 0;
  if (!isRecord(f) || o.stage <= 0) return false;
  const present = FOLK.people[Math.min(o.stage, FOLK.people.length) - 1]!;
  const slot = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < present;
  if (!time(f.start) || f.start < o.founded || !time(f.since) || f.since < f.start || !time(f.visited) || f.visited < f.start || !time(f.told)) return false;
  if (!Number.isFinite(f.spirit) || f.spirit < 0 || f.spirit > 100 || !['low', 'steady', 'glad'].includes(f.band)) return false;
  const people = FOLK.people[FOLK.people.length - 1]!;
  if (!Array.isArray(f.steps) || f.steps.length !== people || !f.steps.every((x, i) => Number.isInteger(x) && x >= 0 && x <= FOLK.asks.story && (i < present || x === 0))) return false;
  if (!Number.isInteger(f.asked) || f.asked < 0) return false;
  if (f.ended !== undefined && !(isRecord(f.ended) && time(f.ended.at) && ['done', 'lapsed', 'none'].includes(f.ended.how) && Number.isInteger(f.ended.slot) && f.ended.slot >= 0 && f.ended.slot < people)) return false;
  const trades = Object.keys(FOLK.trades);
  if (!Array.isArray(f.works) || f.works.length > people || new Set(f.works.map((w) => w?.trade)).size !== f.works.length) return false;
  if (!f.works.every((w) => isRecord(w) && slot(w.slot) && trades.includes(w.trade) && time(w.at) && (w.good === undefined || COMMODITY_IDS.includes(w.good)))) return false;
  const a = f.ask;
  if (a === undefined) return true;
  if (!isRecord(a) || a.n !== f.asked - 1 || !slot(a.slot) || typeof a.story !== 'boolean' || !time(a.made) || a.until !== a.made + FOLK.asks.lasts) return false;
  if (a.aboard !== undefined && !(a.aboard === true && a.kind === 'fetch')) return false;
  if (a.scanned !== undefined && !(a.scanned === true && a.kind === 'scan')) return false;
  if (a.kind === 'goods') return !!a.good && COMMODITY_IDS.includes(a.good) && Number.isInteger(a.qty) && a.qty! >= 1 && a.qty! <= FOLK.asks.qty[1];
  if (a.kind === 'fetch') return typeof a.who === 'string' && !!a.who.trim() && (FOLK_RELATIONS as readonly string[]).includes(a.relation ?? '') && ALL_LOCATIONS.some((l) => l.id === a.stationId);
  if (a.kind === 'scan') return typeof a.bodyId === 'string' && scanBodies(systemId).some((b) => b.id === a.bodyId);
  return false;
}

/** What a belt outpost refined this hour (docs/PROCGEN.md §36.3): never more than its stages allow, nor at a planet's. */
function validRefined(r: NonNullable<OutpostRecord['refined']>, stage: number): boolean {
  const cap = stage > 0 ? OUTPOSTS.refining.perHour[Math.min(stage, OUTPOSTS.refining.perHour.length) - 1]! : 0;
  return isRecord(r) && Number.isInteger(r.hour) && r.hour >= 0 && Number.isInteger(r.units) && r.units >= 0 && r.units <= cap && cap > 0;
}

/** An outpost's defences and raids (docs/PROCGEN.md §29): turrets within its stages, guards and raids that make sense. */
function validDefence(d: OutpostDefence, stage: number): boolean {
  const time = (t: unknown) => Number.isFinite(t) && (t as number) >= 0;
  if (!isRecord(d) || !Number.isInteger(d.turrets) || d.turrets < 0 || d.turrets > Math.min(stage, OUTPOST_RAIDS.turrets.needs.length) || !Number.isInteger(d.settled)) return false;
  if (!isRecord(d.delivered) || !Object.entries(d.delivered).every(([c, q]) => COMMODITY_IDS.includes(c as CommodityId) && Number.isFinite(q) && (q as number) >= 0)) return false;
  if (!Array.isArray(d.down) || d.down.length > OUTPOST_RAIDS.turrets.needs.length || !d.down.every((t) => t === null || time(t))) return false;
  if (!Array.isArray(d.guards) || d.guards.length > 8 || !d.guards.every((g) => isRecord(g) && typeof g.id === 'string' && typeof g.name === 'string' && !!findShip(g.model) && (g.skill === 'steady' || g.skill === 'sharp') && time(g.from) && time(g.until) && g.until >= g.from)) return false;
  if (!Array.isArray(d.raids) || d.raids.length > OUTPOST_RAIDS.keep || !d.raids.every((r) => isRecord(r) && Number.isInteger(r.window) && Number.isFinite(r.at) && [1, 2, 3].includes(r.threat) && (r.result === 'held' || r.result === 'lost') && (r.where === 'away' || r.where === 'flight') && (r.took === undefined || typeof r.took === 'string'))) return false;
  if (d.warned !== undefined && !Number.isInteger(d.warned)) return false;
  if (d.hurt !== undefined && !(isRecord(d.hurt) && time(d.hurt.from) && time(d.hurt.until) && d.hurt.until >= d.hurt.from && COMMODITY_IDS.includes(d.hurt.good))) return false;
  return true;
}

const STORY_ENDS = ['friends', 'towed', 'let-down', 'lost-ship', 'fell-out', 'won', 'lost', 'forfeit', 'no-show', 'amends'];

/** A rival's story (docs/PROCGEN.md §28) as a save holds it. */
function validStory(st: RivalStory): boolean {
  if (!isRecord(st) || (st.path !== 'friend' && st.path !== 'enemy') || !Number.isFinite(st.began) || st.began < 0) return false;
  const time = (t: unknown) => t === undefined || (Number.isFinite(t) && (t as number) >= 0);
  const loan = st.loan;
  if (loan !== undefined && !(isRecord(loan) && Number.isFinite(loan.amount) && loan.amount > 0 && time(loan.repaid))) return false;
  const d = st.deed;
  if (d !== undefined) {
    if (!isRecord(d) || (d.kind !== 'escort' && d.kind !== 'rescue') || !Number.isFinite(d.at) || typeof d.job !== 'string' || !LOCATION_IDS.has(d.to) || !time(d.end)) return false;
    if ((d.from !== undefined && !LOCATION_IDS.has(d.from)) || (d.resume !== undefined && !LOCATION_IDS.has(d.resume)) || (d.systemId !== undefined && !SYSTEM_IDS.includes(d.systemId)) || (d.done !== undefined && typeof d.done !== 'boolean')) return false;
  }
  if (st.wings !== undefined && !(Array.isArray(st.wings) && st.wings.length <= 12 && st.wings.every((x) => isRecord(x) && Number.isFinite(x.at) && time(x.end) && (x.resume === undefined || LOCATION_IDS.has(x.resume))))) return false;
  if (!time(st.spent)) return false;
  if (st.duel !== undefined && !(isRecord(st.duel) && Number.isFinite(st.duel.posted) && time(st.duel.started))) return false;
  if (st.ended !== undefined && !(isRecord(st.ended) && Number.isFinite(st.ended.at) && STORY_ENDS.includes(st.ended.how))) return false;
  return true;
}

/** A site's id (docs/PROCGEN.md §31): a hail's or a scan's (its system and slot), or a trail's find. */
function siteIdParts(id: string): { from: 'lane' | 'scan'; systemId: SystemId; slot: number } | { from: 'mys'; mystery: MysteryId } | null {
  const [head, ...rest] = id.split('.');
  if (head === 'mys') return rest.length === 2 && MYSTERY_IDS.includes(rest[0] as MysteryId) && rest[1] === '1' ? { from: 'mys', mystery: rest[0] as MysteryId } : null;
  if (head !== 'lane' && head !== 'scan') return null;
  const tail = rest.join('.');
  const dot = tail.lastIndexOf('.');
  const systemId = tail.slice(0, dot) as SystemId;
  const slot = Number(tail.slice(dot + 1));
  return dot > 0 && Number.isInteger(slot) && slot >= 0 && SYSTEM_IDS.includes(systemId) ? { from: head, systemId, slot } : null;
}

const SITE_ENDS = ['done', 'bait', 'lapsed', 'dropped', 'lost'];
const MYSTERY_ENDS = ['solved', 'cold', 'dropped'];

/**
 * Sites marked and trails followed (docs/PROCGEN.md §31): ids that name their system and slot (a
 * hail's marked after its slot began, a scan's within its slot), known kinds, pods by index, only
 * `true` for what was done, endings after the marking, and no more than the rules keep.
 */
function assertValidWrecks(log: WreckLog, fail: (msg: string) => never): void {
  const time = (t: unknown) => Number.isFinite(t) && (t as number) >= 0;
  if (!isRecord(log) || !isRecord(log.sites) || Object.keys(log.sites).length > WRECKS.keep.sites + WRECKS.maxOpen + MYSTERY_IDS.length) fail('wrecks');
  if (log.read !== undefined && !(Number.isInteger(log.read) && log.read >= 0)) fail('wrecks');
  for (const [id, r] of Object.entries(log.sites)) {
    const ref = siteIdParts(id);
    if (!ref || !isRecord(r) || !time(r.at) || !SYSTEM_IDS.includes(r.systemId) || !SITE_KINDS.includes(r.kind)) fail(`site ${id}`);
    if (ref.from !== 'mys' && ref.systemId !== r.systemId) fail(`site ${id}`);
    if (ref.from === 'lane' && r.at < ref.slot * LANES.slotSeconds) fail(`site ${id}`);
    if (ref.from === 'scan' && Math.floor(r.at / WRECKS.scan.slotSeconds) !== ref.slot) fail(`site ${id}`);
    if (r.taken !== undefined && !(Array.isArray(r.taken) && new Set(r.taken).size === r.taken.length && r.taken.every((i) => Number.isInteger(i) && i >= 0 && i <= 5))) fail(`site ${id}`);
    for (const flag of [r.read, r.boarded, r.cleared, r.sprung, r.reached]) if (flag !== undefined && flag !== true) fail(`site ${id}`);
    if (r.ended !== undefined && !(isRecord(r.ended) && Number.isFinite(r.ended.at) && r.ended.at >= r.at && SITE_ENDS.includes(r.ended.how))) fail(`site ${id}`);
  }
  if (log.mysteries !== undefined) {
    if (!isRecord(log.mysteries)) fail('wrecks');
    for (const [m, r] of Object.entries(log.mysteries)) {
      const from = isRecord(r) && typeof r.from === 'string' ? siteIdParts(r.from) : null;
      if (!MYSTERY_IDS.includes(m as MysteryId) || !from || from.from === 'mys' || !time(r!.began) || (r!.step !== 0 && r!.step !== 1) || !Number.isFinite(r!.stepAt) || r!.stepAt < r!.began) fail(`trail ${m}`);
      if (r!.choice !== undefined && !(m === 'strongbox' && (r!.choice === 'insurer' || r!.choice === 'fence'))) fail(`trail ${m}`);
      if (r!.ended !== undefined && !(isRecord(r!.ended) && Number.isFinite(r!.ended.at) && MYSTERY_ENDS.includes(r!.ended.how))) fail(`trail ${m}`);
    }
  }
}

const RACE_ENDS: readonly RaceEnd[] = ['retired', 'cut', 'lost', 'lapsed', 'voided'];

/**
 * The pilot's racing (docs/PROCGEN.md §33): an entry for a real course in a class, never for a heat
 * already raced; counts that add up; times a ship could fly; no more results than are kept, one a heat.
 */
function assertValidRacing(log: RacingLog, clock: number, fail: (msg: string) => never): void {
  const now = heatOf(clock) + 1;
  const heat = (h: unknown) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= now;
  const when = (t: unknown) => Number.isFinite(t) && (t as number) >= 0 && (t as number) <= clock + 1;
  const plausible = (course: string, t: unknown) => {
    const line = courseById(course)?.line;
    return !!line && Number.isFinite(t) && (t as number) >= line.length / 900 && (t as number) <= (RACING.cutoff * line.length) / 50;
  };
  const top = RACING.pay.purse.run + RACING.pay.record;
  if (!isRecord(log) || !isRecord(log.courses) || !Array.isArray(log.results) || log.results.length > RACING.keep.results) fail('racing');
  const e = log.entry;
  if (e !== undefined && !(isRecord(e) && !!courseById(e.course) && RACE_CLASSES.includes(e.cls) && heat(e.heat) && when(e.at) && Number.isFinite(e.fee) && e.fee >= 0 && e.fee <= RACING.pay.fee.run)) fail('racing entry');
  if (log.ran !== undefined && !heat(log.ran)) fail('racing');
  if (e && log.ran !== undefined && e.heat <= log.ran) fail('racing entry');
  for (const [key, c] of Object.entries(log.courses)) {
    const m = /^(.+)\.(light|heavy)$/.exec(key);
    const course = m?.[1] ?? '';
    const n = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
    if (!m || !courseById(course) || !isRecord(c) || !n(c.runs) || !n(c.finished) || !n(c.podiums) || !n(c.wins) || !(c.wins <= c.podiums && c.podiums <= c.finished && c.finished <= c.runs)) fail(`race ${key}`);
    if (c.best !== undefined && !(isRecord(c.best) && plausible(course, c.best.raw) && !!findShip(c.best.ship) && when(c.best.at) && c.finished > 0)) fail(`race ${key}`);
    if (c.record !== undefined && !(when(c.record) && c.best)) fail(`race ${key}`);
  }
  const heats = new Set<number>();
  for (const r of log.results) {
    if (!isRecord(r) || !courseById(r.course) || !RACE_CLASSES.includes(r.cls) || !heat(r.heat) || !when(r.at) || heats.has(r.heat)) fail('race result');
    heats.add(r.heat);
    if (!(Number.isInteger(r.of) && r.of >= 0 && r.of <= RACING.field.size + 1 && Number.isInteger(r.place) && r.place >= 0 && r.place <= r.of)) fail('race result');
    if (!(Number.isFinite(r.prize) && r.prize >= 0 && r.prize <= top)) fail('race result');
    if (r.raw !== undefined && !plausible(r.course, r.raw)) fail('race result');
    if ((r.place > 0) !== (r.raw !== undefined) || (r.how !== undefined && (!RACE_ENDS.includes(r.how) || r.place > 0)) || (r.first !== undefined && typeof r.first !== 'string')) fail('race result');
  }
}

/** The crew aboard (docs/PROCGEN.md §30): one of each role at most, within the rules, their stories and who left. */
function assertValidCrew(a: CrewLog, fail: (msg: string) => never): void {
  const time = (t: unknown) => Number.isFinite(t) && (t as number) >= 0;
  if (!isRecord(a) || !Array.isArray(a.members) || a.members.length > CREW.max || !time(a.since) || !Number.isInteger(a.kills) || a.kills < 0 || !isRecord(a.deeds)) fail('crew aboard');
  for (const [d, n] of Object.entries(a.deeds)) if (!CREW_DEEDS.includes(d as CrewDeed) || !Number.isInteger(n) || (n as number) < 0) fail('crew deeds');
  if (a.round !== undefined && !Number.isInteger(a.round)) fail('crew aboard');
  const roles = new Set<string>();
  for (const m of a.members) {
    const ok =
      isRecord(m) &&
      typeof m.id === 'string' &&
      typeof m.name === 'string' &&
      !!m.name.trim() &&
      CREW_ROLES.includes(m.role) &&
      CREW_HEARTS.includes(m.heart) &&
      [1, 2, 3].includes(m.grade) &&
      time(m.hired) &&
      time(m.paidTo) &&
      m.paidTo >= m.hired &&
      Number.isFinite(m.morale) &&
      m.morale >= 0 &&
      m.morale <= 100 &&
      (m.hurt === undefined || (isRecord(m.hurt) && time(m.hurt.at) && time(m.hurt.until) && m.hurt.until >= m.hurt.at && Number.isInteger(m.hurt.docks) && m.hurt.docks >= 0)) &&
      (m.notice === undefined || time(m.notice)) &&
      (m.said === undefined || (typeof m.said === 'string' && m.said.length <= 400)) &&
      !roles.has(m.role);
    if (!ok) fail(`crew member ${String((m as { id?: unknown })?.id)}`);
    roles.add(m.role);
    const st = m.story;
    if (st === undefined) continue;
    const f = st.favour;
    const storyOk =
      isRecord(st) &&
      Number.isInteger(st.seen) &&
      st.seen >= 0 &&
      (st.told === undefined || time(st.told)) &&
      (f === undefined || (isRecord(f) && time(f.asked) && time(f.until) && f.until >= f.asked && LOCATION_IDS.has(f.to) && (f.systemId === undefined || SYSTEM_IDS.includes(f.systemId)) && (f.job === undefined || typeof f.job === 'string'))) &&
      (st.ended === undefined || (isRecord(st.ended) && time(st.ended.at) && ['done', 'failed', 'lapsed'].includes(st.ended.how)));
    if (!storyOk) fail(`crew story ${m.id}`);
  }
  if (a.former !== undefined && !(Array.isArray(a.former) && a.former.length <= CREW.former && a.former.every((x) => isRecord(x) && typeof x.name === 'string' && CREW_ROLES.includes(x.role) && time(x.at) && LOCATION_IDS.has(x.locationId) && (x.why === 'let-go' || x.why === 'unhappy')))) fail('former crew');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function migrateV1(old: SaveV1): GameState {
  const state = createNewGame(Number.isFinite(old.seed) ? old.seed : 1, new Date(old.savedAt || Date.now()));
  state.savedAt = old.savedAt;
  state.location.systemId = old.system;
  state.location.dockedAt = old.dockedAt;
  state.location.lastDockId = old.dockedAt ?? (old.system === 'sol' ? 'earth-port' : state.location.lastDockId);
  state.credits = old.money;
  state.ship.hull = old.hull;
  state.ship.shield = old.shield;
  state.ship.cargo = {};
  for (const id of COMMODITY_IDS) {
    const qty = old.cargo?.[id];
    if (typeof qty === 'number' && qty > 0) state.ship.cargo[id] = Math.floor(qty);
  }
  state.visitedSystems = [...new Set<SystemId>(['sol', ...(old.visited ?? [])])];
  // v1 predates jump clearance; a v1 pilot who had already left Sol keeps the ability to jump.
  if (state.visitedSystems.length > 1) state.flags.clearance = true;
  return state;
}

/** The v2 ship record. */
export interface ShipV2 {
  hull: number;
  shield: number;
  shieldGenerator: 'shield-mk1' | 'shield-mk2';
  gun: 'pulse-mk1' | 'pulse-mk2';
  missiles: number;
  repairKits: number;
  cargo: GameState['ship']['cargo'];
}

/**
 * v2 → v3: the fixed courier becomes the Halden courier Mk I from the catalogue. Upgrades map to
 * the catalogue items closest in strength: the Mk II pulse cannon to two class 2 Kestrels, the
 * Mk II shield to a class 3 Aegis. Missiles become seekers in the launcher.
 */
function migrateV2(old: Omit<GameState, 'version' | 'ship'> & { version: 2; ship: ShipV2 }): GameState {
  const v2 = old.ship;
  const ship = newShipState(STARTER_SHIP_ID);
  if (v2.gun === 'pulse-mk2') {
    for (const slot of Object.keys(ship.fittings)) if (slot.startsWith('gun-')) ship.fittings[slot] = 'gear.pulse.2.halden';
  }
  if (v2.shieldGenerator === 'shield-mk2') ship.fittings.shield = 'gear.shield-balanced.3.halden';
  ship.hull = Number.isFinite(v2.hull) ? v2.hull : ship.hull;
  ship.shield = Number.isFinite(v2.shield) ? v2.shield : 0;
  ship.ammo = { 'launcher-1': Number.isFinite(v2.missiles) ? Math.floor(v2.missiles) : 0 };
  ship.repairKits = Number.isFinite(v2.repairKits) ? Math.max(0, Math.floor(v2.repairKits)) : 0;
  ship.cargo = v2.cargo ?? {};
  clampShip(ship);
  return migrateV3({ ...old, version: 3, ship });
}

/** v3 → v4: markets start untouched (the three v3 goods keep their ids). */
function migrateV3(old: Omit<GameState, 'version' | 'markets' | 'contracts'> & { version: 3 }): GameState {
  return migrateV4({ ...old, version: 4, markets: {} });
}

/** v4 → v5: no generated contracts accepted yet. */
function migrateV4(old: Omit<GameState, 'version' | 'contracts'> & { version: 4 }): GameState {
  return migrateV5({ ...old, version: 5, contracts: {} });
}

/** v5 → v6: nothing to change (v6 only adds kinds of contract and progress). */
function migrateV5(old: Parameters<typeof migrateV6>[0] extends infer T ? Omit<T, 'version'> & { version: 5 } : never): GameState {
  return migrateV6({ ...old, version: 6 });
}

/**
 * v6 → v7: a clean record with the law; the codex starts from the planets already scanned; no
 * milestones yet (they are awarded on the next check), no survey sold, the trade record at zero.
 */
function migrateV6(
  old: Omit<GameState, 'version' | 'law' | 'codex' | 'surveysSold' | 'milestones' | 'stats' | 'story' | 'dens'> & { version: 6; stats: Omit<GameState['stats'], 'sales' | 'rewards'> },
): GameState {
  const known = new Set(codexEntries().map((e) => e.id));
  return migrateV7({
    ...old,
    version: 7,
    law: { fines: {}, pending: [], lastCrimeAt: {} },
    codex: old.discoveredBodies.filter((id) => known.has(id)),
    surveysSold: [],
    milestones: {},
    stats: { ...old.stats, sales: 0, rewards: 0 },
  });
}

/**
 * v7 → v8: no story choices made and no den knocked out yet; nothing in the stash and nobody on the
 * wing; the ship gets its starting decoys and intact systems.
 */
function migrateV7(
  old: Omit<GameState, 'version' | 'story' | 'dens' | 'stash' | 'crew' | 'ship'> & { version: 7; ship: Omit<GameState['ship'], 'decoys' | 'systems'> & Partial<Pick<GameState['ship'], 'decoys' | 'systems'>> },
): GameState {
  const ship = { ...old.ship, decoys: old.ship.decoys ?? COMBAT.decoys.starting, systems: old.ship.systems ?? { engines: 0, guns: 0, shields: 0 } };
  return migrateV8({ ...old, ship, version: 8, story: { choices: {}, seen: [] }, dens: {}, stash: [], crew: [] });
}

/** v8 → v9: no prices watched and nothing heard in the bars yet. */
function migrateV8(old: Omit<GameState, 'version' | 'priceWatch' | 'rumours' | 'world' | 'law'> & { version: 8; law: { fines: GameState['law']['fines'] } }): GameState {
  return migrateV9({ ...old, version: 9, priceWatch: [], rumours: [] });
}

/**
 * v9 → v10: fines on record stay on record (every crime so far is known everywhere, and counts as
 * committed now for lapsing); no event ended early and nothing left adrift yet.
 */
function migrateV9(old: Omit<GameState, 'version' | 'world' | 'law' | 'fleet'> & { version: 9; law: { fines: GameState['law']['fines'] } }): GameState {
  const lastCrimeAt: GameState['law']['lastCrimeAt'] = {};
  for (const [f, fine] of Object.entries(old.law.fines)) if ((fine ?? 0) > 0) lastCrimeAt[f as keyof typeof lastCrimeAt] = old.clock;
  return {
    ...old,
    version: SAVE_VERSION,
    law: { fines: { ...old.law.fines }, pending: [], lastCrimeAt },
    world: { relief: {}, raidKills: {}, ended: {}, lingering: {}, border: {} },
    fleet: { ships: [], storage: {}, stakes: [], reports: [] },
  };
}

/** Upgrades any known save version to the current GameState. Throws SaveFormatError when unusable. */
export function migrateSave(raw: unknown): GameState {
  if (!isRecord(raw) || typeof raw.version !== 'number') throw new SaveFormatError('Save data is not recognisable.');
  let data: unknown = raw;
  if (raw.version > SAVE_VERSION) {
    throw new SaveFormatError(`Save was made by a newer version (format ${raw.version}).`);
  }
  if (raw.version === 1) data = migrateV1(raw as unknown as SaveV1);
  else if (raw.version === 2) {
    if (!isRecord(raw.ship)) throw new SaveFormatError('Save data is damaged: ship');
    data = migrateV2(raw as unknown as Parameters<typeof migrateV2>[0]);
  } else if (raw.version === 3) data = migrateV3(raw as unknown as Parameters<typeof migrateV3>[0]);
  else if (raw.version === 4) data = migrateV4(raw as unknown as Parameters<typeof migrateV4>[0]);
  else if (raw.version === 5) data = migrateV5(raw as unknown as Parameters<typeof migrateV5>[0]);
  else if (raw.version === 6) data = migrateV6(raw as unknown as Parameters<typeof migrateV6>[0]);
  else if (raw.version === 7) data = migrateV7(raw as unknown as Parameters<typeof migrateV7>[0]);
  else if (raw.version === 8) data = migrateV8(raw as unknown as Parameters<typeof migrateV8>[0]);
  else if (raw.version === 9) data = migrateV9(raw as unknown as Parameters<typeof migrateV9>[0]);
  upgradeOutposts(data);
  const state = data as GameState;
  assertValidState(state);
  return state;
}

/** A save from before the belts (docs/PROCGEN.md §36.6) kept one outpost: it becomes the first of `world.outposts`. */
function upgradeOutposts(data: unknown): void {
  if (!isRecord(data) || !isRecord(data.world) || !('outpost' in data.world)) return;
  const w = data.world as Record<string, unknown>;
  if (w.outposts === undefined && w.outpost !== undefined) w.outposts = [w.outpost];
  delete w.outpost;
}

/** A cargo record: known goods in whole, non-negative quantities. */
function validCargo(cargo: unknown): cargo is Record<string, number> {
  return isRecord(cargo) && Object.entries(cargo).every(([c, q]) => COMMODITY_IDS.includes(c as CommodityId) && Number.isInteger(q) && (q as number) >= 0);
}

/** Checks one ship (the one flown, or one the player owns): the model, its fittings, racks, systems and hold. */
function assertValidShip(ship: GameState['ship'], fail: (msg: string) => never, what = 'ship'): void {
  if (!isRecord(ship) || !Number.isFinite(ship.hull) || !Number.isFinite(ship.shield)) fail(what);
  if (!isRecord(ship.cargo)) fail(`${what} cargo`);
  const model = typeof ship.model === 'string' ? findShip(ship.model) : undefined;
  if (!model) fail(`unknown ${what} model`);
  if (!isRecord(ship.fittings) || !isRecord(ship.ammo)) fail(`${what} fittings`);
  for (const [slotId, gearId] of Object.entries(ship.fittings)) {
    const slot = model!.slots.find((sl) => sl.id === slotId);
    const item = typeof gearId === 'string' ? findGear(gearId) : undefined;
    if (!slot || !item || item.slot !== slot.type || item.tier > slot.maxClass) fail(`${what} fitting ${slotId}`);
  }
  for (const [slotId, rounds] of Object.entries(ship.ammo)) {
    if (!model!.slots.some((sl) => sl.id === slotId && sl.type === 'launcher') || !Number.isInteger(rounds) || (rounds as number) < 0) fail(`${what} ammo ${slotId}`);
  }
  if (!Number.isInteger(ship.repairKits) || ship.repairKits < 0) fail(`${what} repair kits`);
  if (!validCargo(ship.cargo)) fail(`${what} cargo entry`);
  if (!Number.isInteger(ship.decoys) || ship.decoys < 0 || ship.decoys > COMBAT.decoys.max) fail(`${what} decoys`);
  const sys = ship.systems;
  if (!isRecord(sys) || !(['engines', 'guns', 'shields'] as const).every((k) => Number.isFinite(sys[k]) && sys[k] >= 0 && sys[k] <= 1)) fail(`${what} systems`);
}

/**
 * A captain's work for the pilot's outposts (docs/PROCGEN.md §37.6): a trade haul as ever; a supply
 * captain for an outpost of the save; a mining captain with a laser aboard, for a belt refinery of
 * the save, in a phase of its cycle while at work (and only then).
 */
function validWork(o: GameState['fleet']['ships'][number], h: NonNullable<GameState['fleet']['ships'][number]['hauler']>): boolean {
  const site = siteOfStation(h.route.to);
  const own = !!site && (LOCATION_IDS as ReadonlySet<string>).has(h.route.to);
  if (h.work === undefined) return h.leg !== 'work' && h.phase === undefined && h.waiting !== 'supplies';
  if (h.work === 'supply') return own && h.leg !== 'work' && h.phase === undefined && h.waiting !== 'unprofitable';
  if (h.work !== 'mine' || !own || !site?.beltId || !(miningRig(o.ship).rate > 0) || h.waiting === 'unprofitable' || h.waiting === 'supplies') return false;
  return h.leg === 'work' ? ['to-rocks', 'cutting', 'to-dock', 'handing'].includes(h.phase as string) : h.phase === undefined;
}

/** The fleet (docs/PROCGEN.md §18): owned ships and their captains, storage, stakes and reports. */
function assertValidFleet(fl: GameState['fleet'], fail: (msg: string) => never): void {
  if (!isRecord(fl) || !Array.isArray(fl.ships) || !isRecord(fl.storage) || !Array.isArray(fl.stakes) || !Array.isArray(fl.reports)) fail('fleet');
  if (fl.ships.length > FLEET.hangar.max) fail('fleet: too many ships');
  const ids = new Set<string>();
  for (const o of fl.ships) {
    if (!isRecord(o) || typeof o.id !== 'string' || ids.has(o.id) || !LOCATION_IDS.has(o.locationId)) fail('fleet ship');
    ids.add(o.id);
    assertValidShip(o.ship, fail, `fleet ship ${o.id}`);
    const h = o.hauler;
    if (h === undefined) continue;
    const time = (t: unknown) => Number.isFinite(t);
    if (
      !isRecord(h) ||
      typeof h.captain !== 'string' ||
      !isRecord(h.route) ||
      h.route.from !== o.locationId ||
      !LOCATION_IDS.has(h.route.to) ||
      h.route.to === h.route.from ||
      !COMMODITY_IDS.includes(h.route.commodity) ||
      typeof h.insured !== 'boolean' ||
      typeof h.recalled !== 'boolean' ||
      !['home', 'out', 'back', 'work'].includes(h.leg) ||
      ![null, 'unprofitable', 'credits', 'supplies'].includes(h.waiting) ||
      !validWork(o, h) ||
      !Number.isInteger(h.waits) ||
      h.waits < 0 ||
      !time(h.hired) ||
      !time(h.since) ||
      !Number.isFinite(h.cost) ||
      h.cost < 0 ||
      !Number.isInteger(h.runs) ||
      h.runs < 0 ||
      !Number.isFinite(h.earned) ||
      (h.sight !== undefined && (!isRecord(h.sight) || !Number.isInteger(h.sight.run) || h.sight.run < 0 || !SYSTEM_IDS.includes(h.sight.systemId) || !time(h.sight.at)))
    ) {
      fail('hauler');
    }
  }
  for (const [id, cargo] of Object.entries(fl.storage)) {
    if (!LOCATION_IDS.has(id) || !validCargo(cargo)) fail('storage');
    let used = 0;
    for (const [c, q] of Object.entries(cargo)) used += (q ?? 0) * COMMODITIES[c as CommodityId].unitSize;
    if (used > FLEET.storage.capacity) fail('storage');
  }
  const stakes = new Set<string>();
  for (const k of fl.stakes) {
    if (
      !isRecord(k) ||
      !LOCATION_IDS.has(k.locationId) ||
      stakes.has(k.locationId) ||
      !Number.isInteger(k.percent) ||
      k.percent < 1 ||
      k.percent > FLEET.stakes.maxPercent ||
      !Number.isFinite(k.paid) ||
      k.paid < 0 ||
      !Number.isFinite(k.since) ||
      !Number.isFinite(k.earned)
    ) {
      fail('stakes');
    }
    stakes.add(k.locationId);
  }
  if (stakes.size > FLEET.stakes.maxStations) fail('stakes');
  const kinds = ['run', 'raid', 'lost', 'wait', 'home', 'supply', 'mine', 'news', 'folk'];
  if (!fl.reports.every((r) => isRecord(r) && Number.isFinite(r.at) && kinds.includes(r.kind) && typeof r.text === 'string' && Number.isFinite(r.amount) && (r.shipId === undefined || typeof r.shipId === 'string'))) fail('fleet reports');
}

/** Structural and range checks; throws SaveFormatError on anything that would break the game. */
export function assertValidState(s: GameState): void {
  const fail = (msg: string): never => {
    throw new SaveFormatError(`Save data is damaged: ${msg}`);
  };
  if (!isRecord(s) || s.version !== SAVE_VERSION) fail('wrong version');
  // The save's own outposts first: once valid, their ids are stations the rest of the save may name.
  const own = isRecord(s.world) ? s.world.outposts : undefined;
  LOCATION_IDS = SHARED_IDS;
  if (own !== undefined) {
    assertValidOutposts(own, fail);
    LOCATION_IDS = new Set([...SHARED_IDS, ...own.map((o) => outpostId(o.site))]);
  }
  if (isRecord(s.world) && s.world.outpostsFormer !== undefined && !validFormer(s.world.outpostsFormer)) fail('former outposts');
  // The real systems, or Pyre, the invented star (docs/PROCGEN.md §26).
  if (!KNOWN_SYSTEM_IDS.includes(s.location?.systemId)) fail('unknown system');
  if (s.location.dockedAt !== null && !LOCATION_IDS.has(s.location.dockedAt)) fail('unknown dock');
  if (!LOCATION_IDS.has(s.location.lastDockId)) fail('unknown respawn dock');
  if (!Number.isFinite(s.credits) || s.credits < 0) fail('credits');
  assertValidShip(s.ship, fail);
  if (!Array.isArray(s.visitedSystems) || !Array.isArray(s.discoveredBodies)) fail('lists');
  if (!isRecord(s.contracts)) fail('contracts');
  for (const [id, c] of Object.entries(s.contracts)) {
    if (!isRecord(c) || c.id !== id || !Array.isArray(c.objectives) || !c.objectives.length || !Number.isFinite(c.reward) || typeof c.title !== 'string') fail(`contract ${id}`);
    const party = c.contract?.party;
    if (party !== undefined && (!Array.isArray(party) || !party.length || !party.every((n) => typeof n === 'string' && n.length > 0))) fail(`contract ${id}`);
    const rank = c.requires?.rank;
    if (rank !== undefined && (!isRecord(rank) || !(rank.faction in RANKS.ladders) || !Number.isInteger(rank.rank) || rank.rank < 1 || rank.rank > 3)) fail(`contract ${id}`);
  }
  if (!isRecord(s.law) || !isRecord(s.law.fines) || !Array.isArray(s.law.pending) || !isRecord(s.law.lastCrimeAt)) fail('law');
  for (const c of s.law.pending) {
    if (!isRecord(c) || !['sta', 'frontier', 'hollow-wake'].includes(c.faction) || !Number.isFinite(c.amount) || c.amount < 0 || !SYSTEM_IDS.includes(c.systemId) || !Number.isFinite(c.at)) fail('law');
  }
  assertValidFleet(s.fleet, fail);
  const w = s.world;
  if (!isRecord(w) || !isRecord(w.relief) || !isRecord(w.raidKills) || !isRecord(w.ended) || !isRecord(w.lingering) || !isRecord(w.border)) fail('world');
  for (const b of Object.values(w.border)) {
    if (!isRecord(b) || !Array.isArray(b.deeds) || !b.deeds.every((d) => Array.isArray(d) && d.length === 2 && d.every(Number.isFinite))) fail('border');
    if (b.ending !== undefined && !['law', 'wake', 'truce'].includes(b.ending)) fail('border');
  }
  // Battles seen to an end (§35): a known front, kind and sides, at most so many, each once, its slot or cycle matching its time.
  for (const [id, b] of Object.entries(w.border)) {
    if (b.battles === undefined) continue;
    const known = getFront(id);
    if (!known || !Array.isArray(b.battles) || b.battles.length > BATTLES.keep) fail('border battles');
    const front = known!;
    const C = BATTLES.clash;
    const seen = new Set<string>();
    for (const r of b.battles) {
      const ok =
        isRecord(r) &&
        BATTLE_KINDS.includes(r.kind) &&
        Number.isInteger(r.key) &&
        Number.isFinite(r.at) &&
        r.at >= 0 &&
        r.at <= s.clock + 1 &&
        ['law', 'wake', 'draw'].includes(r.winner) &&
        ['law', 'wake'].includes(r.side) &&
        typeof r.part === 'boolean' &&
        (r.den === undefined || (r.den === true && r.kind === 'clash')) &&
        (r.kind === 'clash'
          ? r.at >= r.key * C.slotSeconds && r.at <= (r.key + 1) * C.slotSeconds + C.arrive + C.lasts
          : r.key >= cycleOf(front, r.at - BATTLES.turning.lasts) && r.key <= cycleOf(front, r.at)) &&
        !seen.has(`${r.kind}:${r.key}`);
      if (!ok) fail('border battles');
      seen.add(`${r.kind}:${r.key}`);
    }
  }
  if (w.marks !== undefined && (!isRecord(w.marks) || !Object.entries(w.marks).every(([id, t]) => !!markById(id) && Number.isFinite(t)))) fail('world');
  if (w.hauls !== undefined) {
    if (!isRecord(w.hauls)) fail('world');
    for (const r of Object.values(w.hauls)) {
      if (!isRecord(r) || !Number.isFinite(r.at) || !['safe', 'lost', 'escort', 'arrived'].includes(r.fate) || !SYSTEM_IDS.includes(r.systemId) || (r.by !== undefined && !['raiders', 'player'].includes(r.by))) fail('world');
    }
  }
  if (w.sky !== undefined && !(isRecord(w.sky) && Number.isFinite(w.sky.from) && w.sky.from >= 0)) fail('world');
  // Pyre's warning (docs/PROCGEN.md §26) comes after Antares has gone out.
  if (w.sky?.edge !== undefined && !(Number.isFinite(w.sky.edge) && w.sky.edge >= skyTimeline(w.sky.from).bhGone)) fail('world');
  // Lane encounters met (docs/PROCGEN.md §27): each in a real system, of a known kind.
  if (w.lanes !== undefined) {
    if (!isRecord(w.lanes)) fail('world');
    for (const [id, r] of Object.entries(w.lanes)) {
      if (!isRecord(r) || !Number.isFinite(r.at) || !(LANE_KINDS as readonly string[]).includes(r.kind) || !SYSTEM_IDS.includes(r.systemId) || id !== `${r.systemId}.${Math.floor(r.at / LANES.slotSeconds)}` || (r.pick !== undefined && typeof r.pick !== 'string')) fail('world');
    }
  }
  if (w.wrecks !== undefined) assertValidWrecks(w.wrecks, fail);
  if (w.racing !== undefined) assertValidRacing(w.racing, s.clock, fail);
  // A job on its way to a site steers by a site the log holds.
  for (const [id, p] of Object.entries(s.jobs)) {
    const o = isRecord(p) && p.status === 'active' ? s.contracts[id]?.objectives[p.objectiveIndex] : undefined;
    if (o?.kind === 'site' && !w.wrecks?.sites[o.siteId]) fail(`job ${id}`);
  }
  if (w.rivals !== undefined) {
    if (!isRecord(w.rivals) || !isRecord(w.rivals.down) || !isRecord(w.rivals.bought)) fail('world');
    for (const [id, d] of Object.entries(w.rivals.down)) if (!ROSTER.some((r) => r.id === id) || !isRecord(d) || !Number.isFinite(d.at) || !SYSTEM_IDS.includes(d.systemId)) fail('world');
    for (const t of Object.values(w.rivals.bought)) if (!Number.isFinite(t)) fail('world');
    // Rival stories (docs/PROCGEN.md §28): one each for the six, of a known path, at sane moments.
    if (w.rivals.stories !== undefined) {
      if (!isRecord(w.rivals.stories)) fail('world');
      for (const [id, st] of Object.entries(w.rivals.stories)) if (!ROSTER.some((r) => r.id === id) || !validStory(st)) fail(`rival story ${id}`);
    }
  }
  for (const [sys, l] of Object.entries(w.lingering)) {
    if (!KNOWN_SYSTEM_IDS.includes(sys) || !isRecord(l) || !Number.isFinite(l.at) || !Array.isArray(l.packs) || !Array.isArray(l.pods)) fail('world');
    const v3 = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
    if (!l.packs.every((p) => isRecord(p) && [1, 2, 3].includes(p.level) && Number.isInteger(p.count) && p.count > 0 && v3(p.position))) fail('world');
    if (!l.pods.every((p) => isRecord(p) && v3(p.position) && Number.isFinite(p.value) && (!p.cargo || COMMODITY_IDS.includes(p.cargo.commodity)) && (!p.gear || !!findGear(p.gear)))) fail('world');
  }
  for (const [f, fine] of Object.entries(s.law.fines)) if (!['sta', 'frontier', 'hollow-wake'].includes(f) || !Number.isFinite(fine) || (fine as number) < 0) fail(`fine ${f}`);
  if (!Array.isArray(s.codex) || !s.codex.every((id) => typeof id === 'string')) fail('codex');
  if (!Array.isArray(s.surveysSold) || !s.surveysSold.every((id) => SYSTEM_IDS.includes(id))) fail('surveys');
  if (!isRecord(s.milestones) || !Object.values(s.milestones).every((t) => Number.isFinite(t))) fail('milestones');
  if (!Number.isFinite(s.stats?.sales) || !Number.isFinite(s.stats?.rewards)) fail('stats');
  if (!isRecord(s.story) || !isRecord(s.story.choices) || !Array.isArray(s.story.seen)) fail('story');
  if (!Object.values(s.story.choices).every((v) => typeof v === 'string') || !s.story.seen.every((v) => typeof v === 'string')) fail('story');
  if (!isRecord(s.dens) || !Object.entries(s.dens).every(([id, t]) => LOCATION_IDS.has(id) && Number.isFinite(t))) fail('dens');
  if (!Array.isArray(s.stash) || s.stash.length > COMBAT.loot.stash || !s.stash.every((id) => typeof id === 'string' && !!findGear(id))) fail('stash');
  if (!Array.isArray(s.crew) || s.crew.length > COMBAT.wingmen.max) fail('crew');
  for (const w of s.crew) {
    if (!isRecord(w) || typeof w.id !== 'string' || typeof w.name !== 'string' || !findShip(w.model) || !Number.isFinite(w.fee) || w.fee < 0 || (w.skill !== 'steady' && w.skill !== 'sharp')) fail('crew');
    // A rival flying as an ally (§28) is one of the six.
    if (w.ally !== undefined && !ROSTER.some((r) => r.id === w.ally)) fail('crew');
    // Wing command (§34): a hired wingman's record; an ally keeps none.
    const count = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0);
    const own = [w.fights, w.downs, w.trust, w.memory, w.hurt, w.notice, w.owed];
    if (w.ally !== undefined && own.some((v) => v !== undefined)) fail('crew');
    if (!count(w.fights) || !count(w.downs) || (w.trust !== undefined && !(Number.isFinite(w.trust) && w.trust >= 0 && w.trust <= 100))) fail('crew');
    if (w.memory !== undefined && !WING_MEMORIES.includes(w.memory)) fail('crew');
    if (w.notice !== undefined && !(Number.isFinite(w.notice) && w.notice >= 0 && w.notice <= s.clock + 1)) fail('crew');
    if (w.owed !== undefined && !(Number.isFinite(w.owed) && w.owed > 0)) fail('crew');
    const h = w.hurt;
    if (h !== undefined && !(isRecord(h) && Number.isFinite(h.at) && h.at >= 0 && h.at <= s.clock + 1 && Number.isFinite(h.until) && h.until >= h.at && Number.isInteger(h.docks) && h.docks >= 0 && (h.down === undefined || h.down === true) && (h.hard === undefined || h.hard === true) && (h.dockAt === undefined || Number.isFinite(h.dockAt)))) fail('crew');
  }
  if (s.wingFormer !== undefined) {
    const ids = new Set(s.crew.map((w) => w.id));
    const n = (v: unknown, max = Infinity) => Number.isFinite(v) && (v as number) >= 0 && (v as number) <= max;
    const ok = (x: unknown) =>
      isRecord(x) &&
      typeof x.id === 'string' &&
      !ids.has(x.id) &&
      typeof x.name === 'string' &&
      typeof x.model === 'string' &&
      !!findShip(x.model) &&
      (x.skill === 'steady' || x.skill === 'sharp') &&
      Number.isInteger(x.fights) &&
      n(x.fights) &&
      Number.isInteger(x.downs) &&
      n(x.downs) &&
      n(x.trust, 100) &&
      n(x.at, s.clock + 1) &&
      (x.why === 'let-go' || x.why === 'unpaid' || x.why === 'unhappy');
    if (!Array.isArray(s.wingFormer) || s.wingFormer.length > WING.former || !s.wingFormer.every(ok)) fail('former wing');
  }
  if (s.aboard !== undefined) assertValidCrew(s.aboard, fail);
  // Ranks (docs/PROCGEN.md §32): with a known faction, within its ladder, given where and when the save could have been.
  if (s.ranks !== undefined) {
    if (!isRecord(s.ranks)) fail('ranks');
    for (const [f, r] of Object.entries(s.ranks)) {
      const ladder = RANKS.ladders[f as keyof typeof RANKS.ladders];
      if (!ladder || !isRecord(r) || !Number.isInteger(r.rank) || r.rank < 1 || r.rank > ladder.names.length || !Number.isFinite(r.at) || r.at < 0 || r.at > s.clock || !LOCATION_IDS.has(r.where) || (r.fell !== undefined && r.fell !== true)) fail(`rank ${f}`);
    }
  }
  if (!Array.isArray(s.priceWatch) || !s.priceWatch.every((w) => isRecord(w) && LOCATION_IDS.has(w.locationId) && COMMODITY_IDS.includes(w.commodity))) fail('price watch');
  const kinds = ['price', 'event', 'den', 'ace', 'wreck', 'story', 'front'];
  if (!Array.isArray(s.rumours) || !s.rumours.every((r) => isRecord(r) && typeof r.key === 'string' && typeof r.text === 'string' && kinds.includes(r.kind) && Number.isFinite(r.at))) fail('rumours');
  if (!isRecord(s.knownMarkets)) fail('known markets');
  for (const [id, m] of Object.entries(s.knownMarkets)) {
    if (!LOCATION_IDS.has(id) || !isRecord(m) || !Number.isFinite(m.observedAt) || !isRecord(m.prices) || !['visited', 'briefing', 'rumour', 'watch'].includes(m.source)) fail(`known market ${id}`);
    if (m.goodsAt !== undefined && (!isRecord(m.goodsAt) || !Object.values(m.goodsAt).every((g) => isRecord(g) && Number.isFinite(g.t)))) fail(`known market ${id}`);
  }
  if (!isRecord(s.markets)) fail('markets');
  for (const [id, m] of Object.entries(s.markets)) {
    if (!LOCATION_IDS.has(id) || !isRecord(m) || !Number.isFinite(m.t) || !isRecord(m.stock)) fail(`market ${id}`);
    for (const [c, qty] of Object.entries(m.stock)) if (!COMMODITY_IDS.includes(c as CommodityId) || !Number.isFinite(qty) || (qty as number) < 0) fail(`market ${id}`);
  }
  if (!isRecord(s.jobs) || !isRecord(s.reputation) || !isRecord(s.flags)) fail('records');
  // Standing with rival pilots (§24): only the six, within ±100.
  if (s.rivals !== undefined) {
    if (!isRecord(s.rivals)) fail('rivals');
    for (const [id, r] of Object.entries(s.rivals)) {
      const ok = ROSTER.some((x) => x.id === id) && isRecord(r) && Number.isFinite(r.standing) && Math.abs(r.standing) <= 100 && (r.round === undefined || Number.isInteger(r.round)) && (r.shot === undefined || Number.isFinite(r.shot)) && (r.met === undefined || (Number.isFinite(r.met) && r.met >= 0));
      if (!ok) fail(`rival ${id}`);
    }
  }
  // Escorts across jumps remember the system their ships are in.
  for (const [id, p] of Object.entries(s.jobs)) {
    if (!isRecord(p) || (p.escortAt !== undefined && !SYSTEM_IDS.includes(p.escortAt))) fail(`job ${id}`);
    // Passengers and sightseers (docs/PROCGEN.md §23): a tour's sight seen, and a fare's fright within 0–1.
    if ((p.seen !== undefined && typeof p.seen !== 'boolean') || (p.fright !== undefined && !(Number.isFinite(p.fright) && p.fright >= 0 && p.fright <= 1))) fail(`job ${id}`);
    // Observations of a dying far star (§25): when, and from a system of the map.
    if (p.observed !== undefined && !(Array.isArray(p.observed) && p.observed.every((x) => isRecord(x) && Number.isFinite(x.at) && KNOWN_SYSTEM_IDS.includes(x.systemId)))) fail(`job ${id}`);
    // A rival's duel (§28), won.
    if (p.duel !== undefined && p.duel !== 'won') fail(`job ${id}`);
    // A stand in a belt (§40.3), won.
    if (p.stood !== undefined && p.stood !== true) fail(`job ${id}`);
  }
  if (s.location.flight) {
    const { position, quaternion } = s.location.flight;
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) fail('flight position');
    if (!Array.isArray(quaternion) || quaternion.length !== 4 || !quaternion.every(Number.isFinite)) fail('flight orientation');
  }
}
