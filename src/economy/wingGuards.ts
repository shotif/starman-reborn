import { DIFFICULTY } from '../app/settings.ts';
import { RAIDER_EVADE } from '../combat/PirateAI.ts';
import { COMBAT } from '../content/combat/rules.ts';
import { GRADE_WORD } from '../content/crew/lines.ts';
import type { Issue } from '../content/validate.ts';
import { GRADE_NAMES, ORDER_LOCKS, ORDER_WORDS, TRUST_NAMES, TRUST_PREFIX, WING_FICTION, WING_NOTES, WING_RADIO, WING_SAYS } from '../content/wing/lines.ts';
import { WING, WING_MEMORIES, WING_ORDERS, type WingRules } from '../content/wing/rules.ts';
import { SYSTEMS } from '../data/systems.ts';
import { TRAFFIC, trafficPlan } from '../world/traffic/plan.ts';

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
const BANDS = ['wary', 'easy', 'loyal'] as const;

/** What each note may fill in. */
const NOTE_FIELDS: Record<keyof typeof WING_NOTES, readonly string[]> = {
  treated: ['name'],
  mended: ['name'],
  rejoined: ['name'],
  raise: ['name', 'grade', 'fee'],
  notice: ['name'],
  left: ['name'],
  credit: ['name', 'fee'],
  paid: ['name', 'fee'],
  unpaid: ['name', 'fee'],
};

/**
 * Guardrails for wing command (docs/PROCGEN.md §34): the orders' distances in order, a guard or a
 * hold never let go of as soon as it is given; four grades that rise in every skill, a sharp hire
 * starting one up and the top grade some flights away; a veteran still aiming and jinking worse than a
 * raider, hitting under twice a raider's guns, and a full veteran wing out-gunned by the biggest pack;
 * at most four points a flight; fees that rise with grade but never double; trust that a fight or two
 * does not win, one loss does not sour and flying on credit does not turn; hurts that mend and a medic
 * no dearer than a repair or two; and the words with no number, no he or she, no star, only their
 * fields and short enough for the HUD and the touch chip.
 */
