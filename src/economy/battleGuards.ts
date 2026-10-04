import type * as THREE from 'three';
import { DIFFICULTY } from '../app/settings.ts';
import { BATTLE_END, BATTLE_FICTION, BATTLE_NEWS, BATTLE_NOTES, BATTLE_OPEN, BATTLE_TITLES, BATTLE_VOICES, SIDE_SHORT } from '../content/border/battleLines.ts';
import { BATTLE_KINDS, BATTLES, type BattleRules } from '../content/border/battles.ts';
import { BORDER } from '../content/border/rules.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { DENS } from '../content/dens/rules.ts';
import type { Issue } from '../content/validate.ts';
import { getLocation, getSystem, SYSTEMS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { battleSite, beaconOf, FORM_UP } from '../world/battleSite.ts';
import { segmentDistance } from '../world/courses.ts';
import type { SystemSceneDef } from '../world/sceneTypes.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import { battlesDue, clashAt, lineToward, turningAt } from './battles.ts';
import { FRONTS, type Front } from './border.ts';

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

/** Where a battle point is too near something, in words (none when it is clear). */
function clearance(def: SystemSceneDef, p: THREE.Vector3, rules: BattleRules, ownStation: string | null): string[] {
  const C = rules.clear;
  const out: string[] = [];
  for (const b of [...def.planets.map((x) => ({ id: x.id, position: x.position, surface: x.radius })), ...def.stars.map((x) => ({ id: x.id, position: x.position, surface: x.radius * 1.3 }))]) {
    if (b.position.distanceTo(p) < b.surface + C.surface) out.push(`near ${b.id}`);
  }
  for (const s of def.stations) {
    const min = s.locationId === ownStation ? rules.turning.standOff - 1 : C.station;
    if (s.position.distanceTo(p) < min) out.push(`near ${s.locationId}`);
  }
  for (const l of def.lanes) if (segmentDistance(p, l.from, l.to) < C.lane) out.push(`on lane ${l.id}`);
  for (const belt of def.belts) {
    const radial = Math.hypot(p.x - belt.center.x, p.z - belt.center.z);
    if (radial > belt.innerRadius && radial < belt.outerRadius && Math.abs(p.y - belt.center.y) < belt.thickness / 2) out.push(`in belt ${belt.id}`);
  }
  return out;
}

/**
 * Guardrails for the border in sight (docs/PROCGEN.md §35): the rules in range; sizes that add at
 * most ten ships to a scene (seven on Low); a turning window of half an hour or more; purses below a
 * war contract's least pay, and deeds as the owner chose; every front's battle lines and turning
 * points clear of bodies, stations, lanes and belts, on the way from the beacon and clear of a den;
 * schedules the same every time, clashes on every front at war and turning battles once a turn of
 * the tide where a station can fall; and the words with no number, no he or she, no star, only their
 * fields and short enough for the strip.
 */
export function validateBattles(rules: BattleRules = BATTLES): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const C = rules.clash;
  const T = rules.turning;

  // The rules.
  if (!(C.slotSeconds >= 600 && C.slotSeconds <= 1_800 && C.opens > 0 && C.opens < C.slotSeconds / 4 && C.arrive > 0 && C.arrive <= 60)) report('rules', 'slot', 'slots outside 10–30 minutes, or a clash opening too late');
  if (!Object.values(C.chance).every((p) => p > 0 && p < 1)) report('rules', 'chance', 'a clash chance outside 0–1');
  if (!(C.lasts >= 120 && C.lasts <= C.slotSeconds / 2 && T.lasts >= C.lasts && T.lasts <= 900)) report('rules', 'lasts', 'a battle too short or too long');
  if (!(C.favour >= 20 && C.favour <= BORDER.tide.amplitude)) report('rules', 'favour', 'the tide’s favour out of range');
  const L = rules.line;
  if (!(L.share > 0.15 && L.share < 0.6 && L.min >= 2_000 && L.min < L.max && L.denClear >= DENS.alert + 1_000)) report('rules', 'line', 'the battle line out of range, or within a den’s alert');
  if (!(rules.leash > rules.reach && rules.leash >= FORM_UP + 1_000 && rules.reach >= 2_000)) report('rules', 'reach', 'battle ships reaching too short, or leashed before they meet');
  if (!(rules.aim >= 0.5 && rules.aim < DIFFICULTY.standard.enemyAccuracy)) report('rules', 'aim', 'battle ships aiming too poorly, or better than raiders at the pilot');
  if (!(T.brink >= 4 && T.brink <= 15 && T.standOff >= 1_000 && T.waves >= 1 && T.waves <= 3 && T.next >= 0 && T.next < T.wave)) report('rules', 'turning', 'a turning battle out of range');
  // Ships a battle adds to the scene, at most (every wave, both sides, the tide's extra).
  const clashShips = (n: number) => 2 * (n + 1);
  const turningShips = (wave: number, hold: number) => T.waves * wave + hold;
  if (clashShips(C.ships) > 10 || turningShips(T.wave, T.defenders) > 10) report('balance', 'ships', 'a battle adding more than ten ships');
  if (clashShips(C.low) > 7 || turningShips(T.waveLow, T.defendersLow) > 7 || C.low > C.ships || T.waveLow > T.wave || T.defendersLow > T.defenders) report('balance', 'low', 'a battle adding more than seven ships on Low');
  for (const [faction, level] of Object.entries(C.level)) if (!(level >= 1 && level <= 3 && T.level[faction as 'sta'] >= level)) report('rules', faction, 'a raider level out of range, or a turning battle’s below a clash’s');
  // A turning window of half an hour at the tide's fastest.
  const fastest = (BORDER.tide.amplitude * 2 * Math.PI) / BORDER.tide.periodSeconds;
  if (T.brink / fastest < 1_800) report('rules', 'window', 'a turning battle due for under half an hour');

  // Pay and weight.
  const W = CONTRACTS.reward.war;
  const leastWar = Math.min(W.base + W.perShip * 2, W.base + W.perRaider * 3 * 2);
  if (!(rules.purse.clash > 0 && rules.purse.clash < rules.purse.turning && rules.purse.turning < leastWar)) report('balance', 'purse', 'purses not rising, or as much as a war contract');
  if (!(rules.standing.clash > 0 && rules.standing.clash < rules.standing.turning && rules.standing.turning <= 10)) report('balance', 'standing', 'standing out of range');
  if (rules.deed.turning !== BORDER.deeds.warContract || Math.abs(rules.deed.clash - BORDER.deeds.warContract / 3) > 1e-9) report('balance', 'deed', 'deeds other than the owner chose (a turning battle a war contract’s, a clash a third)');
  if (!(rules.keep >= 3 && rules.keep <= 12 && rules.newsSeconds >= 1_800 && rules.newsSeconds <= 4 * 3_600)) report('rules', 'keep', 'battles kept too few, or the News too short or long');

  // Every front's battle points.
  if (rules === BATTLES) {
    for (const f of FRONTS) checkFront(f, rules, report);
  }

  // The words.
  const stars = SYSTEMS.map((s) => s.displayName.split(' ')[0]!).filter((w) => w.length > 3);
  const check = (subject: string, text: string, allowed: readonly string[], max = 140) => {
    if (/\d/.test(text)) report('lines', subject, `a number written into the line: “${text}”`);
    if (GENDERED.test(text)) report('lines', subject, `he or she in the line: “${text}”`);
    if (text.length > max) report('lines', subject, `${text.length} characters (at most ${max})`);
    for (const [, key] of text.matchAll(/\{(\w+)\}/g)) if (!allowed.includes(key!)) report('lines', subject, `{${key}} it cannot fill`);
    for (const s of stars) if (new RegExp(`\\b${s}\\b`).test(text)) report('lines', subject, `a star written into the line (${s})`);
  };
  for (const k of BATTLE_KINDS) {
    check(`title.${k}`, BATTLE_TITLES[k], k === 'clash' ? ['system'] : ['station'], 40);
    for (const side of ['law', 'wake'] as const) check(`open.${k}.${side}`, BATTLE_OPEN[k][side], ['station'], 90);
    for (const w of ['law', 'wake', 'draw'] as const) check(`end.${k}.${w}`, BATTLE_END[k][w], ['station'], 90);
  }
  for (const side of ['law', 'wake'] as const) {
    check(`voice.${side}`, BATTLE_VOICES[side], ['payer'], 30);
    check(`side.${side}`, SIDE_SHORT[side], [], 8);
  }
  const NOTE_FIELDS: Record<keyof typeof BATTLE_NOTES, readonly string[]> = { won: ['payer', 'purse'], moved: [], held: ['station'], freed: ['station'], fallen: ['station'], lost: [], drawn: [], noPart: [] };
  for (const [k, t] of Object.entries(BATTLE_NOTES)) check(`note.${k}`, t, NOTE_FIELDS[k as keyof typeof BATTLE_NOTES]);
  for (const [k, by] of Object.entries(BATTLE_NEWS)) for (const [side, n] of Object.entries(by)) for (const t of [n.headline, n.detail]) check(`news.${k}.${side}`, t, ['station']);
  if (/\d/.test(BATTLE_FICTION) || !BATTLE_FICTION.startsWith('Fiction:')) report('lines', 'fiction', 'the fiction line');
  return issues;
}

