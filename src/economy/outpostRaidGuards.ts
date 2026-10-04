import { createNewGame, type GameState, type OutpostRecord } from '../app/state.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import { RAID_FICTION, RAID_GUARD, RAID_NEWS, RAID_NOTES, RAID_WATCH } from '../content/outposts/raidLines.ts';
import { OUTPOST_RAIDS, type OutpostRaidRules, type RaidBand } from '../content/outposts/raids.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { outpostSites } from '../content/outposts/sites.ts';
import type { Issue } from '../content/validate.ts';
import { WORLD } from '../data/systems.ts';
import { useWorldLog } from './events.ts';
import { defenceAt, firstWindow, holdOdds, raidBand, raidIn } from './outpostRaids.ts';
import { riskOf } from './tradeComputer.ts';

/**
 * Guardrails for raids on the player's outpost (docs/PROCGEN.md §29): the rules make sense (odds,
 * threat and strength rising with lawlessness, a hold table that climbs, losses that hurt without
 * ruining), the words hold no number of their own and no he or she; and, worked out over many
 * windows of real sites and saves, raids hurt but never ruin (an undefended port away loses a
 * tenth to a third of its income in thin or lawless space, under a tenth where patrols fly), and
 * turrets are worth building (in lawless space a port's three pay back their materials in 20–60
 * hours of income saved).
 */
export function validateOutpostRaids(rules: OutpostRaidRules = OUTPOST_RAIDS, windows = 400): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const o = rules.odds;
  if (!(o.patrolled > 0 && o.patrolled < o.thin && o.thin <= o.lawless && o.lawless < 1)) report('rules', 'odds', 'odds not rising with lawlessness within 0–1');
  if (!(rules.strike[0] >= 0 && rules.strike[0] < rules.strike[1] && rules.strike[1] <= 1 && rules.window >= 3_600 && rules.grace >= 0)) report('rules', 'window', 'a window, its strike or the grace out of range');
  if (rules.stage.length !== OUTPOSTS.stages.length || rules.stage.some((x, i) => x <= 0 || (i > 0 && x < rules.stage[i - 1]!))) report('rules', 'stage', 'odds not growing with the outpost');
  if (!(rules.raidEvent.odds >= 1 && rules.raidEvent.max < 1 && rules.trusted > 0 && rules.trusted < 1)) report('rules', 'odds', 'a raid event or the Wake’s trust moving the odds the wrong way');
  const t = rules.threat;
  if (!(t.patrolled <= t.thin && t.thin <= t.lawless)) report('rules', 'threat', 'threat not rising with lawlessness');
  if (!(rules.warning > 0 && rules.probe.warning >= rules.warning && rules.guards.delay <= rules.warning)) report('rules', 'warning', 'a warning too short to hire a guard in');
  if (rules.turrets.needs.length !== OUTPOSTS.stages.length || rules.turrets.needs.some((n) => !Object.keys(n).length)) report('rules', 'turrets', 'a turret for each stage, each needing something');
  if (!(rules.turrets.upkeep > 0 && rules.turrets.repair > 0 && rules.turrets.downSeconds >= 3_600)) report('rules', 'turrets', 'upkeep, repairs or a knock-out out of range');
  const g = rules.guards;
  if (!(g.max >= 1 && g.offers >= 1 && g.terms.every((x, i) => x > 0 && (i === 0 || x > g.terms[i - 1]!)) && g.perHour.sharp > g.perHour.steady && g.perHour.steady > 0)) report('rules', 'guards', 'guards’ terms or pay out of order');
  const h = rules.hold;
  if (h.some(([x, y], i) => y < 0 || y > 0.95 || (i > 0 && (x <= h[i - 1]![0] || y < h[i - 1]![1])))) report('rules', 'hold', 'a hold table that does not climb, or promises more than 95%');
  const S = rules.strength;
  if (!(S[1] > 0 && S[1] < S[2] && S[2] < S[3])) report('rules', 'strength', 'strength not rising with threat');
  const L = rules.lost;
  if (!(L.income > 0 && L.income < 1 && L.stock > 0 && L.stock < 1 && L.price > 1 && L.stored > 0 && L.stored < 1 && L.hours[1] <= L.hours[2] && L.hours[2] <= L.hours[3])) report('rules', 'lost', 'a loss that does not hurt, or ruins');
  if (rules.fight.stores.length !== OUTPOSTS.stages.length || rules.fight.cap < 600) report('rules', 'fight', 'stores for each stage, and time to fight');

  // The words.
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (/\b(he|she|him|her|his|hers)\b/i.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    for (const [, k] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(k!)) report('lines', subject, `{${k}} it cannot fill`);
  };
  for (const [k, list] of Object.entries(RAID_WATCH)) for (const line of list) check(`watch.${k}`, line, ['ships', 'minutes']);
  for (const [k, list] of Object.entries(RAID_GUARD)) for (const line of list) check(`guard.${k}`, line, []);
  const noteFields: Record<string, readonly string[]> = { warning: ['outpost', 'ships', 'minutes', 'odds'], held: ['outpost'], lost: ['outpost', 'hours', 'good', 'took'], turretDown: [], guardOnPost: ['guard', 'outpost', 'from'] };
  for (const [k, line] of Object.entries(RAID_NOTES)) check(`note.${k}`, line, noteFields[k] ?? []);
  for (const [k, list] of Object.entries(RAID_NEWS)) for (const line of list) check(`news.${k}`, line, ['outpost', 'system']);
  if (/\d/.test(RAID_FICTION) || !RAID_FICTION.startsWith('Fiction:')) report('lines', 'fiction', 'the fiction line');

  if (rules !== OUTPOST_RAIDS) return issues;
  const b = raidBalance(windows);
  for (const band of ['thin', 'lawless'] as const) {
    const share = b.lost[band];
    if (share !== undefined && (share < 0.1 || share > 0.35)) report('balance', band, `an undefended port loses ${Math.round(share * 100)}% of its income (10–35%)`);
  }
  if (b.lost.patrolled !== undefined && b.lost.patrolled >= 0.1) report('balance', 'patrolled', `an undefended port loses ${Math.round(b.lost.patrolled * 100)}% where patrols fly (under 10%)`);
  if (!(b.payback >= 20 && b.payback <= 60)) report('balance', 'turrets', `three turrets pay back in ${Math.round(b.payback)} h in lawless space (20–60)`);
  return issues;
}

