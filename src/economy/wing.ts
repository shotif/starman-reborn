import { applyCredits, type FormerWingman, type GameState, type Wingman } from '../app/state.ts';
import { shipModel } from '../content/catalog.ts';
import { COMBAT } from '../content/combat/rules.ts';
import { hashString } from '../content/random.ts';
import { GRADE_NAMES, WING_NOTES, WING_SAYS } from '../content/wing/lines.ts';
import { WING, type TrustBand, type WingGrade } from '../content/wing/rules.ts';
import { getLocation } from '../data/systems.ts';

/**
 * Wing command (docs/PROCGEN.md §34), the save's side: a hired wingman's grade from the fights they
 * have flown beside the pilot, their trust, fee, hurts and treatment, what happens at a dock, paying
 * the wing at a jump, and the wingmen who have left. Allies (§28) take orders but keep none of this.
 */

const clamp = (v: number) => Math.max(0, Math.min(100, v));
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? `{${k}}`);

export const isHired = (w: Wingman): boolean => !w.ally;

/** Points toward the next grade: fights and raiders downed, a sharp hire's head start. */
export function wingPoints(w: Pick<Wingman, 'skill' | 'fights' | 'downs'>): number {
  return (w.skill === 'sharp' ? WING.sharpStart : 0) + (w.fights ?? 0) + (w.downs ?? 0);
}

export function wingGrade(w: Pick<Wingman, 'skill' | 'fights' | 'downs'>): WingGrade {
  const p = wingPoints(w);
  let g = 1;
  WING.ladder.forEach((at, i) => {
    if (p >= at) g = i + 1;
  });
  return g as WingGrade;
}

export const gradeName = (g: WingGrade): string => GRADE_NAMES[g - 1]!;

/** Points to the next grade, or null at the top. */
export function nextGrade(w: Pick<Wingman, 'skill' | 'fights' | 'downs'>): { name: string; points: number } | null {
  const g = wingGrade(w);
  const ladder: readonly number[] = WING.ladder;
  const names: readonly string[] = GRADE_NAMES;
  const at = ladder[g];
  return at === undefined ? null : { name: names[g]!, points: at - wingPoints(w) };
}

/** How a grade flies: damage, aim, reaction, evasion. */
export function wingSkill(g: WingGrade): { damage: number; accuracy: number; react: number; evade: number } {
  const S = WING.skill;
  return { damage: S.damage[g - 1]!, accuracy: S.accuracy[g - 1]!, react: S.react[g - 1]!, evade: S.evade[g - 1]! };
}

export const trustOf = (w: Pick<Wingman, 'trust'>): number => w.trust ?? WING.trust.start;
export function trustBand(t: number): TrustBand {
  return t < WING.trust.wary ? 'wary' : t >= WING.trust.loyal ? 'loyal' : 'easy';
}

/** A wingman's fee per jump: the hire's base by tier, times their grade's, less the loyal discount. */
export function wingFee(w: Pick<Wingman, 'model' | 'skill' | 'fights' | 'downs' | 'trust'>): number {
  const tier = Math.min(2, shipModel(w.model).tier) as 1 | 2;
  const loyal = trustBand(trustOf(w)) === 'loyal' ? 1 - WING.fee.loyal : 1;
  return Math.round((COMBAT.wingmen.fee[tier] * WING.fee.grade[wingGrade(w) - 1]! * loyal) / 5) * 5;
}

export const isWingHurt = (w: Wingman, clock: number): boolean => !!w.hurt && (w.hurt.down === true || clock < w.hurt.until);
export const isDown = (w: Wingman): boolean => w.hurt?.down === true;

/** The wing as a flight takes it: those not shot down and waiting to rejoin, with their grade and whether they are hurt. */
export function launchList(state: GameState): { id: string; name: string; model: string; skill: Wingman['skill']; grade: WingGrade; hurt: boolean; ally?: string }[] {
  return state.crew
    .filter((w) => !isDown(w))
    .map((w) => ({ id: w.id, name: w.name, model: w.model, skill: w.skill, grade: w.ally ? (w.skill === 'sharp' ? 2 : 1) : wingGrade(w), hurt: isWingHurt(w, state.clock), ...(w.ally ? { ally: w.ally } : {}) }));
}

const hired = (state: GameState, id: string) => state.crew.find((w) => w.id === id && isHired(w));

