import { createNewGame, type RivalStory } from '../app/state.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import { RIVALS, ROSTER, type RivalDef } from '../content/rivals/rules.ts';
import { STORY, STORY_NEWS, STORY_NOTES } from '../content/rivals/storyLines.ts';
import { RIVAL_STORY, type RivalStoryRules } from '../content/rivals/stories.ts';
import type { Issue } from '../content/validate.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { getLocation, WORLD } from '../data/systems.ts';
import { MAX_REWARD } from './contractGuards.ts';
import { useWorldLog } from './events.ts';
import { patrolsScanIn } from './law.ts';
import { validateRivals } from './rivalGuards.ts';
import { departOf, duelSystem, heldAt, holdsOf, runOf, turnStart, type RivalRun } from './rivals.ts';
import { failurePoint } from './rivalStories.ts';

/** What each kind of line may fill in. */
const VOICE_FIELDS: Record<string, readonly string[]> = { loanAsk: ['amount', 'back'], repaid: ['amount'], escortAsk: ['dest'], distress: ['system', 'qty'], challenge: ['system'] };
const NOTE_FIELDS: Record<keyof typeof STORY_NOTES, readonly string[]> = {
  lent: ['rival', 'amount'],
  repaid: ['rival', 'amount'],
  distress: ['rival', 'ship', 'system', 'qty', 'until'],
  towed: ['rival', 'system'],
  letDown: ['rival'],
  allyJoins: ['rival'],
  allyLeaves: ['rival', 'station'],
  tipoff: ['rival'],
  ambush: ['rival'],
  challenge: ['rival', 'system', 'until'],
  started: [],
  won: ['rival', 'amount'],
  lost: ['rival', 'amount'],
  forfeit: ['rival', 'amount'],
  noShow: ['rival', 'system'],
  amends: ['rival'],
};
const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

const security = (systemId: string) => WORLD.profiles.get(systemId)?.security ?? 1;

/**
 * Guardrails for rival stories (docs/PROCGEN.md §28): the rules make sense (an ally within reach of
 * the loan and the deed alone, a duel that ends in a yield before a ship is lost, windows long enough
 * to get there, pay under the contracts' ceiling, a feud's ending leaving nobody hostile); every rival
 * can play its story (a lawless system to call the player out to, lawful or lawless space near home
 * for its opening, a run for its drive to fail on); the words hold no number, no he or she, no name
 * of their own, and fit; and careers held by stories still add up.
 */
export function validateRivalStories(rules: RivalStoryRules = RIVAL_STORY, roster: readonly RivalDef[] = ROSTER): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const F = rules.friend;
  const E = rules.enemy;

  // The rules.
  if (!(F.standing >= 10 && F.standing < 40)) report('rules', 'friend', 'a friend’s story opening outside friendly standing');
  if (!(F.loan.standing > 0 && F.deedStanding > 0 && F.standing + F.loan.standing + F.deedStanding >= F.ally.standing && F.ally.standing <= 100)) report('rules', 'ally', 'an ally out of reach of the loan and the deed');
  if (Object.values(F.loan.amount).some((a) => !(a > 0 && a <= MAX_REWARD)) || !(F.loan.interest > 0 && F.loan.interest <= 0.5)) report('rules', 'loan', 'a loan or its interest out of range');
  if (!(F.escort.reward > 0 && F.escort.reward <= MAX_REWARD && F.escort.letDown < 0 && F.rescue.towed < 0 && F.rescue.qty > 0 && F.rescue.reward > 0)) report('rules', 'deed', 'a deed’s pay or cost out of range');
  if (!(F.rescue.at > 0 && F.rescue.at < 1 && F.rescue.after >= 0)) report('rules', 'rescue', 'a drive failure off its leg');
  if (!(F.ally.every >= RIVALS.turnSeconds)) report('rules', 'ally', 'an ally asked more often than a turn');
  const D = E.duel;
  if (!(D.yieldAt >= 0.2 && D.yieldAt <= 0.5 && D.minHull > D.yieldAt + 0.2 && D.minHull <= 1)) report('rules', 'duel', 'a yield out of 0.2–0.5, or a start too close to it');
  if (!(D.startWithin < D.offBeacon && D.startWithin < D.forfeitRange)) report('rules', 'duel', 'a duel that starts beyond where it is forfeit');
  if (!(D.purse > 0 && D.purse <= MAX_REWARD && D.stake > 0 && D.stake <= D.purse)) report('rules', 'duel', 'a purse or stake out of range');
  if (!(D.wonStanding > -30 && D.lostStanding > -30 && D.lostStanding < D.wonStanding)) report('rules', 'duel', 'a duel’s ending leaving the rival hostile');
  if (!(E.after >= 0 && E.sinceMet >= 0 && E.ambush.guns >= 1 && E.ambush.hunterGuns >= 1 && E.ambush.delay[0] > 0 && E.ambush.delay[0] <= E.ambush.delay[1])) report('rules', 'enemy', 'a feud that strikes at once, or with nobody');
  // Windows: long enough to get there from anywhere in reach (the longest run of a career, half again).
  const trip = Math.max(...sample().map((r) => r.arrive - r.depart));
  for (const [what, w] of [['rescue', F.rescue.giveUp], ['escort', F.escort.wait], ['tipoff', E.tipoff.seconds], ['ambush', E.ambush.seconds], ['duel', D.open]] as const) {
    if (w < 1.5 * trip) report('rules', what, `a window of ${w} s, shorter than half again the longest trip (${trip} s)`);
  }

  // Every rival can play its story.
  const deeds = new Set<string>();
  const openings = new Set<string>();
  for (const r of roster) {
    const path = rules.paths[r.id];
    if (!path) {
      report('roster', r.id, 'no story');
      continue;
    }
    deeds.add(path.deed);
    openings.add(path.opening);
    const near = jumpsFrom(WORLD.links, getLocation(r.home).systemId);
    const duel = duelSystem(r);
    if (security(duel) >= RIVALS.hostile.lawless || duel === 'sol' || (near.get(duel) ?? 99) > 3) report('roster', r.id, `${duel}: no lawless system within three jumps to call the player out to`);
    const within = (jumps: number) => [...near.entries()].filter(([s, j]) => j <= jumps && s !== 'sol').map(([s]) => s);
    if (path.opening === 'tipoff' && !within(E.tipoff.jumps).some((s) => patrolsScanIn(s))) report('roster', r.id, 'no lawful space near home to tip customs off in');
    if (path.opening === 'ambush' && !within(E.ambush.jumps).some((s) => security(s) < RIVALS.hostile.lawless)) report('roster', r.id, 'no lawless space near home to wait in');
    if (path.deed === 'rescue') {
      for (const from of [turnStart(2), turnStart(12), turnStart(30)]) if (!failurePoint(r, from)) report('roster', r.id, 'no run for its drive to fail on');
    }
  }
  if (rules === RIVAL_STORY) {
    for (const d of ['escort', 'rescue']) if (!deeds.has(d)) report('coverage', d, 'no rival’s story has this deed');
    for (const o of ['tipoff', 'ambush']) if (!openings.has(o)) report('coverage', o, 'no rival’s story has this opening');
  }

  // The words.
  const names = new Set<string>([...roster.flatMap((r) => [r.first, r.nick, r.last, r.shipName]), ...Object.values(CHARACTERS).map((c) => c.name.split(' ')[0]!)]);
  const check = (subject: string, text: string, allowed: readonly string[]) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (GENDERED.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    if (text.length > 300) report('lines', subject, `${text.length} characters (at most 300)`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
    for (const n of names) if (new RegExp(`\\b${n}\\b`).test(text)) report('lines', subject, `a name written into the line (${n})`);
  };
  for (const [voice, lines] of Object.entries(STORY)) for (const [k, t] of Object.entries(lines)) check(`${voice}.${k}`, t, VOICE_FIELDS[k] ?? []);
  for (const [k, t] of Object.entries(STORY_NOTES)) check(`note.${k}`, t, NOTE_FIELDS[k as keyof typeof STORY_NOTES]);
  for (const [k, list] of Object.entries(STORY_NEWS)) for (const t of list) check(`news.${k}`, t, ['rival', 'ship', 'system']);

  // Careers held by stories still add up.
  if (rules === RIVAL_STORY) for (const issue of heldCareers(roster)) issues.push(issue);
  return issues;
}

