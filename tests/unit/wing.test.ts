import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AudioEngine } from '../../src/audio/AudioEngine.ts';
import { defaultSettings } from '../../src/app/settings.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState, type Wingman } from '../../src/app/state.ts';
import { GRADE_NAMES, ORDER_LOCKS, ORDER_WORDS, WING_RADIO, WING_SAYS } from '../../src/content/wing/lines.ts';
import { WING, type WingOrder } from '../../src/content/wing/rules.ts';
import type { SystemId } from '../../src/data/types.ts';
import { ALL_LOCATIONS, getLocation } from '../../src/data/systems.ts';
import { pilotsFor } from '../../src/economy/combat.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import {
  gradeName,
  isWingHurt,
  launchList,
  letWingmanGo,
  nextGrade,
  payWing,
  settleWing,
  treatWing,
  trustBand,
  wingFee,
  wingFought,
  wingGrade,
  wingHurt,
  wingLine,
  wingSkill,
  wingTags,
  wingTreatQuote,
} from '../../src/economy/wing.ts';
import { validateWing } from '../../src/economy/wingGuards.ts';
import { emptyInput } from '../../src/flight/input/types.ts';
import { FlightSession, type FlightCallbacks, type NpcShip, type TrafficSetup } from '../../src/world/FlightSession.ts';
import { SystemScene } from '../../src/world/SystemScene.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import type { TrafficPlan } from '../../src/world/traffic/plan.ts';
import { WingCommand, type WingView } from '../../src/world/WingCommand.ts';

/**
 * Wing command (docs/PROCGEN.md §34): the orders a hired wing takes in flight, how its pilots grow
 * with every fight, how they come to trust the one who pays them, and how they are hurt, picked up and
 * treated. Nobody on the wing is lost for good.
 */

afterEach(() => useWorldLog(null));

const FIGHTER = 'ship.light-fighter.1.halden';
const REPAIRS = ALL_LOCATIONS.find((l) => l.status === 'functional' && l.dockable !== false && l.services.includes('repair') && l.stationType !== 'pirate-den')!.id;
/** Every open station repairs ships; a raider den does not. */
const NO_REPAIRS = ALL_LOCATIONS.find((l) => !l.services.includes('repair'))!.id;