/** A front's battle lines in both its systems and its turning point, its schedule and its strip titles. */
function checkFront(f: Front, rules: BattleRules, report: (rule: string, subject: string, message: string) => void): void {
  for (const sys of [f.lawSystem, f.wakeSystem] as SystemId[]) {
    const def = sceneDefFor(sys);
    const lawSystem = sys === f.lawSystem;
    const toward = lineToward(f, sys);
    const site = battleSite(def, { kind: 'clash', toward, lawSystem, attacker: null });
    if (!site) {
      report('sites', `${f.id}:${sys}`, `no battle line toward ${toward}`);
      continue;
    }
    for (const p of clearance(def, site.at, rules, null)) report('sites', `${f.id}:${sys}`, `the battle line ${p}`);
    const beacon = beaconOf(def);
    const target = def.stations.find((s) => s.locationId === toward)!.position;
    const d = site.at.distanceTo(beacon);
    if (d < rules.line.min - 1 || d > rules.line.max + 1 || segmentDistance(site.at, beacon, target) > 1) report('sites', `${f.id}:${sys}`, 'the battle line off the way from the beacon');
    if (!lawSystem && site.at.distanceTo(target) < rules.line.denClear - 1) report('sites', `${f.id}:${sys}`, 'the battle line too near the den');
    const title = BATTLE_TITLES.clash.replace('{system}', getSystem(sys).displayName);
    if (title.length > 44) report('lines', `${f.id}:${sys}`, `the strip’s title too long (${title.length})`);
  }
  if (f.exposedId) {
    const def = sceneDefFor(f.lawSystem);
    for (const kind of ['assault', 'retake'] as const) {
      const site = battleSite(def, { kind, toward: f.exposedId, lawSystem: true, attacker: kind === 'assault' ? 'wake' : 'law' });
      if (!site) report('sites', f.id, `no ${kind} point`);
      else for (const p of clearance(def, site.at, rules, f.exposedId)) report('sites', f.id, `the ${kind} point ${p}`);
    }
    const title = BATTLE_TITLES.assault.replace('{station}', getLocation(f.exposedId).name);
    if (title.length > 44) report('lines', f.id, `the strip’s title too long (${title.length})`);
  }
  // Two turns of the tide: clashes in each system the front fights in, a turning battle of each kind once a turn where a station can fall.
  const H = 3_600;
  const S = rules.clash.slotSeconds;
  for (const sys of [f.lawSystem, f.wakeSystem] as SystemId[]) {
    let n = 0;
    for (let slot = 0; slot < (96 * H) / S; slot++) if (clashAt(sys, slot, false, null)?.frontId === f.id) n++;
    if (n < 20) report('schedule', `${f.id}:${sys}`, `${n} clashes in two turns of the tide`);
  }
  const windows: string[] = [];
  let last: string | null = null;
  for (let t = 0; t < 96 * H; t += 60) {
    const due = turningAt(f, t, null);
    const key = due ? `${due.kind}#${due.key}` : null;
    if (key && key !== last) windows.push(key);
    last = key;
  }
  const kinds = windows.map((w) => w.split('#')[0]);
  if (f.exposedId ? kinds.filter((k) => k === 'assault').length !== 2 || kinds.filter((k) => k === 'retake').length !== 2 || new Set(windows).size !== windows.length : windows.length) {
    report('schedule', f.id, `turning battles ${windows.join(', ') || 'none'} in two turns of the tide`);
  }
  // The same every time.
  const a = JSON.stringify(battlesDue(f.lawSystem, 30 * H, H, false, null));
  if (a !== JSON.stringify(battlesDue(f.lawSystem, 30 * H, H, false, null))) report('schedule', f.id, 'a schedule that changes between calls');
}
