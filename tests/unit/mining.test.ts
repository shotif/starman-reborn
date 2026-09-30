import { describe, expect, it } from 'vitest';
import { BELTS, beltsOf, componentsOf, findBelt, getSystem, SYSTEMS } from '../../src/data/systems.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';

/**
 * Mining in the real belts (docs/PROCGEN.md §19): belts only where a cited source reports one, rocks
 * and what they yield, the mining laser and the prospecting scanner, the hold then pods, prices in
 * their bands, what a miner earns against a hauler, claim contracts and the raiders who hunt miners.
 */

/** A game date for Sol's real-date layout (2026). */
const JD = 2_461_000;

describe('belts in the real sky (the citation guardrail)', () => {
  it('every belt record belongs to a system of the game, circles one of its stars and cites a source', () => {
    expect(BELTS.length).toBeGreaterThanOrEqual(9);
    for (const b of BELTS) {
      const system = getSystem(b.systemId);
      const stars = b.systemId === 'sol' ? ['sun'] : [...system.componentIds, ...componentsOf(b.systemId).map((c) => c.id)];
      expect(stars, b.id).toContain(b.hostId);
      expect(b.sources.length, b.id).toBeGreaterThan(0);
      for (const s of b.sources) expect(s.url, b.id).toMatch(/^https:\/\//);
      expect(b.name.trim() && b.note.trim(), b.id).toBeTruthy();
      // Extents only where the source gives them: the Solar System's, from NASA.
      if (b.innerAu !== undefined || b.outerAu !== undefined) expect(b.systemId).toBe('sol');
    }
    expect(BELTS.map((b) => b.id)).toEqual(expect.arrayContaining(['sol-main-belt', 'sol-kuiper-belt', 'epsilon-eridani-debris-disc', 'alpha-centauri-debris-disc', 'tau-ceti-debris-disc']));
  });

  it('draws rings only for belt records, and every belt record in its own system', () => {
    let rings = 0;
    for (const s of SYSTEMS) {
      const def = sceneDefFor(s.id, s.id === 'sol' ? JD : null);
      for (const ring of def.belts) {
        rings++;
        const belt = findBelt(ring.beltId);
        expect(belt, `${s.id}: ${ring.id}`).toBeDefined();
        expect(belt!.systemId, ring.id).toBe(s.id);
        expect(ring.outerRadius).toBeGreaterThan(ring.innerRadius);
      }
      const drawn = new Set(def.belts.map((r) => r.beltId));
      for (const b of beltsOf(s.id)) expect(drawn.has(b.id), `${b.id} is not drawn`).toBe(true);
      // No belt without a citation: systems without a record have no rings.
      if (!beltsOf(s.id).length) expect(def.belts, s.id).toEqual([]);
    }
    expect(rings).toBeGreaterThanOrEqual(BELTS.length);
  });

  it('puts Sol’s main belt between Mars and Jupiter and the Kuiper Belt beyond Neptune, on any date', () => {
    for (const jd of [null, JD, 2_451_545]) {
      const def = sceneDefFor('sol', jd);
      const orbit = (id: string) => def.planets.find((p) => p.id === id)!.position.length();
      const main = def.belts.find((b) => b.beltId === 'sol-main-belt')!;
      const kuiper = def.belts.find((b) => b.beltId === 'sol-kuiper-belt')!;
      expect(main.innerRadius).toBeGreaterThan(orbit('mars') + 900);
      expect(main.outerRadius).toBeLessThan(orbit('jupiter') - 5_200);
      expect(kuiper.innerRadius).toBeGreaterThan(orbit('neptune') + 2_300);
      // Stations and the arrival point stay clear of the rocks.
      for (const p of [...def.stations.map((st) => st.position), def.arrival.position]) {
        const r = Math.hypot(p.x, p.z);
        expect(r < main.innerRadius || r > main.outerRadius).toBe(true);
      }
    }
  });

  it('keeps stations and arrival points out of the rings (the Eridani Mining Hub sits in its belt by design)', () => {
    for (const b of BELTS.filter((x) => x.systemId !== 'epsilon-eridani')) {
      const def = sceneDefFor(b.systemId, b.systemId === 'sol' ? JD : null);
      for (const ring of def.belts.filter((r) => r.beltId === b.id)) {
        const radial = (p: { x: number; z: number }) => Math.hypot(p.x - ring.center.x, p.z - ring.center.z);
        for (const p of [...def.stations.map((st) => st.position), def.arrival.position]) {
          const r = radial(p);
          expect(r < ring.innerRadius - 500 || r > ring.outerRadius + 500, `${ring.id}: ${Math.round(r)}`).toBe(true);
        }
      }
    }
  });
});