function pilotAt(locationId: string, clock = 10_000): GameState {
  const s = createNewGame(23);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 50_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

/** A wingman on the pilot's pay. */
function hire(s: GameState, more: Partial<Wingman> = {}): Wingman {
  const skill = more.skill ?? 'steady';
  const w: Wingman = { id: `w.test.${s.crew.length}`, name: s.crew.length ? 'Tobin Sato' : 'Maren Okoro', model: FIGHTER, fee: wingFee({ model: FIGHTER, skill }), skill, ...more };
  s.crew.push(w);
  return w;
}

/** The next dock, `seconds` on. */
function dock(s: GameState, seconds: number, at = s.location.dockedAt) {
  s.clock += seconds;
  return settleWing(s, at);
}

describe('wing command: the rules', () => {
  it('pass their guardrails', () => {
    expect(validateWing()).toEqual([]);
  });

  it('catch broken rules and words', () => {
    const subjects = (patch: object) => validateWing({ ...WING, ...patch } as unknown as typeof WING).map((i) => i.subject);
    expect(subjects({ skill: { ...WING.skill, accuracy: [0.6, 0.7, 0.8, 0.9] } })).toContain('accuracy');
    expect(subjects({ skill: { ...WING.skill, evade: [0.5, 0.6, 0.7, 0.85] } })).toContain('evade');
    expect(subjects({ skill: { ...WING.skill, damage: [0.3, 0.38, 0.5, 0.6] } })).toEqual(expect.arrayContaining(['damage', 'wing']));
    expect(subjects({ skill: { ...WING.skill, react: [1.2, 0.9, 0.9, 0.4] } })).toContain('skill');
    expect(subjects({ earn: { ...WING.earn, fights: 3, downs: 3 } })).toContain('earn');
    expect(subjects({ ladder: [0, 4, 12, 13] })).toContain('ladder');
    expect(subjects({ fee: { ...WING.fee, grade: [1, 1.25, 1.45, 2.2] } })).toContain('fee');
    expect(subjects({ trust: { ...WING.trust, fight: 10 } })).toContain('trust');
    expect(subjects({ trust: { ...WING.trust, credit: -50 } })).toContain('trust');
    expect(subjects({ orders: { ...WING.orders, mayday: 9_000 } })).toContain('release');
    expect(subjects({ hurt: { ...WING.hurt, downTreat: 900 } })).toContain('hurt');
    const says = WING_SAYS.fight.easy as string[];
    says.push('She downed 3 of them.');
    try {
      const words = validateWing().filter((i) => i.rule === 'lines').map((i) => i.message);
      expect(words.some((m) => m.includes('number'))).toBe(true);
      expect(words.some((m) => m.includes('he or she'))).toBe(true);
    } finally {
      says.pop();
    }
  });
});

describe('grades, fees and trust', () => {
  it('four grades from fights and downs, a sharp hire starting one up, each flying better', () => {
    const steady = { skill: 'steady' as const };
    expect(wingGrade(steady)).toBe(1);
    expect(gradeName(1)).toBe(GRADE_NAMES[0]);
    expect(nextGrade(steady)).toEqual({ name: GRADE_NAMES[1], points: 4 });
    expect(wingGrade({ skill: 'sharp' })).toBe(2);
    expect(wingGrade({ skill: 'sharp', fights: 6, downs: 2 })).toBe(3);
    expect(wingGrade({ skill: 'steady', fights: 20, downs: 8 })).toBe(4);
    expect(nextGrade({ skill: 'steady', fights: 20, downs: 8 })).toBeNull();
    const [g1, g2, g3, g4] = ([1, 2, 3, 4] as const).map(wingSkill);
    expect(g1!.damage).toBeLessThan(g2!.damage);
    expect(g4!.accuracy).toBeGreaterThan(g3!.accuracy);
    expect(g4!.react).toBeLessThan(g1!.react);
    expect(g4!.evade).toBeGreaterThan(g1!.evade);
  });

  it('a fee by grade, less for a loyal wingman, and the hiring board asks the same', () => {
    expect(wingFee({ model: FIGHTER, skill: 'steady' })).toBe(180);
    expect(wingFee({ model: FIGHTER, skill: 'sharp' })).toBe(225);
    expect(wingFee({ model: FIGHTER, skill: 'steady', fights: 20, downs: 8 })).toBe(305);
    expect(wingFee({ model: FIGHTER, skill: 'steady', fights: 20, downs: 8, trust: 80 })).toBe(275);
    const board = ALL_LOCATIONS.flatMap((l) => pilotsFor(l.id, 50_000));
    expect(board.length).toBeGreaterThan(5);
    for (const p of board) expect(p.fee, p.id).toBe(wingFee(p));
  });

  it('fights win trust and grade; a bad hit or a loss costs trust; one shot down is not launched', () => {
    const s = pilotAt(REPAIRS);
    const w = hire(s);
    wingFought(s, w.id, { fights: 2, downs: 1 });
    expect(w).toMatchObject({ fights: 2, downs: 1, trust: 56, memory: 'fight' });
    wingHurt(s, w.id, 'hit');
    expect(w.hurt).toEqual({ at: s.clock, until: s.clock + WING.hurt.mend, docks: 0 });
    expect(w.trust).toBe(51);
    // Hit again while hurt: nothing more.
    wingHurt(s, w.id, 'hit');
    expect(w.trust).toBe(51);
    expect(launchList(s)).toEqual([expect.objectContaining({ id: w.id, grade: 1, hurt: true })]);
    wingHurt(s, w.id, 'down');
    expect(w.hurt).toMatchObject({ down: true, hard: true, until: s.clock + WING.hurt.downMend });
    expect(w).toMatchObject({ trust: 41, memory: 'down' });
    expect(launchList(s)).toEqual([]);
    expect(isWingHurt(w, s.clock + 1e6)).toBe(true);
  });

  it('an ally takes orders but keeps no record', () => {
    const s = pilotAt(REPAIRS);
    const ally = hire(s, { ally: 'lantern', fee: 0 });
    wingFought(s, ally.id, { fights: 1, downs: 1 });
    wingHurt(s, ally.id, 'down');
    expect(ally.fights).toBeUndefined();
    expect(ally.hurt).toBeUndefined();
    expect(wingTags(s, ally)).toEqual([]);
    expect(payWing(s).paid).toBe(0);
  });
});

describe('at a dock', () => {
  it('one shot down rejoins hurt; a dock passed untreated after the first weighs on them; a medic sees to them', () => {
    const s = pilotAt(REPAIRS);
    const w = hire(s);
    wingHurt(s, w.id, 'down');
    expect(dock(s, 600)).toEqual([{ text: 'Maren Okoro is back on your wing in a new ship from their insurers.', tone: 'info' }]);
    expect(w.hurt).toMatchObject({ docks: 1, hard: true });
    expect(w.hurt?.down).toBeUndefined();
    expect(w.trust).toBe(40);
    // Settling twice at one dock changes nothing.
    expect(settleWing(s, REPAIRS)).toEqual([]);
    expect(w.hurt?.docks).toBe(1);
    dock(s, 600);
    expect(w).toMatchObject({ trust: 35, memory: 'untreated' });
    expect(wingTags(s, w)).toEqual(['hurt']);
    // A medic: dearer after a loss; none where ships are not repaired.
    expect(wingTreatQuote(s, NO_REPAIRS)).toBe(0);
    expect(wingTreatQuote(s, REPAIRS)).toBe(WING.hurt.downTreat);
    const credits = s.credits;
    expect(treatWing(s, REPAIRS)).toEqual({ ok: true, message: 'The medic sees to Maren Okoro.' });
    expect(s.credits).toBe(credits - WING.hurt.downTreat);
    expect(w.hurt).toBeUndefined();
    expect(w).toMatchObject({ trust: 40, memory: 'treated' });
    expect(treatWing(s, REPAIRS).ok).toBe(false);
  });

  it('a hurt mends in its own time', () => {
    const s = pilotAt(REPAIRS);
    const w = hire(s);
    wingHurt(s, w.id, 'hit');
    expect(dock(s, WING.hurt.mend)).toEqual([{ text: 'Maren Okoro is fit to fly again.', tone: 'good' }]);
    expect(w.hurt).toBeUndefined();
  });

  it('a new grade brings a raise, once', () => {
    const s = pilotAt(REPAIRS);
    const w = hire(s, { fights: 8, downs: 4 });
    expect(dock(s, 60)).toEqual([{ text: 'Maren Okoro is now a seasoned wing: their fee rises to 260 cr a jump.', tone: 'info' }]);
    expect(w).toMatchObject({ fee: 260, memory: 'raise' });
    expect(dock(s, 60)).toEqual([]);
  });

  it('a wary wingman gives notice and leaves at a later dock, unless won back', () => {
    const s = pilotAt(REPAIRS);
    const w = hire(s, { trust: 25 });
    const v = hire(s, { trust: 25 });
    expect(dock(s, 60).map((n) => n.text)).toEqual(['Maren Okoro is not happy flying for you and gives notice.', 'Tobin Sato is not happy flying for you and gives notice.']);
    expect(w.notice).toBe(s.clock);
    expect(wingTags(s, w)).toEqual(['notice', 'wary']);
    expect(settleWing(s, REPAIRS)).toEqual([]);
    v.trust = 40;
    expect(dock(s, 60)).toEqual([{ text: 'Maren Okoro leaves your wing.', tone: 'bad' }]);
    expect(s.crew).toEqual([v]);
    expect(v.notice).toBeUndefined();
    expect(s.wingFormer).toEqual([expect.objectContaining({ id: w.id, why: 'unhappy', trust: 25 })]);
  });
});

describe('paying the wing', () => {
  it('each jump pays the wing; short of credits, a wingman leaves unless loyal, who flies on credit until the next dock', () => {
    const s = pilotAt(REPAIRS);
    const easy = hire(s);
    const loyal = hire(s, { trust: 80 });
    expect(payWing(s, 2)).toEqual({ paid: 720, notes: [] });
    s.credits = 100;
    const r = payWing(s);
    expect(r.notes).toEqual(['Maren Okoro leaves your wing: you could not pay the 180 cr fee.', 'Tobin Sato flies this one on credit: 180 cr owed at your next dock.']);
    expect(s.crew).toEqual([loyal]);
    expect(loyal).toMatchObject({ owed: 180, trust: 65, memory: 'credit' });
    expect(wingTags(s, loyal)).toEqual(['owed']);
    expect(s.wingFormer).toEqual([expect.objectContaining({ id: easy.id, why: 'unpaid' })]);
    // Paid at the next dock; or, still short, they leave.
    s.credits = 1_000;
    expect(dock(s, 60)).toEqual([{ text: 'You settle the 180 cr you owed Tobin Sato.', tone: 'info' }]);
    expect(s.credits).toBe(820);
    expect(loyal.owed).toBeUndefined();
    loyal.trust = 80;
    s.credits = 0;
    payWing(s);
    expect(dock(s, 60)).toEqual([{ text: 'Tobin Sato leaves your wing: you could not pay the 180 cr fee.', tone: 'bad' }]);
    expect(s.crew).toEqual([]);
  });

  it('one shot down and waiting to rejoin is not paid', () => {
    const s = pilotAt(REPAIRS);
    const w = hire(s);
    wingHurt(s, w.id, 'down');
    expect(payWing(s)).toEqual({ paid: 0, notes: [] });
  });

  it('the journal remembers so many who have flown with the pilot', () => {
    const s = pilotAt(REPAIRS);
    for (let i = 0; i < WING.former + 2; i++) {
      const w = hire(s, { id: `w.gone.${i}`, fights: i });
      expect(letWingmanGo(s, w.id).ok).toBe(true);
    }
    expect(s.wingFormer).toHaveLength(WING.former);
    expect(s.wingFormer![0]!.id).toBe('w.gone.2');
    expect(s.wingFormer!.every((f) => f.why === 'let-go')).toBe(true);
    assertValidState(s);
  });
});

describe('what they say', () => {
  it('by what they remember last and how they feel, the same each time', () => {
    const s = pilotAt(REPAIRS);
    const w = hire(s, { trust: 80, memory: 'treated' });
    expect(WING_SAYS.treated.loyal).toContain(wingLine(w));
    expect(wingLine(w)).toBe(wingLine({ ...w }));
    expect(trustBand(80)).toBe('loyal');
    expect(WING_SAYS.new.easy).toContain(wingLine(hire(s)));
  });
});

describe('saves', () => {
  it('keep the wing’s records and refuse damaged ones', () => {
    const s = pilotAt(REPAIRS);
    hire(s, { fights: 3, downs: 1, trust: 61, memory: 'fight', hurt: { at: 9_000, until: 20_000, docks: 1, hard: true, dockAt: 9_500 }, notice: 9_900, owed: 180 });
    hire(s, { ally: 'lantern', fee: 0 });
    s.wingFormer = [{ id: 'w.gone', name: 'Esra Kovac', model: FIGHTER, skill: 'sharp', fights: 4, downs: 2, trust: 20, at: 5_000, why: 'unhappy' }];
    assertValidState(s);
    const bad = (patch: (x: GameState) => void) => {
      const x = structuredClone(s);
      patch(x);
      return () => assertValidState(x);
    };
    expect(bad((x) => (x.crew[1]!.fights = 2))).toThrow(/crew/);
    expect(bad((x) => (x.crew[0]!.trust = 120))).toThrow(/crew/);
    expect(bad((x) => (x.crew[0]!.fights = 1.5))).toThrow(/crew/);
    expect(bad((x) => (x.crew[0]!.memory = 'bored' as never))).toThrow(/crew/);
    expect(bad((x) => (x.crew[0]!.notice = x.clock + 100))).toThrow(/crew/);
    expect(bad((x) => (x.crew[0]!.owed = 0))).toThrow(/crew/);
    expect(bad((x) => (x.crew[0]!.hurt = { at: 1, until: 0, docks: 0 }))).toThrow(/crew/);
    expect(bad((x) => (x.wingFormer![0]!.id = x.crew[0]!.id))).toThrow(/former wing/);
    expect(bad((x) => (x.wingFormer![0]!.why = 'fired' as never))).toThrow(/former wing/);
    expect(bad((x) => (x.wingFormer = Array.from({ length: WING.former + 1 }, (_, i) => ({ ...x.wingFormer![0]!, id: `w.${i}` }))))).toThrow(/former wing/);
  });
});

// ---------------------------------------------------------------- the orders, on their own

/** A ship for the orders to see: only what they read. */
function ship(id: string, at: [number, number, number], more: Record<string, unknown> = {}): NpcShip {
  return {
    id,
    name: id,
    side: 'lawful',
    target: { id: `npc:${id}`, name: id, hostile: false },
    body: { position: new THREE.Vector3(...at), quaternion: new THREE.Quaternion() },
    durability: { hull: 100, hullMax: 100 },
    ...more,
  } as unknown as NpcShip;
}

const wingman = (id: string, at: [number, number, number], more: Record<string, unknown> = {}) =>
  ship(id, at, { wingman: { offset: new THREE.Vector3(-40, 0, 20), crewId: id, react: 0.5, ...more } });
const raider = (id: string, at: [number, number, number], pack = 1) => ship(id, at, { side: 'raider', pack, target: { id: `npc:${id}`, name: id, hostile: true } });

function view(npcs: NpcShip[], more: Partial<WingView> = {}): WingView {
  const player = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  return { time: 0, alive: true, busy: false, dueling: false, player: player as WingView['player'], selectedId: null, npcs, fair: (x) => x.side === 'raider', ...more };
}

describe('the orders', () => {
  it('a guard or a hold ends at a jump; the rest carry over', () => {
    const carried = (o: WingOrder) => new WingCommand(o).order;
    expect(['free', 'attack', 'defend', 'cover', 'hold', 'form'].map((o) => carried(o as WingOrder))).toEqual(['free', 'attack', 'free', 'free', 'free', 'form']);
  });

  it('the card locks Defend without a friendly ship selected, and Cover without a hauler', () => {
    const w = wingman('w1', [0, 0, 0]);
    const trader = ship('Petrel', [500, 0, 0]);
    const bandit = raider('r1', [800, 0, 0]);
    const cmd = new WingCommand();
    const locks = (v: WingView) => Object.fromEntries(cmd.options(v).map((o) => [o.order, o.lock]));
    expect(cmd.options(view([w])).map((o) => o.label)).toEqual(['free', 'attack', 'defend', 'cover', 'hold', 'form'].map((o) => ORDER_WORDS[o as WingOrder].label));
    expect(locks(view([w, trader, bandit]))).toEqual({ free: null, attack: null, defend: ORDER_LOCKS.noWard, cover: ORDER_LOCKS.noHauler, hold: null, form: null });
    expect(locks(view([w, trader, bandit], { selectedId: bandit.target.id })).defend).toBe(ORDER_LOCKS.hostile);
    expect(locks(view([w, trader, bandit], { selectedId: w.target.id })).defend).toBe(ORDER_LOCKS.noWard);
    expect(locks(view([w, trader, bandit], { selectedId: trader.target.id })).defend).toBeNull();
    expect(cmd.give('cover', view([w, trader]))).toBeNull();
    expect(cmd.order).toBe('free');
    (trader as { escort?: object }).escort = { jobId: 'c.1' };
    expect(locks(view([w, trader])).cover).toBeNull();
    expect(cmd.give('cover', view([w, trader]))).toBe('Copy. Covering the Petrel.');
    expect(cmd.status()).toMatchObject({ order: 'cover', ward: 'Petrel' });
  });

  it('a new foe takes a moment to react; a guard goes for whoever goes for its ward, and lets go when the ward is lost or far', () => {
    const w = wingman('w1', [0, 0, 0]);
    const trader = ship('Petrel', [5_000, 0, 0]);
    const near = raider('r1', [600, 0, 0]);
    const after = raider('r2', [8_000, 0, 0], 2);
    const npcs = [w, trader, near, after];
    const cmd = new WingCommand();
    // At will: the nearest raider to the pilot, after a moment.
    expect(cmd.foeFor(w, view(npcs, { time: 0 }))).toBeNull();
    expect(cmd.foeFor(w, view(npcs, { time: 0.4 }))).toBeNull();
    expect(cmd.foeFor(w, view(npcs, { time: 0.5 }))).toBe(near);
    // Defend the trader: the raider going for it, though further off than the one near the pilot.
    (after as { prey?: NpcShip }).prey = trader;
    expect(cmd.give('defend', view(npcs, { selectedId: trader.target.id }))).toBe('Copy. Sticking with the Petrel.');
    expect(cmd.foeFor(w, view(npcs, { time: 1 }))).toBeNull();
    expect(cmd.foeFor(w, view(npcs, { time: 1.5 }))).toBe(after);
    // Its station: off the ward, not the pilot.
    expect(cmd.slotFor(w, view(npcs), new THREE.Vector3()).distanceTo(trader.body.position)).toBeCloseTo(WING.orders.ward.station);
    // The pilot far off: the guard ends.
    expect(cmd.update(view(npcs), 0.1)).toEqual([]);
    trader.body.position.set(WING.orders.release + 1, 0, 0);
    expect(cmd.update(view(npcs), 0.1)).toEqual([{ kind: 'released', why: 'far', ward: 'Petrel' }]);
    expect(cmd.order).toBe('form');
    // Formed up: nobody to fight.
    expect(cmd.foeFor(w, view(npcs, { time: 9 }))).toBeNull();
    // The ward lost.
    trader.body.position.set(1_000, 0, 0);
    cmd.give('defend', view(npcs, { selectedId: trader.target.id }));
    trader.durability.hull = 0;
    expect(cmd.update(view(npcs), 0.1)).toEqual([{ kind: 'released', why: 'ward', ward: 'Petrel' }]);
  });

  it('a hold fights only what comes close to the point, or goes for them, and ends when the pilot is far off', () => {
    const w = wingman('w1', [0, 0, 0], { react: 0 });
    const near = raider('r1', [WING.orders.hold.range - 100, 0, 0]);
    const far = raider('r2', [0, WING.orders.hold.range + 400, 0], 2);
    const v = view([w, near, far]);
    const cmd = new WingCommand();
    expect(cmd.give('hold', v)).toBe(ORDER_WORDS.hold.ack);
    expect(cmd.status().hold).toEqual([0, 0, 0]);
    expect(cmd.foeFor(w, v)).toBe(near);
    near.durability.hull = 0;
    expect(cmd.foeFor(w, v)).toBeNull();
    (far as { foe?: NpcShip }).foe = w;
    expect(cmd.foeFor(w, v)).toBe(far);
    // The pilot flies off: the wing keeps its station at the point, until the pilot is far.
    v.player.position.set(3_000, 0, 0);
    expect(cmd.slotFor(w, v, new THREE.Vector3()).length()).toBeLessThan(100);
    expect(cmd.anchored).toBe(true);
    expect(cmd.update(v, 0.1)).toEqual([]);
    v.player.position.set(WING.orders.release + 1, 0, 0);
    expect(cmd.update(v, 0.1)).toEqual([{ kind: 'released', why: 'far', ward: null }]);
  });

  it('nobody fights while hurt, in a duel, or once told to form up, and forming up boosts home from far out', () => {
    const w = wingman('w1', [0, 0, 0], { react: 0 });
    const r = raider('r1', [500, 0, 0]);
    const cmd = new WingCommand();
    expect(cmd.foeFor(w, view([w, r], { dueling: true }))).toBeNull();
    expect(cmd.foeFor(w, view([w, r], { busy: true }))).toBeNull();
    (w.wingman as { hurt?: boolean }).hurt = true;
    expect(cmd.foeFor(w, view([w, r]))).toBeNull();
    expect(cmd.hud([w, r])).toEqual({ count: 1, order: 'free', hurt: 1 });
    delete (w.wingman as { hurt?: boolean }).hurt;
    cmd.give('form', view([w, r]));
    expect(cmd.foeFor(w, view([w, r]))).toBeNull();
    const slot = cmd.slotFor(w, view([w, r]), new THREE.Vector3());
    expect(cmd.boostHome(w, slot)).toBe(false);
    w.body.position.set(WING.orders.form.boost + 200, 0, 0);
    expect(cmd.boostHome(w, slot)).toBe(true);
  });

  it('a fight counts once a pack for each wingman who took it on nearby, a down for whose guns did it, so many a flight', () => {
    const a = wingman('a', [0, 0, 0], { react: 0 });
    const b = wingman('b', [0, 0, 0], { react: 0 });
    const far = wingman('far', [0, 9_000, 0], { react: 0 });
    const packs = [1, 1, 2, 3].map((p, i) => raider(`r${i}`, [400 + i, 0, 0], p));
    const npcs = [a, b, far, ...packs];
    const cmd = new WingCommand();
    const credit = (r: NpcShip, killer?: string) => {
      for (const x of npcs.filter((n) => n.wingman)) cmd.foeFor(x, view(npcs.filter((n) => n.durability.hull > 0 || n === r)));
      r.durability.hull = 0;
      return cmd.credit(r, killer, view(npcs));
    };
    expect(credit(packs[0]!, 'a')).toEqual([
      { crewId: 'a', fights: 1, downs: 1 },
      { crewId: 'b', fights: 1, downs: 0 },
    ]);
    // The same pack again: a down, no second fight.
    expect(credit(packs[1]!, 'a')).toEqual([{ crewId: 'a', fights: 0, downs: 1 }]);
    // A third down for 'a' is past the cap; a fight in a new pack is not.
    expect(credit(packs[2]!, 'a')).toEqual([
      { crewId: 'a', fights: 1, downs: 0 },
      { crewId: 'b', fights: 1, downs: 0 },
    ]);
    expect(credit(packs[3]!, 'b')).toEqual([{ crewId: 'b', fights: 0, downs: 1 }]);
    expect(cmd.earnings()).toEqual({ a: { fights: 2, downs: 2 }, b: { fights: 2, downs: 1 } });
  });
});

// ---------------------------------------------------------------- in flight

function installCanvasStub(): void {
  if ((globalThis as { document?: unknown }).document) return;
  const stub = (): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getImageData' || prop === 'createImageData') {
          return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h });
        }
        return stub();
      },
      apply() {
        return stub();
      },
      set() {
        return true;
      },
    });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => stub() }),
  };
}

