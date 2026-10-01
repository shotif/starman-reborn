import { describe, expect, it } from 'vitest';
import { SYSTEMS, getSystem } from '../../src/data/systems.ts';
import { missionSystems } from '../../src/galaxy/mapDialogs.ts';
import { buildSearchIndex, normalizeName, prefixDistance, searchSystems } from '../../src/galaxy/mapSearch.ts';
import type { MapMission } from '../../src/galaxy/types.ts';

describe('finding a system by name', () => {
  const first = (q: string) => searchSystems(q)[0];

  it('ignores case, accents and punctuation, and spells out Greek letters', () => {
    expect(normalizeName('Barnard’s Star')).toBe('barnards star');
    expect(normalizeName("Luyten's Star")).toBe('luytens star');
    expect(normalizeName('Xi Boötis')).toBe('xi bootis');
    expect(normalizeName('SCR 1845−6357')).toBe('scr 1845 6357');
    expect(normalizeName('ε Eridani')).toBe('epsilon eridani');
    expect(normalizeName('  LP 816-60 ')).toBe('lp 816 60');
  });

  it('measures a typo against the nearest start of a word', () => {
    expect(prefixDistance('prox', 'proxima')).toBe(0);
    expect(prefixDistance('proxma', 'proxima')).toBe(1);
    expect(prefixDistance('centuari', 'centauri')).toBe(1);
    expect(prefixDistance('xyz', 'proxima')).toBe(3);
  });

  it('finds a system by its own name, or a star, planet, station, belt or catalogue name in it', () => {
    expect(first('alpha')).toMatchObject({ systemId: 'alpha-centauri', kind: 'system' });
    expect(first('proxima')).toMatchObject({ systemId: 'alpha-centauri', kind: 'star', name: 'Proxima Centauri' });
    // The shown planet name before the archive's ("Proxima Cen b").
    expect(first('proxima b')).toMatchObject({ systemId: 'alpha-centauri', kind: 'planet', name: 'Proxima Centauri b' });
    expect(first('earth')).toMatchObject({ systemId: 'sol', kind: 'planet' });
    expect(first('halcyon')).toMatchObject({ systemId: 'sol', kind: 'station', name: 'Halcyon Ring' });
    expect(first('kuiper')).toMatchObject({ systemId: 'sol', kind: 'belt' });
    // Typed exactly as SIMBAD writes it: shown as the system's other name.
    expect(first('eps eri')).toMatchObject({ systemId: 'epsilon-eridani', kind: 'catalogue', name: 'eps Eri' });
    expect(first('epsilon eri')).toMatchObject({ systemId: 'epsilon-eridani', kind: 'system' });
    expect(first('gl 406')).toMatchObject({ systemId: 'wolf-359', kind: 'catalogue' });
    expect(first('hip 87937')?.systemId).toBe('barnard');
    // Gliese numbers in all three spellings.
    expect(first('gliese 876')?.systemId).toBe('gliese-876');
    expect(first('gj 876')?.systemId).toBe('gliese-876');
    expect(first('gliese 1061')?.systemId).toBe('gj-1061');
  });

  it('forgives typos only when nothing matches as typed', () => {
    expect(first('sirus')?.systemId).toBe('sirius');
    expect(first('barnrd')?.systemId).toBe('barnard');
    expect(first('centuari')?.systemId).toBe('alpha-centauri');
    expect(searchSystems('zzqx')).toEqual([]);
    expect(searchSystems('')).toEqual([]);
    expect(searchSystems('  ,. ')).toEqual([]);
  });

  it('lists each system once: systems so named first, nearest first among equals', () => {
    const hits = searchSystems('star', { limit: 60 });
    expect(new Set(hits.map((h) => h.systemId)).size).toBe(hits.length);
    expect(hits.slice(0, 5).every((h) => h.kind === 'system')).toBe(true);
    expect(hits[0]?.systemId).toBe('barnard');
    const ly = (id: string) => Math.hypot(...getSystem(id).positionLy);
    const ross = searchSystems('ross')
      .filter((h) => h.kind === 'system')
      .map((h) => ly(h.systemId));
    expect(ross.length).toBeGreaterThan(5);
    for (let i = 1; i < ross.length; i++) expect(ross[i]).toBeGreaterThanOrEqual(ross[i - 1]!);
    // Nearest to where you are, when asked.
    const fromRoss128 = searchSystems('ross', { near: 'ross-128' });
    expect(fromRoss128[0]?.systemId).toBe('ross-128');
    expect(searchSystems('ross', { limit: 3 })).toHaveLength(3);
  });

  it('matches one letter only at the start of a word', () => {
    const hits = searchSystems('x');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(normalizeName(h.name)).toMatch(/(^| )x/);
  });

  it('marks the matched part of the name as written, accents and all', () => {
    const boot = first('boot')!;
    expect(boot.systemId).toBe('xi-bootis');
    expect(boot.name.slice(...boot.range!)).toBe('Boöt');
    const scr = first('1845-6357')!;
    expect(scr.name.slice(...scr.range!)).toBe('1845−6357');
    const barnard = first("barnard's")!;
    expect(barnard.name.slice(...barnard.range!)).toBe('Barnard’s');
  });

  it('indexes every system on the map', () => {
    const index = buildSearchIndex();
    for (const s of SYSTEMS) expect(index.some((e) => e.systemId === s.id && e.kind === 'system')).toBe(true);
  });
});

describe('the missions list', () => {
  const m = (jobId: string, systemId: string, primary = false): MapMission => ({ jobId, systemId, title: jobId, step: `go to ${systemId}`, primary });

  it('groups missions by system: the tracked one first, then the fewest jumps, unreachable last', () => {
    const groups = missionSystems({
      currentSystemId: 'sol',
      jumpReach: 0,
      missions: [m('a', 'ross-128'), m('b', 'barnard'), m('c', 'scr-0740-4257'), m('d', 'sirius', true), m('e', 'barnard'), m('f', 'sol')],
    });
    expect(groups.map((g) => g.systemId)).toEqual(['sirius', 'sol', 'barnard', 'ross-128', 'scr-0740-4257']);
    expect(groups.map((g) => g.jumps)).toEqual([1, 0, 1, 2, null]);
    expect(groups[0]!.primary).toBe(true);
    expect(groups[2]!.missions.map((x) => x.jobId)).toEqual(['b', 'e']);
    expect(missionSystems({ currentSystemId: 'sol', missions: [] })).toEqual([]);
  });
});
