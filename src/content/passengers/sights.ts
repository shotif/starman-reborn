import { BELTS, getComponent, getSystem, SYSTEMS } from '../../data/systems.ts';
import type { SystemId } from '../../data/types.ts';
import { GIANT_EARTH_MASSES, spectralClass } from '../world/generate.ts';
import type { SightField } from './lines.ts';
import type { SightKind } from './rules.ts';

/**
 * The real sky's sights for sightseers (docs/PROCGEN.md §23): every confirmed planet (a giant above
 * GIANT_EARTH_MASSES), every white dwarf and brown dwarf the archives list, and every belt or debris
 * disc a cited source reports. Nothing here is invented: each sight is a record of the catalogue,
 * and what a sightseer says of it is printed from that record's fields (`sightFacts`).
 */

export interface Sight {
  /** The body's or belt's own id. */
  id: string;
  kind: SightKind;
  systemId: SystemId;
  name: string;
  /** The star it is near (a planet's or belt's host; a dwarf is its own). */
  star: string;
  /** The flight scene's target for it (the HUD steers there). */
  targetId: string;
}

let sights: Sight[] | null = null;

export function allSights(): readonly Sight[] {
  sights ??= SYSTEMS.flatMap((s): Sight[] => [
    ...s.confirmedBodies
      .filter((p) => p.status === 'confirmed')
      .map((p) => ({
        id: p.id,
        kind: (p.massEarth?.value ?? 0) > GIANT_EARTH_MASSES ? ('giant' as const) : ('planet' as const),
        systemId: s.id,
        name: p.displayName,
        star: getComponent(p.hostId)?.name ?? s.displayName,
        targetId: `planet:${p.id}`,
      })),
    ...s.componentIds.flatMap((id) => {
      const c = getComponent(id);
      const cls = c ? spectralClass(c.spectralType) : '';
      const kind: SightKind | null = cls === 'D' ? 'white-dwarf' : ['L', 'T', 'Y'].includes(cls) ? 'brown-dwarf' : null;
      return c && kind ? [{ id, kind, systemId: s.id, name: c.name, star: c.name, targetId: `star:${id}` }] : [];
    }),
    ...BELTS.filter((b) => b.systemId === s.id).map((b) => ({
      id: b.id,
      kind: 'belt' as const,
      systemId: s.id,
      name: b.name,
      star: getComponent(b.hostId)?.name ?? s.displayName,
      targetId: `belt:${b.id}`,
    })),
  ]);
  return sights;
}

export function sightById(id: string): Sight | undefined {
  return allSights().find((s) => s.id === id);
}

const round = (x: number, places: number) => {
  const f = 10 ** places;
  return (Math.round(x * f) / f).toLocaleString('en-GB');
};

/** A planet's mass as a sightseer says it: "at least 1.07 times", when the archive gives a minimum mass. */
function massPhrase(value: number, qualifier: string | undefined): string {
  const n = round(value, value < 10 ? 2 : 0);
  return /minimum/i.test(qualifier ?? '') ? `at least ${n} times` : `${n} times`;
}

/** The fields of a sight's record a line can print: only those the archive has. */
export function sightFacts(s: Sight): Partial<Record<SightField, string>> {
  const out: Partial<Record<SightField, string>> = {};
  if (s.kind === 'planet' || s.kind === 'giant') {
    const p = getSystem(s.systemId).confirmedBodies.find((x) => x.id === s.id);
    if (!p) return out;
    if (p.orbitalPeriodDays) out.period = round(p.orbitalPeriodDays.value, p.orbitalPeriodDays.value < 10 ? 2 : 1);
    if (p.massEarth) out.mass = massPhrase(p.massEarth.value, p.massEarth.qualifier);
    if (p.semiMajorAxisAu) out.axis = round(p.semiMajorAxisAu.value, 3);
    if (p.radiusEarth) out.radius = `${round(p.radiusEarth.value, 2)} times`;
    if (p.discoveryYear) out.year = String(p.discoveryYear);
    if (p.discoveryMethod) out.method = p.discoveryMethod.toLowerCase();
  } else if (s.kind === 'belt') {
    const b = BELTS.find((x) => x.id === s.id);
    if (b?.sources[0]) out.source = b.sources[0].label;
  } else {
    const c = getComponent(s.id);
    if (c) {
      out.type = c.spectralType;
      out.distance = round(c.distanceLightYears, 1);
    }
  }
  return out;
}
