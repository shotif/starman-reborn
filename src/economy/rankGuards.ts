import { gearForSale, shipsForSale } from '../content/catalog.ts';
import { CONTRACTS, type ContractKind } from '../content/contracts/rules.ts';
import { CREW_ROLES } from '../content/crew/rules.ts';
import { EVENTS } from '../content/events/rules.ts';
import { FLEET } from '../content/fleet/rules.ts';
import { LAW } from '../content/law/rules.ts';
import { RATINGS } from '../content/progress/rules.ts';
import { PERK_WORDS, RANK_FICTION, RANK_LINES, RANK_NOTES } from '../content/ranks/lines.ts';
import { RANKS, type RankRules } from '../content/ranks/rules.ts';
import { RULES } from '../content/rules/index.ts';
import { CHARACTERS } from '../content/story/arcs.ts';
import type { Issue } from '../content/validate.ts';
import { ALL_LOCATIONS, SYSTEMS } from '../data/systems.ts';
import type { FactionId } from '../data/types.ts';
import { boardFor, followUpFor } from './contracts.ts';
import { MAX_REWARD } from './contractGuards.ts';
import { FACTIONS, TIER_LABEL } from './factions.ts';
import { isLawful } from './law.ts';

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
/** Kinds a commission may be: work the boards' generator makes (never rescues, passages, tours, observations, war or den work). */
const COMMISSION_KINDS: readonly ContractKind[] = ['parcel', 'freight', 'supply', 'bounty', 'survey', 'escort', 'recovery', 'smuggle', 'piracy'];
const OUTLAW_KINDS: readonly ContractKind[] = ['smuggle', 'piracy'];

/**
 * Guardrails for ranks (docs/PROCGEN.md §32.7): ladders of three, standing rising and a lawful rank
 * never held by a wary pilot, a Wake rank never by one the Wake does not trust, a fall one step at a
 * time; records within the ratings' ladders; discounts small, rising, and never enough for a ship or
 * piece of gear bought and sold back (or lost and insured) to pay; perks and commissions in range,
 * commissions of kinds the generator makes, never outlaw work for the law and some for the Wake; names of
 * their own and words with no number, no he or she, no star, only their fields and short enough; and
 * over the world's boards, commissions only at the owner's own stations, one at most, as the rules say,
 * never chained, and on most of the boards they should be.
 */
