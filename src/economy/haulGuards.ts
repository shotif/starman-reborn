import { COMMODITIES } from '../content/economy/goods.ts';
import { HAULER_NAMES, HAULS } from '../content/economy/hauls.ts';
import { EVENTS, STRANDED_NAMES } from '../content/events/rules.ts';
import type { Issue } from '../content/validate.ts';
import { ALL_LOCATIONS, getLocation, WORLD } from '../data/systems.ts';
import { FLEETS } from '../world/traffic/plan.ts';
import { eventsAt, stationEventById } from './events.ts';
import { haulSenders, reliefHauls, shipments, shipsOut, tradeHaul, type Haul } from './hauls.ts';
import { marketTables } from './markets.ts';

/**
 * Haul guardrails (docs/PROCGEN.md §21.5): every haul goes from an open station that makes its
 * cargo to another that takes it, within reach, along real lanes, on a timetable that adds up, in
 * a hauler of its owner's fleet; a shortage's relief comes from stations that make what it lacks,
 * and all of it arriving relieves it; a glut's shipments go out of the glut, in its time, and all of
 * them gone clear it; the rules and the names make sense.
 */
export function validateHauls(hauls: readonly Haul[] = sampleHauls()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const R = HAULS;

  // The rules.
  if (R.relief.hauls * R.relief.share < EVENTS.react.relief) report('rules', 'relief', 'all of a shortage’s relief arriving does not relieve it');
  if (R.shipOut.hauls * R.shipOut.share < EVENTS.react.relief) report('rules', 'shipOut', 'all of a glut’s shipments gone does not clear it');
  if (!(R.shipOut.dispatch[0] > 0 && R.shipOut.dispatch[1] >= R.shipOut.dispatch[0] && R.shipOut.dispatch[0] < EVENTS.stationDuration[0])) report('rules', 'shipOut', 'shipments that do not set off while a glut lasts');
  if (Object.values(R.raidLoss).some((p) => p < 0 || p > 1)) report('rules', 'raidLoss', 'a chance out of 0–1');
  if (Object.values(R.legs).some((s) => s <= 0) || R.slotSeconds <= 0) report('rules', 'legs', 'times must be positive');
  if (R.load.min < 1 || R.load.max < R.load.min) report('rules', 'load', 'a load out of order');
  const names = new Set(HAULER_NAMES);
  if (names.size !== HAULER_NAMES.length) report('names', 'haulers', 'a name twice');
  const stationWords = new Set(ALL_LOCATIONS.map((l) => l.name.split(' ')[0]!.toLowerCase()));
  for (const n of HAULER_NAMES) {
    if (stationWords.has(n.split(' ')[0]!.toLowerCase()) || STRANDED_NAMES.includes(n)) report('names', n, 'shares its name with a station or a stranded hauler');
  }

  const open = (id: string) => {
    const l = ALL_LOCATIONS.find((x) => x.id === id);
    return !!l && l.status === 'functional' && l.dockable !== false && l.stationType !== 'pirate-den';
  };
  for (const h of hauls) {
    const subject = h.id;
    const role = (at: string) => marketTables().get(at)?.entries.get(h.commodity)?.role;
    if (!open(h.from) || role(h.from) !== 'produce') report('places', subject, `${h.from} does not make ${h.commodity}`);
    if (!open(h.to) || h.to === h.from || !role(h.to) || role(h.to) === 'produce') report('places', subject, `${h.to} does not take ${h.commodity}`);
    if (COMMODITIES[h.commodity].category === 'contraband') report('cargo', subject, 'contraband on the timetable');
    const reach = h.kind === 'relief' ? R.relief.maxJumps : R.maxJumps;
    if (h.path[0] !== getLocation(h.from).systemId || h.path.at(-1) !== getLocation(h.to).systemId || h.path.length - 1 > reach) report('way', subject, 'its way does not join its ends within reach');
    for (let i = 1; i < h.path.length; i++) if (!WORLD.links.get(h.path[i - 1]!)?.includes(h.path[i]!)) report('way', subject, `no lane ${h.path[i - 1]}–${h.path[i]}`);
    // The timetable adds up: legs in order, through the systems of its way, as long as the rules say.
    const legs = h.legs;
    if (legs[0]?.start !== h.depart || legs.at(-1)?.end !== h.arrive || legs.length !== h.path.length) report('timetable', subject, 'legs do not span the haul');
    legs.forEach((l, i) => {
      if (l.systemId !== h.path[i] || l.end <= l.start) report('timetable', subject, `leg ${i} out of place`);
      const length = l.kind === 'local' ? R.legs.local : l.kind === 'transit' ? R.legs.transit : R.legs.dock;
      if (Math.abs(l.end - l.start - length) > 1e-6) report('timetable', subject, `leg ${i} is not as long as the rules say`);
      if (i > 0 && Math.abs(l.start - legs[i - 1]!.end - EVENTS.jumpSeconds) > 1e-6) report('timetable', subject, `the jump before leg ${i} is not as long as a jump`);
    });
    if (h.kind === 'trade' && (h.qty < R.load.min || h.qty > R.load.max)) report('cargo', subject, `${h.qty} units out of bounds`);
    if (h.kind !== 'trade' && h.qty < R.load.min) report('cargo', subject, `${h.qty} units: too few to send`);
    // A shipment goes out of a glut (or harvest) of its cargo at its sender, while the glut was due to last.
    if (h.kind === 'shipment') {
      const e = h.glut ? stationEventById(h.glut) : null;
      if (!e || !shipsOut(e) || e.locationId !== h.from || e.goods[0] !== h.commodity) report('shipment', subject, 'not out of a glut of its cargo at its sender');
      else if (h.depart < e.start + R.shipOut.dispatch[0] || h.depart > e.start + R.shipOut.dispatch[1] || h.depart >= e.end) report('shipment', subject, 'sets off outside its time');
    }
    if (!names.has(h.name)) report('names', subject, `${h.name} is not a hauler’s name`);
    const fleet = FLEETS[h.faction].traders.length ? FLEETS[h.faction].traders : FLEETS.independent.traders;
    if (!fleet.includes(h.model)) report('ships', subject, `${h.model} is not a hauler of its owner’s fleet`);
  }
  return issues;
}

/** Hauls to check: every station's over a day (every third slot), and the relief and shipments of the events under way each hour. */
export function sampleHauls(hours = 24): Haul[] {
  const out: Haul[] = [];
  const slots = (hours * 3_600) / HAULS.slotSeconds;
  for (const s of haulSenders()) {
    for (let slot = 0; slot < slots; slot += 3) {
      const h = tradeHaul(s.id, slot);
      if (h) out.push(h);
    }
  }
  const seen = new Set<string>();
  for (let clock = 0; clock < hours * 3_600; clock += 3_600) {
    for (const e of eventsAt(clock)) {
      if ((e.kind !== 'shortage' && !shipsOut(e)) || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(...(e.kind === 'shortage' ? reliefHauls(e) : shipments(e)));
    }
  }
  return out;
}