/** A wingman fought beside the pilot (counted by the flight, within its caps). */
export function wingFought(state: GameState, id: string, got: { fights: number; downs: number }): void {
  const w = hired(state, id);
  if (!w || got.fights + got.downs <= 0) return;
  w.fights = (w.fights ?? 0) + got.fights;
  w.downs = (w.downs ?? 0) + got.downs;
  w.trust = clamp(trustOf(w) + WING.trust.fight * got.fights);
  w.memory = 'fight';
}

/** A wingman badly hit (holding back until mended or treated), or shot down (picked up, rejoining at the next dock). */
export function wingHurt(state: GameState, id: string, how: 'hit' | 'down'): Wingman | null {
  const w = hired(state, id);
  if (!w) return null;
  if (how === 'down') {
    w.hurt = { at: state.clock, until: state.clock + WING.hurt.downMend, docks: 0, down: true, hard: true };
    w.trust = clamp(trustOf(w) + WING.trust.down);
    w.memory = 'down';
  } else if (!isWingHurt(w, state.clock)) {
    w.hurt = { at: state.clock, until: state.clock + WING.hurt.mend, docks: 0 };
    w.trust = clamp(trustOf(w) + WING.trust.hit);
  }
  return w;
}

/** A dock's medic for the wing (any dock that repairs ships): what treating everyone hurt costs (0: nobody, or no medic). */
export function wingTreatQuote(state: GameState, locationId: string): number {
  if (!getLocation(locationId).services.includes('repair')) return 0;
  return state.crew.filter((w) => isHired(w) && !isDown(w) && isWingHurt(w, state.clock)).reduce((sum, w) => sum + (w.hurt?.hard ? WING.hurt.downTreat : WING.hurt.treat), 0);
}

export function treatWing(state: GameState, locationId: string): { ok: boolean; message: string } {
  const cost = wingTreatQuote(state, locationId);
  if (state.location.dockedAt !== locationId || cost <= 0) return { ok: false, message: 'Nobody on your wing to treat.' };
  if (state.credits < cost) return { ok: false, message: `Treatment costs ${cost} cr.` };
  applyCredits(state, -cost, 'repair', 'Treatment for your wing');
  const names: string[] = [];
  for (const w of state.crew) {
    if (!isHired(w) || isDown(w) || !isWingHurt(w, state.clock)) continue;
    delete w.hurt;
    w.trust = clamp(trustOf(w) + WING.trust.treated);
    w.memory = 'treated';
    names.push(fill(WING_NOTES.treated, { name: w.name }));
  }
  return { ok: true, message: names.join(' ') };
}

/** Remembers a wingman who leaves (the journal's "Flew with you"). */
function remember(state: GameState, w: Wingman, why: FormerWingman['why']): void {
  if (!isHired(w)) return;
  const list = (state.wingFormer ??= []);
  list.push({ id: w.id, name: w.name, model: w.model, skill: w.skill, fights: w.fights ?? 0, downs: w.downs ?? 0, trust: trustOf(w), at: state.clock, why });
  if (list.length > WING.former) list.splice(0, list.length - WING.former);
}

function leave(state: GameState, w: Wingman, why: FormerWingman['why']): void {
  const i = state.crew.indexOf(w);
  if (i >= 0) state.crew.splice(i, 1);
  remember(state, w, why);
}

/** Letting a wingman go (or parting ways with an ally, elsewhere). */
export function letWingmanGo(state: GameState, id: string): { ok: boolean; message: string } {
  const w = state.crew.find((x) => x.id === id);
  if (!w) return { ok: false, message: 'Not on your wing.' };
  leave(state, w, 'let-go');
  return { ok: true, message: `${w.name} leaves your wing.` };
}

/**
 * Each jump pays the wing (`hops` jumps at a time). A wingman shot down and waiting to rejoin is not
 * paid; one the pilot cannot pay leaves, unless they are loyal: then they fly on credit, owed at the
 * next dock.
 */
