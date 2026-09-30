import { describe, expect, it } from 'vitest';
import { gearForSale } from '../../src/content/catalog.ts';
import { GROWTH } from '../../src/content/world/rules.ts';
import { ALL_LOCATIONS, getLocation, isFrontier, isNewSystem, laneNeedsDrive, SYSTEMS, WORLD } from '../../src/data/systems.ts';
import { boardFor } from '../../src/economy/contracts.ts';
import { evaluateJump, laneTaker } from '../../src/galaxy/jumpRules.ts';
import { findRoute } from '../../src/galaxy/routing.ts';

/** The frontier (docs/PROCGEN.md §7.6): new systems beyond 17.5 ly, reached by a long-range jump drive. */

const frontier = SYSTEMS.filter((s) => isFrontier(s.id));
const ready = { canJump: true, reason: null };

describe('the frontier', () => {
  it('is the far shell of new systems, and every lane into it needs the drive', () => {
    expect(frontier.length).toBeGreaterThan(50);
    for (const s of frontier) {
      expect(isNewSystem(s.id)).toBe(true);
      expect(s.distanceLightYears).toBeGreaterThan(GROWTH.frontierLy - 0.5);
      for (const to of WORLD.links.get(s.id) ?? []) expect(laneNeedsDrive(s.id, to)).toBe(true);
    }
    expect(laneNeedsDrive('sol', 'alpha-centauri')).toBe(false);
  });

  it('turns a pilot without a drive away, and lets one with a drive in', () => {
    const target = frontier.find((s) => s.confirmedBodies.length > 0)!;
    const base = { currentSystemId: 'sol', credits: 1e6, readiness: ready, feeCoverage: null };
    const without = evaluateJump({ ...base, jumpReach: 0 }, target.id);
    expect(without.canJump).toBe(false);
    expect(without.reasons.join(' ')).toMatch(/long-range jump drive/);
    const withDrive = evaluateJump({ ...base, jumpReach: 12.4 }, target.id);
    expect(withDrive.canJump).toBe(true);
    expect(withDrive.route!.hops.some((h) => laneNeedsDrive(h.from, h.to))).toBe(true);
    // A short drive is told how far the lane is.
    const longest = Math.max(...withDrive.route!.hops.filter((h) => laneNeedsDrive(h.from, h.to)).map((h) => h.distanceLy));
    const short = evaluateJump({ ...base, jumpReach: Math.floor(longest * 10) / 10 - 0.1 }, target.id);
    if (!short.canJump) expect(short.reasons.join(' ')).toMatch(/beyond your drive/);
  });

  it('keeps the whole neighbourhood outside the frontier reachable without a drive', () => {
    const noDrive = laneTaker(0);
    for (const s of SYSTEMS.filter((x) => !isFrontier(x.id))) expect(findRoute(SYSTEMS, 'sol', s.id, { canTake: noDrive }), s.id).not.toBeNull();
    for (const s of frontier) expect(findRoute(SYSTEMS, 'sol', s.id, { canTake: laneTaker(12.4) }), s.id).not.toBeNull();
  });

  it('sells long-range drives where a pilot without one can buy one', () => {
    const noDrive = laneTaker(0);
    const shops = ALL_LOCATIONS.filter((l) => !isFrontier(l.systemId) && gearForSale(l.id).some((g) => g.family === 'jump-drive'));
    expect(shops.length).toBeGreaterThan(0);
    expect(shops.some((l) => findRoute(SYSTEMS, 'sol', l.systemId, { canTake: noDrive }))).toBe(true);
  });

  it('never has a board outside the frontier send a pilot into it; frontier boards have work', () => {
    const outside = ALL_LOCATIONS.filter((l) => !isFrontier(l.systemId) && l.status === 'functional').slice(0, 60);
    for (const l of outside) {
      for (let epoch = 0; epoch < 6; epoch++) {
        for (const c of boardFor(l.id, epoch)) {
          const places = [c.destinationLocationId, ...c.objectives.flatMap((o) => ('locationId' in o && o.locationId ? [o.locationId] : []))].filter((x): x is string => !!x);
          for (const p of places) expect(isFrontier(getLocation(p).systemId), `${c.id} → ${p}`).toBe(false);
          for (const o of c.objectives) if ('systemId' in o && o.systemId) expect(isFrontier(o.systemId), `${c.id} → ${o.systemId}`).toBe(false);
        }
      }
    }
    const inside = ALL_LOCATIONS.filter((l) => isFrontier(l.systemId) && l.status === 'functional' && l.services.includes('contracts'));
    expect(inside.some((l) => boardFor(l.id, 3).length > 0)).toBe(true);
  });
});