export function validateWing(rules: WingRules = WING): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const O = rules.orders;

  // The orders.
  if (!(O.ward.station > 0 && O.ward.station < O.ward.range && O.ward.range < O.ward.leash && O.ward.leash <= O.ward.prey)) report('rules', 'ward', 'a guard’s distances out of order');
  if (!(O.hold.range > 0 && O.hold.range < O.hold.leash)) report('rules', 'hold', 'a hold’s distances out of order');
  if (O.release <= Math.max(O.ward.prey, O.hold.leash) || O.mayday >= O.release) report('rules', 'release', 'a guard or a hold let go of too soon, or a mayday covered beyond it');
  if (!(O.free.range >= 1_500 && O.free.range < rules.catchUp)) report('rules', 'free', 'fighting at will too near, or beyond where the wing catches up');
  if (!(O.form.boost > 0 && O.form.boost < rules.catchUp)) report('rules', 'form', 'forming up boosts beyond the catch-up');

  // The grades.
  const L = rules.ladder as readonly number[];
  if (!(L.length === 4 && L[0] === 0 && L.every((v, i) => i === 0 || v > L[i - 1]!))) report('rules', 'ladder', 'not four grades rising from nothing');
  if (rules.sharpStart !== L[1]) report('rules', 'sharp', 'a sharp hire not starting one grade up');
  const S = rules.skill;
  const rises = (xs: readonly number[]) => xs.length === 4 && xs.every((v, i) => v > 0 && (i === 0 || v > xs[i - 1]!));
  if (!rises(S.damage) || !rises(S.accuracy) || !rises(S.evade) || !rises([...S.react].reverse())) report('rules', 'skill', 'a skill not getting better with every grade');
  if (S.damage[0] !== COMBAT.wingmen.skill.steady || S.damage[1] !== COMBAT.wingmen.skill.sharp) report('rules', 'skill', 'a new hire hitting other than the hiring board says');
  const E = rules.earn;
  if (!(E.fights >= 1 && E.downs >= 1 && E.fights + E.downs <= 4 && E.near >= 1_000 && E.near <= O.free.range)) report('rules', 'earn', 'more than four points a flight, or fights counted from too far');
  const flights = (L[3]! - rules.sharpStart) / (E.fights + E.downs);
  if (flights < 5 || flights > 20) report('balance', 'ladder', `a sharp hire a veteran in ${flights} flights at best (five to twenty)`);

  // Against the raiders.
  const raiderAim = DIFFICULTY.standard.enemyAccuracy;
  if (S.accuracy[3] >= raiderAim) report('balance', 'accuracy', 'a veteran aiming as well as a raider');
  if (S.evade[3] >= RAIDER_EVADE) report('balance', 'evade', 'a veteran jinking as often as a raider');
  if (S.damage[3] >= 2 * TRAFFIC.npcDamage) report('balance', 'damage', 'a veteran hitting twice as hard as a raider');
  if (S.react[3] < 0.25 || S.react[0] > 2) report('balance', 'react', 'a wingman reacting at once, or too slowly to matter');
  const pack = trafficPlan({ security: 0.1, owner: null, openStations: 1, hasDen: false, jumpsFromSol: 6 }).packs!;
  if (COMBAT.wingmen.max * S.damage[3] * S.accuracy[3] >= pack.size[1] * TRAFFIC.npcDamage * raiderAim) report('balance', 'wing', 'a full veteran wing out-gunning the biggest pack on its own');

  // Fees.
  const G = rules.fee.grade as readonly number[];
  if (!(G.length === 4 && G[0] === 1 && G.every((v, i) => i === 0 || v > G[i - 1]!) && G[3]! < 2)) report('balance', 'fee', 'fees not rising with grade from the hire’s, or doubling');
  if (!(rules.fee.loyal > 0 && rules.fee.loyal <= 0.25)) report('balance', 'fee', 'a loyal discount out of range');

  // Trust.
  const T = rules.trust;
  if (!(T.wary > 0 && T.wary < T.start && T.start < T.loyal && T.loyal <= 100)) report('rules', 'trust', 'trust bands out of order, or a start outside Easy');
  if (!(T.fight > 0 && T.treated > 0 && T.untreated < 0 && T.hit < 0 && T.down < 0 && T.credit < 0)) report('rules', 'trust', 'a change the wrong way');
  if ((T.loyal - T.start) / T.fight < 4) report('balance', 'trust', 'loyalty won in fewer than four fights');
  if (T.start + T.down < T.wary) report('balance', 'trust', 'a new hire soured by one loss');
  if (T.loyal + T.credit < T.wary) report('balance', 'trust', 'a loyal wingman turned wary by flying on credit');

  // Hurts.
  const H = rules.hurt;
  if (!(H.hull >= 0.2 && H.hull <= 0.6)) report('rules', 'hurt', 'holding back too early or too late');
  if (!(H.mend >= 1_800 && H.downMend > H.mend && H.downMend <= 43_200)) report('rules', 'hurt', 'mending too quick or slow, or a loss no slower to mend than a hurt');
  if (!(H.treat > 0 && H.treat <= COMBAT.systems.repairCost && H.downTreat > H.treat && H.downTreat <= 2 * COMBAT.systems.repairCost)) report('rules', 'hurt', 'a medic dearer than a repair (two after a loss)');
  if (!(rules.former >= 3 && rules.former <= 12)) report('rules', 'former', 'too few or too many former wingmen remembered');
  if (rules.catchUp < 3_000) report('rules', 'catchUp', 'catching up too near');

  // The words.
  const stars = SYSTEMS.map((s) => s.displayName.split(' ')[0]!).filter((w) => w.length > 3);
  const check = (subject: string, text: string, allowed: readonly string[], max = 160) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (GENDERED.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    if (text.length > max) report('lines', subject, `${text.length} characters (at most ${max})`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
    for (const s of stars) if (new RegExp(`\\b${s}\\b`).test(text)) report('lines', subject, `a star written into the line (${s})`);
  };
  for (const order of WING_ORDERS) {
    const w = ORDER_WORDS[order];
    check(`order.${order}.label`, w.label, [], 24);
    check(`order.${order}.short`, w.short, [], 8);
    check(`order.${order}.effect`, w.effect, [], 60);
    check(`order.${order}.ack`, w.ack, order === 'defend' || order === 'cover' ? ['ward'] : [], 60);
  }
  const shorts = WING_ORDERS.map((o) => ORDER_WORDS[o].short);
  if (new Set(shorts).size !== shorts.length) report('lines', 'order', 'two orders with the same short label');
  for (const [k, t] of Object.entries(ORDER_LOCKS)) check(`lock.${k}`, t, [], 50);
  for (const [k, t] of Object.entries(WING_RADIO)) check(`radio.${k}`, t, k === 'wardGone' ? ['ward'] : k === 'picked' ? ['name'] : [], 100);
  for (const [k, t] of Object.entries(WING_NOTES)) check(`note.${k}`, t, NOTE_FIELDS[k as keyof typeof WING_NOTES]);
  for (const key of ['new', ...WING_MEMORIES] as const) {
    for (const band of BANDS) {
      const list = WING_SAYS[key]?.[band] ?? [];
      if (!list.length) report('lines', `says.${key}.${band}`, 'nothing to say');
      for (const t of list) check(`says.${key}.${band}`, t, [], 80);
    }
  }
  for (const band of BANDS) {
    check(`trust.${band}`, TRUST_NAMES[band], [], 12);
    const p = TRUST_PREFIX[band];
    check(`prefix.${band}`, p, [], 24);
    if (p && !p.endsWith(' ')) report('lines', `prefix.${band}`, 'a prefix that runs into the reply');
  }
  const crewWords = new Set(Object.values(GRADE_WORD));
  if (GRADE_NAMES.length !== 4 || new Set(GRADE_NAMES).size !== 4) report('names', 'grades', 'not four grade names of their own');
  for (const g of GRADE_NAMES) {
    check(`grade.${g}`, g, [], 16);
    if (crewWords.has(g)) report('names', g, 'a grade name a crew grade uses');
  }
  if (/\d/.test(WING_FICTION) || !WING_FICTION.startsWith('Fiction:')) report('lines', 'fiction', 'the fiction line');
  return issues;
}