const QUIET: TrafficPlan = { traders: 0, patrolWings: 0, wingSize: 2, packs: null };
const ONE_RAIDER = { ...QUIET, packs: { max: 1, level: 1 as const, size: [1, 1] as const, firstDelay: 1, interval: [999, 999] as const } };

type Inner = { npcs: NpcShip[]; damageNpc(n: unknown, amount: number, at: THREE.Vector3, type: undefined, byPlayer: boolean): void };

function wingFlight(systemId: SystemId, traffic: Partial<TrafficSetup>) {
  const scene = new SystemScene(sceneDefFor(systemId), { quality: 'low', reducedMotion: true });
  const state = createNewGame(11);
  state.location = { systemId, dockedAt: null, flight: null, lastDockId: state.location.lastDockId };
  const log: string[] = [];
  const comms: string[] = [];
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const nothing = () => {};
  const callbacks: FlightCallbacks = {
    onDocked: nothing,
    onPlayerDestroyed: nothing,
    onDiscovery: nothing,
    onScanInfo: nothing,
    onEncounterStart: nothing,
    onEncounterEnd: nothing,
    onLoot: nothing,
    onBounty: nothing,
    onContractKill: nothing,
    onWingmanLost: record('lost'),
    onWingHurt: record('hurt'),
    onWingFought: record('fought'),
    onComm: (speaker, text) => comms.push(`${speaker}: ${text}`),
    onMessage: (text) => log.push(text),
  };
  const flight = new FlightSession({
    system: scene,
    camera: new THREE.PerspectiveCamera(),
    state,
    settings: defaultSettings(),
    ctx: { quality: 'low', reducedMotion: true },
    audio: { play() {}, setCombatIntensity() {}, setEngine() {} } as unknown as AudioEngine,
    callbacks,
    traffic: { plan: QUIET, owner: null, ...traffic },
  });
  flight.start({ kind: 'arrival' });
  const inner = flight as unknown as Inner;
  const run = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += 1 / 20) {
      flight.update(1 / 20, emptyInput());
      if (until?.()) return true;
    }
    return false;
  };
  return { flight, inner, run, log, comms, calls };
}