export function payWing(state: GameState, hops = 1): { paid: number; notes: string[] } {
  const notes: string[] = [];
  let paid = 0;
  for (const w of [...state.crew]) {
    const fee = w.fee * hops;
    if (fee <= 0 || isDown(w)) continue;
    if (state.credits >= fee) {
      applyCredits(state, -fee, 'fee', `Wing fee: ${w.name}`);
      paid += fee;
    } else if (isHired(w) && trustBand(trustOf(w)) === 'loyal') {
      w.owed = (w.owed ?? 0) + fee;
      w.trust = clamp(trustOf(w) + WING.trust.credit);
      w.memory = 'credit';
      notes.push(fill(WING_NOTES.credit, { name: w.name, fee: `${fee} cr` }));
    } else {
      leave(state, w, 'unpaid');
      notes.push(fill(WING_NOTES.unpaid, { name: w.name, fee: `${fee} cr` }));
    }
  }
  return { paid, notes };
}

export interface WingNote {
  text: string;
  tone: 'good' | 'bad' | 'info';
}

/**
 * At a dock: a wingman shot down rejoins; hurts mend in their time, or count a dock passed untreated;
 * fees follow a new grade; credit owed is paid (or they leave); a wary wingman gives notice, and leaves
 * at the next dock if still wary. Settling twice at one dock changes nothing.
 */
export function settleWing(state: GameState, at: string | null): WingNote[] {
  const notes: WingNote[] = [];
  const now = state.clock;
  for (const w of [...state.crew]) {
    if (!isHired(w)) continue;
    if (w.hurt?.down && at) {
      delete w.hurt.down;
      notes.push({ text: fill(WING_NOTES.rejoined, { name: w.name }), tone: 'info' });
    }
    if (w.hurt && !w.hurt.down && now >= w.hurt.until) {
      delete w.hurt;
      notes.push({ text: fill(WING_NOTES.mended, { name: w.name }), tone: 'good' });
    } else if (w.hurt && !w.hurt.down && at && w.hurt.dockAt !== now) {
      // A dock where they could have been seen to: from the second on, they mind.
      w.hurt.dockAt = now;
      w.hurt.docks++;
      if (w.hurt.docks > 1) {
        w.trust = clamp(trustOf(w) + WING.trust.untreated);
        w.memory = 'untreated';
      }
    }
    const fee = wingFee(w);
    if (at && fee !== w.fee) {
      const rose = fee > w.fee && wingGrade(w) > 1;
      w.fee = fee;
      if (rose) {
        w.memory = 'raise';
        notes.push({ text: fill(WING_NOTES.raise, { name: w.name, grade: gradeName(wingGrade(w)).toLowerCase(), fee: `${fee} cr` }), tone: 'info' });
      }
    }
    if (at && w.owed) {
      if (state.credits >= w.owed) {
        applyCredits(state, -w.owed, 'fee', `Wing fee owed: ${w.name}`);
        notes.push({ text: fill(WING_NOTES.paid, { name: w.name, fee: `${w.owed} cr` }), tone: 'info' });
        delete w.owed;
      } else {
        leave(state, w, 'unpaid');
        notes.push({ text: fill(WING_NOTES.unpaid, { name: w.name, fee: `${w.owed} cr` }), tone: 'bad' });
        continue;
      }
    }
    if (!at) continue;
    const wary = trustBand(trustOf(w)) === 'wary';
    if (wary && w.notice !== undefined && w.notice < now) {
      leave(state, w, 'unhappy');
      notes.push({ text: fill(WING_NOTES.left, { name: w.name }), tone: 'bad' });
    } else if (wary && w.notice === undefined) {
      w.notice = now;
      notes.push({ text: fill(WING_NOTES.notice, { name: w.name }), tone: 'bad' });
    } else if (!wary && w.notice !== undefined) delete w.notice;
  }
  return notes;
}

export type WingTag = 'hurt' | 'down' | 'notice' | 'loyal' | 'wary' | 'owed';

/** What a wingman's card is tagged with. */
export function wingTags(state: GameState, w: Wingman): WingTag[] {
  if (!isHired(w)) return [];
  const band = trustBand(trustOf(w));
  const tags: WingTag[] = [];
  if (isDown(w)) tags.push('down');
  else if (isWingHurt(w, state.clock)) tags.push('hurt');
  if (w.notice !== undefined) tags.push('notice');
  if (w.owed) tags.push('owed');
  if (band !== 'easy') tags.push(band);
  return tags;
}

/** What a wingman says when sat with: by what they remember last and how they feel about the pilot. */
export function wingLine(w: Wingman): string {
  const list = WING_SAYS[w.memory ?? 'new'][trustBand(trustOf(w))];
  return list[hashString(`${w.id}|${w.memory ?? 'new'}|${w.fights ?? 0}`) % list.length]!;
}