let sampled: RivalRun[] | null = null;
function sample(): RivalRun[] {
  if (!sampled) {
    sampled = [];
    for (const r of ROSTER) for (let n = 0; n < 48; n++) {
      const run = runOf(r, n);
      if (run) sampled.push(run);
    }
  }
  return sampled;
}

/**
 * Each rival's career over two days with a story of each path holding it (an escort, a drive
 * failure, flights on the wing; a wait with hired guns and a duel): no run sets off inside a hold,
 * the rival is held for each, the next run sets off from where the hold left them, and the runs
 * pass the careers' own guardrails.
 */
function heldCareers(roster: readonly RivalDef[]): Issue[] {
  const issues: Issue[] = [];
  const report = (subject: string, message: string) => issues.push({ rule: 'holds', subject, message });
  for (const path of ['friend', 'enemy'] as const) {
    const state = createNewGame(7);
    const stories: Record<string, RivalStory> = {};
    for (const r of roster) {
      const t = (n: number) => departOf(r, n);
      const runAt = (n: number) => {
        for (let k = n; k < n + 6; k++) if (runOf(r, k)) return runOf(r, k)!;
        return null;
      };
      if (path === 'friend') {
        const run = runAt(10);
        const fail = failurePoint(r, t(20));
        stories[r.id] = {
          path,
          began: t(2),
          loan: { amount: 900, repaid: t(4) },
          ...(run && fail ? { deed: { kind: 'rescue' as const, at: fail.at, job: `rs.${r.id}.rescue`, to: fail.to, systemId: fail.systemId, end: fail.at + 1_800, resume: fail.to, done: true } } : {}),
          wings: [{ at: t(30) - 60, end: t(31) + 1_200, resume: r.home }, { at: t(40) - 60 }],
        };
      } else {
        stories[r.id] = { path, began: t(8), spent: t(8) + 900, duel: { posted: t(12) }, ended: { at: t(12) + 2_400, how: 'won' } };
      }
    }
    state.world.rivals = { down: {}, bought: {}, stories };
    useWorldLog(state.world);
    try {
      const runs: RivalRun[] = [];
      for (const r of roster) {
        for (let n = 0; n < 48; n++) {
          const run = runOf(r, n);
          if (!run) continue;
          runs.push(run);
          if (heldAt(r, run.depart)) report(run.id, 'a run set off inside a hold');
        }
        for (const h of holdsOf(r)) {
          if (h.to === Infinity) continue;
          // The first run after a hold sets off from where it left them.
          for (let n = Math.floor((h.to - RIVALS.from) / RIVALS.turnSeconds) + 1; n < 48; n++) {
            const run = runOf(r, n);
            if (!run) continue;
            if (run.depart < h.to) continue;
            if (holdsOf(r).every((x) => x === h || x.to <= h.to || x.from >= run.depart) && run.from !== h.resume) report(run.id, `set off from ${run.from}, not where the ${h.kind} left them (${h.resume})`);
            break;
          }
        }
      }
      for (const i of validateRivals(RIVALS, roster, runs)) report(i.subject, i.message);
    } finally {
      useWorldLog(null);
    }
  }
  return issues;
}