describe('in flight', () => {
  beforeAll(installCanvasStub);

  it('launches each wingman at their grade; a veteran takes on a new foe sooner than a steady hand', () => {
    const reactIn = (grade: 1 | 4) => {
      const f = wingFlight('altair', { plan: ONE_RAIDER, crew: [{ id: 'w1', name: 'Maren Okoro', model: FIGHTER, skill: 'steady', grade }] });
      f.run(2);
      const w = f.inner.npcs.find((n) => n.wingman?.crewId)!;
      const r = f.inner.npcs.find((n) => n.side === 'raider')!;
      expect(w.wingman).toMatchObject(wingSkill(grade));
      f.flight.giveWingOrder('form');
      r.body.position.copy(f.flight.player.position).add(new THREE.Vector3(600, 0, 0));
      f.flight.giveWingOrder('free');
      let t = 0;
      while (!w.foe && t < 5) {
        f.run(0.05);
        t += 0.05;
      }
      return t;
    };
    const steady = reactIn(1);
    const veteran = reactIn(4);
    expect(steady).toBeGreaterThan(WING.skill.react[0] - 0.1);
    expect(steady).toBeLessThan(WING.skill.react[0] + 0.15);
    expect(veteran).toBeLessThan(WING.skill.react[3] + 0.15);
  });

  it('badly hit, a wingman says so and holds back; one launched hurt holds back from the start', () => {
    const f = wingFlight('altair', { plan: ONE_RAIDER, crew: [{ id: 'w1', name: 'Maren Okoro', model: FIGHTER, skill: 'sharp' }, { id: 'w2', name: 'Tobin Sato', model: FIGHTER, skill: 'steady', hurt: true }] });
    f.run(2);
    const [w1, w2] = f.inner.npcs.filter((n) => n.wingman?.crewId);
    const r = f.inner.npcs.find((n) => n.side === 'raider')!;
    r.body.position.copy(f.flight.player.position).add(new THREE.Vector3(600, 0, 0));
    f.run(2);
    expect(w1!.foe).toBe(r);
    expect(w2!.foe).toBeNull();
    expect(f.flight.hud.wing).toEqual({ count: 2, order: 'free', hurt: 1 });
    w1!.durability.shield = 0;
    w1!.durability.hull = w1!.durability.hullMax * (WING.hurt.hull - 0.05);
    f.run(0.1);
    expect(f.calls.hurt).toEqual([['w1']]);
    expect(f.comms).toContain(`Maren Okoro: ${WING_RADIO.hurt}`);
    expect(w1!.foe).toBeNull();
    expect(f.flight.hud.wing?.hurt).toBe(2);
  });

  it('held at a point, the wing stays behind as the pilot flies off, and comes back when the pilot is far', () => {
    const f = wingFlight('sol', { crew: [{ id: 'w1', name: 'Maren Okoro', model: FIGHTER, skill: 'sharp' }] });
    f.run(2);
    const w = f.inner.npcs.find((n) => n.wingman?.crewId)!;
    expect(f.flight.giveWingOrder('hold')).toEqual({ speaker: 'Maren Okoro', text: ORDER_WORDS.hold.ack });
    const point = new THREE.Vector3(...f.flight.wingStatus().hold!);
    // Far enough that an order at will would catch up.
    f.flight.player.position.add(new THREE.Vector3(WING.catchUp + 500, 0, 0));
    f.run(1);
    expect(w.body.position.distanceTo(point)).toBeLessThan(600);
    f.flight.player.position.add(new THREE.Vector3(WING.orders.release, 0, 0));
    f.run(0.5);
    expect(f.flight.wingStatus().order).toBe('form');
    expect(f.comms).toContain(`Maren Okoro: ${WING_RADIO.tooFar}`);
    expect(f.flight.wingCarry()).toBe('form');
  });

  it('covers the ship the pilot escorts, keeping station off it', () => {
    const [from, to] = ALL_LOCATIONS.filter((l) => l.systemId === 'tau-ceti' && l.status === 'functional' && l.dockable !== false);
    const f = wingFlight('tau-ceti', {
      crew: [{ id: 'w1', name: 'Maren Okoro', model: FIGHTER, skill: 'sharp' }],
      escorts: [{ jobId: 'c.test.0.0', from: from!.id, to: to!.id, model: 'ship.freighter.1.halden', name: 'Halden Petrel', level: 1 }],
    });
    expect(f.flight.wingOptions().find((o) => o.order === 'cover')?.lock).toBe(ORDER_LOCKS.noHauler);
    f.run(3);
    expect(f.flight.wingOptions().find((o) => o.order === 'cover')?.lock).toBeNull();
    expect(f.flight.giveWingOrder('cover')).toEqual({ speaker: 'Maren Okoro', text: 'Copy. Covering the Halden Petrel.' });
    const w = f.inner.npcs.find((n) => n.wingman?.crewId)!;
    const petrel = f.inner.npcs.find((n) => n.escort)!;
    f.run(20);
    expect(w.body.position.distanceTo(petrel.body.position)).toBeLessThan(WING.orders.ward.station * 3);
    expect(f.flight.wingStatus()).toMatchObject({ order: 'cover', ward: 'Halden Petrel' });
  });

  it('a raider downed earns the wing a fight and whose guns did it a down; a wingman shot down is picked up', () => {
    const f = wingFlight('altair', { plan: ONE_RAIDER, crew: [{ id: 'w1', name: 'Maren Okoro', model: FIGHTER, skill: 'sharp' }] });
    f.run(2);
    const w = f.inner.npcs.find((n) => n.wingman?.crewId)!;
    const r = f.inner.npcs.find((n) => n.side === 'raider')!;
    r.body.position.copy(f.flight.player.position).add(new THREE.Vector3(600, 0, 0));
    expect(f.run(3, () => w.foe === r)).toBe(true);
    r.lastHitBy = w.id;
    f.inner.damageNpc(r, 1e6, r.body.position.clone(), undefined, false);
    expect(f.calls.fought).toEqual([[[{ crewId: 'w1', fights: 1, downs: 1 }]]]);
    expect(f.flight.wingStatus().earned).toEqual({ w1: { fights: 1, downs: 1 } });
    f.inner.damageNpc(w, 1e6, w.body.position.clone(), undefined, false);
    expect(f.calls.lost).toEqual([['w1']]);
    expect(f.log).toContain(WING_RADIO.picked.replace('{name}', 'Maren Okoro'));
    f.run(0.1);
    expect(f.flight.hud.wing).toBeNull();
    expect(f.flight.giveWingOrder('form')).toBeNull();
  });
});