export function validateRanks(rules: RankRules = RANKS, epochs = 8): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const P = rules.perks;
  const factions = Object.keys(rules.ladders) as FactionId[];

  // The ladders.
  for (const f of factions) {
    const L = rules.ladders[f];
    const s = L.standing;
    if (L.names.length !== 3 || s.length !== 3 || !(s[0] >= 1 && s[0] < s[1] && s[1] < s[2] && s[2] <= 90)) report('rules', f, 'not three ranks with standing rising within 1–90');
    const gap = Math.min(s[1] - s[0], s[2] - s[1]);
    if (!(rules.keepMargin > 0 && rules.keepMargin < gap)) report('rules', f, 'a margin that would let a rank fall more than a step at a time, or none');
    if (isLawful(f) && (s[0] < CONTRACTS.gateStanding || s[0] - rules.keepMargin < 0)) report('rules', f, 'a lawful rank a wary pilot could hold, or below the boards’ gate');
    if (f === 'hollow-wake' && s[0] - rules.keepMargin < LAW.wakeFriendly) report('rules', f, 'a Wake rank held by a pilot the Wake does not trust');
    const [a, b] = L.record;
    if (a === b || !RATINGS[a] || !RATINGS[b]) report('rules', f, 'two ratings that are one, or unknown');
  }
  const R = rules.record;
  if (!(R[0] >= 1 && R[0] < R[1] && R[1] < R[2])) report('rules', 'record', 'records not rising');
  for (const f of factions) for (const k of rules.ladders[f].record) if (RATINGS[k] && R[2] >= RATINGS[k].ranks.length) report('rules', f, `a record beyond the ${k} ladder`);

  // The perks.
  const Y = P.yard;
  if (!(Y[0] > 0 && Y[0] < Y[1] && Y[1] < Y[2] && Y[2] <= 0.15)) report('balance', 'yard', 'discounts not small and rising');
  if (1 - Y[2] - RULES.balance.resale < 0.15) report('balance', 'yard', 'gear bought at the top discount and sold back loses too little');
  if (!(1 - Y[2] > FLEET.risk.payout + 0.15)) report('balance', 'yard', 'a ship bought at the top discount and lost insured pays too much back');
  if (!(P.coverFrom >= 1 && P.coverFrom <= 3) || !(P.outpost.from >= 1 && P.outpost.from <= 3 && P.outpost.odds > 0 && P.outpost.odds < 1)) report('rules', 'perks', 'a perk from a rank that is none, or odds out of range');
  if (!(P.extraActive.from >= 1 && P.extraActive.from <= 3 && P.extraActive.slots === 1)) report('rules', 'perks', 'more than one more contract at once');
  const W = rules.work;
  if (!(W.pay >= 1.1 && W.pay <= 1.5) || !(W.standing > 0 && W.standing <= 3)) report('balance', 'work', 'a commission paid or worth standing out of range');
  if (!W.rankFor.every((r, i) => r >= 1 && r <= 3 && (i === 0 || r >= W.rankFor[i - 1]!))) report('rules', 'work', 'ranks a commission needs not rising with difficulty');
  for (const f of factions) {
    const kinds = W.kinds[f];
    if (!kinds.length || kinds.some((k) => !COMMISSION_KINDS.includes(k))) report('rules', f, 'a commission of a kind the boards do not make');
    if (f === 'hollow-wake' ? !kinds.some((k) => OUTLAW_KINDS.includes(k)) : kinds.some((k) => OUTLAW_KINDS.includes(k))) report('rules', f, 'outlaw work for the law, or none for the Wake');
  }
  if (!(rules.news.seconds >= 1_800 && rules.news.seconds <= 21_600 && rules.news.jumps >= 0 && rules.news.jumps <= EVENTS.newsJumps)) report('rules', 'news', 'told too briefly, too long or too far');

  // The words.
  const names = factions.flatMap((f) => rules.ladders[f].names);
  if (new Set(names).size !== names.length) report('names', 'ranks', 'a rank named twice');
  const reserved = new Set<string>([...Object.values(TIER_LABEL), ...Object.values(RATINGS).flatMap((r) => r.ranks.map(([n]) => n)), ...CREW_ROLES.map((r) => r.charAt(0).toUpperCase() + r.slice(1))]);
  const words = new Set<string>([
    ...ALL_LOCATIONS.flatMap((l) => l.name.split(/\s+/)),
    ...SYSTEMS.flatMap((s) => s.displayName.split(/\s+/)),
    ...Object.values(FACTIONS).flatMap((f) => f.name.split(/\s+/)),
    ...Object.values(CHARACTERS).flatMap((c) => [...c.name.split(' '), ...(c.role ? c.role.split(/\s+/) : [])]),
  ]);
  for (const n of names) {
    if (reserved.has(n) || n.length > 16) report('names', n, 'a rank named like a standing, a rating or a crew role, or too long');
    if (n.split(/\s+/).some((w) => words.has(w))) report('names', n, 'a rank sharing a word with a place, a faction or a character');
  }
  const stars = SYSTEMS.map((s) => s.displayName.split(' ')[0]!).filter((w) => w.length > 3);
  const check = (subject: string, text: string, allowed: readonly string[], max: number) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (GENDERED.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    if (text.length > max) report('lines', subject, `${text.length} characters (at most ${max})`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
    for (const s of stars) if (new RegExp(`\\b${s}\\b`).test(text)) report('lines', subject, `a star written into the line (${s})`);
  };
  for (const [f, L] of Object.entries(RANK_LINES)) {
    check(`${f}.ceremony`, L.ceremony, ['rank'], 240);
    check(`${f}.greet`, L.greet, ['rank'], 90);
    check(`${f}.cover`, L.cover, ['rank', 'station'], 120);
    check(`${f}.headline`, L.headline, ['rank'], 60);
    check(`${f}.news`, L.news, ['rank'], 200);
    check(`${f}.work.title`, L.work.title, [], 24);
    check(`${f}.work.brief`, L.work.brief, [], 80);
  }
  for (const [k, t] of Object.entries(RANK_NOTES)) check(`note.${k}`, t, ['rank', 'faction', 'now', 'percent'], 120);
  for (const [k, t] of Object.entries(PERK_WORDS)) check(`perk.${k}`, t, ['percent'], 80);
  if (/\d/.test(RANK_FICTION) || !RANK_FICTION.startsWith('Fiction:')) report('lines', 'fiction', 'the fiction line');

  if (rules !== RANKS) return issues;

  // The world: yards for every ladder's discount, and the boards over several time slots.
  for (const f of factions) {
    const yards = ALL_LOCATIONS.filter((l) =>
      f === 'hollow-wake'
        ? (l.stationType === 'freeport' || l.stationType === 'pirate-den') && (gearForSale(l.id).some((g) => g.maker === 'wake') || shipsForSale(l.id).some((m) => m.maker === 'wake'))
        : l.factionId === f && l.stationType !== 'pirate-den' && (gearForSale(l.id).length > 0 || shipsForSale(l.id).length > 0),
    );
    if (yards.length < (f === 'hollow-wake' ? 2 : 3)) report('world', f, `a discount at only ${yards.length} yards`);
  }
  const boards: Record<string, { boards: number; with: number }> = {};
  for (const l of ALL_LOCATIONS) {
    const owner: FactionId | null = l.stationType === 'pirate-den' ? 'hollow-wake' : isLawful(l.factionId ?? null) ? l.factionId! : null;
    for (let epoch = 0; epoch < epochs; epoch++) {
      const board = boardFor(l.id, epoch);
      if (!board.length) continue;
      const ranked = board.filter((c) => c.requires?.rank);
      if (owner) {
        const b = (boards[owner] ??= { boards: 0, with: 0 });
        b.boards++;
        if (ranked.length) b.with++;
      }
      if (ranked.length > 1) report('world', l.id, 'more than one commission on a board');
      for (const c of ranked) {
        const need = c.requires!.rank!;
        if (!owner || need.faction !== owner) report('world', c.id, 'a commission posted by a station that is not its faction’s own');
        if (!c.id.endsWith('.rank')) report('world', c.id, 'a commission whose id does not say so');
        if (need.rank !== W.rankFor[c.difficulty - 1]) report('world', c.id, 'a commission needing the wrong rank for its difficulty');
        if (!W.kinds[need.faction].includes(c.contract!.kind)) report('world', c.id, 'a commission of a kind its faction does not give');
        if (c.reward > MAX_REWARD) report('world', c.id, `pay of ${c.reward}`);
        if ((c.repReward[need.faction] ?? 0) < W.standing) report('world', c.id, 'a commission worth no more standing');
        if (followUpFor(c, epoch * CONTRACTS.epochSeconds)) report('world', c.id, 'a commission with a follow-up');
      }
    }
  }
  for (const f of factions) {
    const b = boards[f];
    const share = b && b.boards ? b.with / b.boards : 0;
    if (share < (f === 'hollow-wake' ? 0.5 : 0.6)) report('world', f, `commissions on ${Math.round(share * 100)}% of its boards`);
  }
  return issues;
}
