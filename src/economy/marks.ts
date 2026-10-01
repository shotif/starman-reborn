import { BORDER } from '../content/border/rules.ts';
import { CONTRACTS } from '../content/contracts/rules.ts';
import { COMMODITIES, type CommodityId } from '../content/economy/goods.ts';
import { LASTING_MARKS, type LastingMark } from '../content/story/marks.ts';
import { jumpsFrom } from '../content/world/network.ts';
import { ALL_LOCATIONS, getSystem, isFrontier, WORLD } from '../data/systems.ts';
import type { FictionalLocation } from '../data/types.ts';
import { EXPOSED, FRONTS, type Front } from './border.ts';
import { marketTables } from './markets.ts';

/**
 * Every lasting mark (docs/PROCGEN.md §14.7): the stories' own (content/story/marks.ts), and those
 * a border front settled for good leaves on the stations around it (§20.7), made from the fronts,
 * their stations and their markets by the rules in BORDER.settled. Built on first use.
 */

const CONTRABAND: ReadonlySet<CommodityId> = new Set(
  (Object.keys(COMMODITIES) as CommodityId[]).filter((c) => COMMODITIES[c].category === 'contraband'),
);

function list(goods: readonly CommodityId[]): string {
  const names = goods.map((c) => COMMODITIES[c].name.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
}

const isOpen = (l: FictionalLocation) => l.status === 'functional' && l.dockable !== false;
const postsBoard = (l: FictionalLocation) => isOpen(l) && l.services.includes('contracts') && l.stationType !== 'pirate-den';

/**
 * Where a run of `commodity` from `from` can go: the nearest open station that takes it, within
 * freight reach and clear of the fronts, and not out in the frontier unless the run starts there
 * (as no board outside the frontier sends a pilot into it, economy/contracts.ts).
 */
function runTo(from: FictionalLocation, commodity: CommodityId, avoid: ReadonlySet<string>): FictionalLocation | null {
  const jumps = jumpsFrom(WORLD.links, from.systemId);
  const tables = marketTables();
  const options = ALL_LOCATIONS.filter((l) => {
    if (l.id === from.id || !isOpen(l) || l.stationType === 'pirate-den' || EXPOSED.has(l.id) || avoid.has(l.systemId)) return false;
    if (isFrontier(l.systemId) && !isFrontier(from.systemId)) return false;
    if ((jumps.get(l.systemId) ?? Infinity) > CONTRACTS.maxJumps.freight) return false;
    const e = tables.get(l.id)?.entries.get(commodity);
    return !!e && e.role !== 'produce';
  });
  options.sort((a, b) => (jumps.get(a.systemId) ?? 0) - (jumps.get(b.systemId) ?? 0) || (a.id < b.id ? -1 : 1));
  return options[0] ?? null;
}

function frontMarks(): LastingMark[] {
  const out: LastingMark[] = [];
  const tables = marketTables();
  const denSystems = new Set(FRONTS.map((f) => f.wakeSystem));
  const sides = [...new Set(FRONTS.flatMap((f) => [f.lawSystem, f.wakeSystem]))].sort();
  for (const sys of sides) {
    const fronts = FRONTS.filter((f) => f.lawSystem === sys || f.wakeSystem === sys);
    const ids = fronts.map((f) => f.id);
    const lawful = fronts.filter((f) => f.lawSystem === sys);
    const where = [...new Set(fronts.map((f) => getSystem(f.lawSystem).displayName))].join(' and ');
    const stations = ALL_LOCATIONS.filter(
      (l) => l.systemId === sys && isOpen(l) && l.stationType !== 'pirate-den' && tables.has(l.id) && (!l.factionId || fronts.some((f) => f.faction === l.factionId)),
    ).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const s of stations) {
      const entries = [...tables.get(s.id)!.entries.values()];
      // The law holds the line: lanes on both sides are safe, and the stations ship more (a relay trades more).
      const r = BORDER.settled.law;
      const made = entries.filter((e) => e.role === 'produce' && !CONTRABAND.has(e.commodity)).map((e) => e.commodity);
      const traded = entries.filter((e) => e.role === 'trade' && !CONTRABAND.has(e.commodity)).map((e) => e.commodity);
      const goods = (made.length ? made : traded).slice(0, r.goods);
      if (goods.length) {
        const good = made[0];
        const to = good && postsBoard(s) ? runTo(s, good, denSystems) : null;
        out.push({
          id: `front.law.${s.id}`,
          locationId: s.id,
          headline: `Safe lanes at ${s.name}`,
          detail: `With the Hollow Wake driven back from ${where} for good, ${s.name} ${made.length ? 'ships more of what it makes' : 'has more of what it trades'}: ${list(goods)} are plentiful there.`,
          market: { goods, price: r.price, stock: r.stock },
          ...(good && to
            ? {
                run: {
                  commodity: good,
                  to: to.id,
                  title: 'Reopened lanes',
                  why: `The lanes around ${getSystem(sys).displayName} are safe again, and ${s.name} sends its ${COMMODITIES[good].name.toLowerCase()} out by contract.`,
                  premium: r.premium,
                },
              }
            : {}),
          front: { ids, ending: 'law' },
        });
      }
      // The Wake holds the lanes: what a lawful station needs comes rarely (one that falls is the Wake's to run).
      const w = BORDER.settled.wake;
      const needs = entries.filter((e) => e.role === 'consume' && !CONTRABAND.has(e.commodity)).map((e) => e.commodity).slice(0, w.goods);
      const held = lawful.filter((f) => f.faction === s.factionId);
      if (held.length && needs.length && !EXPOSED.has(s.id)) {
        out.push({
          id: `front.wake.${s.id}`,
          locationId: s.id,
          headline: `${s.name} under the Wake's shadow`,
          detail: `The Hollow Wake holds the lanes into ${getSystem(sys).displayName} for good: supplies reach ${s.name} rarely, and it pays more for ${list(needs)}.`,
          market: { goods: needs, price: w.scarcePrice, stock: w.scarceStock },
          front: { ids: held.map((f) => f.id), ending: 'wake' },
        });
      }
    }
  }
  // The den across each line does well out of it: its own trade booms.
  for (const denId of [...new Set(FRONTS.map((f) => f.denId))].sort()) {
    const fronts = FRONTS.filter((f: Front) => f.denId === denId);
    const den = ALL_LOCATIONS.find((l) => l.id === denId)!;
    const w = BORDER.settled.wake;
    const wares = [...(tables.get(den.id)?.entries.values() ?? [])].filter((e) => e.role === 'produce').map((e) => e.commodity).slice(0, w.goods);
    if (!wares.length) continue;
    const law = fronts.map((f) => getSystem(f.lawSystem).displayName).join(' and ');
    out.push({
      id: `front.wake.${den.id}`,
      locationId: den.id,
      headline: `Boom times at ${den.name}`,
      detail: `With the lanes into ${law} the Wake's for good, ${den.name}'s trade booms: its ${list(wares)} are cheap and plentiful there.`,
      market: { goods: wares, price: w.plunderPrice, stock: w.plunderStock },
      front: { ids: fronts.map((f) => f.id), ending: 'wake' },
    });
  }
  return out;
}

let all: readonly LastingMark[] | null = null;
let byId: Map<string, LastingMark> | null = null;

/** Every lasting mark, the stories' and the fronts'. */
export function allMarks(): readonly LastingMark[] {
  all ??= [...LASTING_MARKS, ...frontMarks()];
  return all;
}

export function markById(id: string): LastingMark | undefined {
  byId ??= new Map(allMarks().map((m) => [m.id, m]));
  return byId.get(id);
}

/** The marks a front leaves when it is settled with an ending (none for a truce). */
export function marksForFront(frontId: string, ending: 'law' | 'wake' | 'truce'): LastingMark[] {
  return allMarks().filter((m) => m.front?.ending === ending && m.front.ids.includes(frontId));
}