/**
 * How raids weigh, worked out over many windows of real sites and saves: the share of a port's
 * income an undefended one loses away, by band; and how long a lawless port's three turrets take
 * to pay back their materials (at base prices) in income saved, less their upkeep.
 */
export function raidBalance(windows = 400, seeds = 20): { lost: Partial<Record<RaidBand, number>>; payback: number } {
  const sums: Partial<Record<RaidBand, { lost: number; hours: number }>> = {};
  let lawlessSaved = 0;
  let lawlessHours = 0;
  // Planet sites (a belt's are raided by the same rules, by their system).
  const raided = outpostSites().filter((s) => !!s.planetId && (WORLD.profiles.get(s.systemId)?.security ?? 1) < OUTPOST_RAIDS.maxSecurity);
  const bands: RaidBand[] = ['patrolled', 'thin', 'lawless'];
  const byBand = new Map(bands.map((b) => [b, raided.filter((s) => riskOf(WORLD.profiles.get(s.systemId)?.security ?? 1) === b)]));
  const L = OUTPOST_RAIDS.lost;
  const port = OUTPOSTS.stages.at(-1)!.income;
  for (let k = 0; k < seeds; k++) {
    // Sites of every band in turn.
    const pool = byBand.get(bands[k % bands.length]!)!;
    if (!pool.length) continue;
    const site = pool[(Math.floor(k / bands.length) * 7) % pool.length]!;
    const state: GameState = createNewGame(1_000 + k);
    const o: OutpostRecord = { site: site.id, kind: site.kinds[0]!, name: 'Test Port', founded: 0, stage: OUTPOSTS.stages.length, delivered: {}, since: 0, earned: 0, opened: 0 };
    state.world.outposts = [o];
    useWorldLog(state.world);
    try {
      const band = raidBand(o);
      const sum = (sums[band] ??= { lost: 0, hours: 0 });
      // A first raid already met: the rest are full raids.
      o.defence = { turrets: 0, delivered: {}, down: [], guards: [], raids: [{ window: -1, at: 0, threat: 1, result: 'held', where: 'away' }], settled: 0 };
      for (let n = firstWindow(o); n < firstWindow(o) + Math.round(windows / seeds); n++) {
        sum.hours += OUTPOST_RAIDS.window / 3_600;
        if (band === 'lawless') lawlessHours += OUTPOST_RAIDS.window / 3_600;
        const plan = raidIn(state, o, n);
        if (!plan) continue;
        const bare = holdOdds(defenceAt(state, o, plan.at).value, plan.threat);
        const cut = L.hours[plan.threat] * (1 - L.income);
        sum.lost += (1 - bare) * cut;
        if (band === 'lawless') {
          const armed = holdOdds(defenceAt(state, o, plan.at).value + 3 * OUTPOST_RAIDS.defence.turret, plan.threat);
          lawlessSaved += (armed - bare) * cut;
        }
      }
    } finally {
      useWorldLog(null);
    }
  }
  const lost: Partial<Record<RaidBand, number>> = {};
  for (const [band, s] of Object.entries(sums) as [RaidBand, { lost: number; hours: number }][]) lost[band] = s.hours ? s.lost / s.hours : 0;
  const materials = OUTPOST_RAIDS.turrets.needs.reduce((sum, need) => sum + Object.entries(need).reduce((t, [c, q]) => t + COMMODITIES[c as keyof typeof COMMODITIES].basePrice * q!, 0), 0);
  const savedPerHour = lawlessHours ? (lawlessSaved / lawlessHours) * port - 3 * OUTPOST_RAIDS.turrets.upkeep : 0;
  return { lost, payback: savedPerHour > 0 ? materials / savedPerHour : Infinity };
}

