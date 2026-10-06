import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { dockAt } from '../../src/app/rules.ts';
import { assertValidState } from '../../src/app/save/migrate.ts';
import { createNewGame, markVisited, type GameState } from '../../src/app/state.ts';
import { CONTRACTS } from '../../src/content/contracts/rules.ts';
import { COMET_LINES, COMETS } from '../../src/content/stellar/comets.ts';
import { COMET_DATA, COMET_EPOCH_JD, cometAt, cometMagnitude, cometOf, perihelia } from '../../src/data/comets.ts';
import { julianDate } from '../../src/data/solar.ts';
import { ALL_LOCATIONS, getLocation } from '../../src/data/systems.ts';
import type { SystemId } from '../../src/data/types.ts';
import { dateText } from '../../src/economy/binaries.ts';
import { activity, cometFacts, cometNews, hearsOfComets, imageOffer, imageReward, imagingJumps, perihelionText, sightOf } from '../../src/economy/comets.ts';
import { COMET_TOLERANCE, cometMisses, validateCometRules, type CometRules } from '../../src/economy/cometGuards.ts';
import { boardFor, postedContracts } from '../../src/economy/contracts.ts';
import { contractIssues } from '../../src/economy/contractGuards.ts';
import { useWorldLog } from '../../src/economy/events.ts';
import { acceptJob, advanceJobs, describeObjective } from '../../src/economy/jobs.ts';
import { recordObservation } from '../../src/economy/stellar.ts';
import { sceneDefFor } from '../../src/world/systems/index.ts';
import { compressedSolDistance, eclipticToScene } from '../../src/world/systems/sol.ts';

/**
 * Comets in Sol (docs/PROCGEN.md §45): JPL's comets, their guardrails, the reckoning of where each
 * stands (against Horizons' own positions), the comets in flight on the game's date, what is said
 * of them, the News of one near the Sun, and the imaging research stations near Sol post.
 */

afterEach(() => useWorldLog(null));

const halley = cometOf('comet-1p')!;
const encke = cometOf('comet-2p')!;
const jdOf = (iso: string) => julianDate(Date.parse(`${iso}T00:00:00Z`));

function pilotAt(locationId: string, clock: number): GameState {
  const s = createNewGame(9);
  s.jobs.lifeline = { status: 'complete', objectiveIndex: 4, acceptedAt: 0, completedAt: 1 };
  s.flags.clearance = true;
  s.credits = 10_000;
  s.clock = clock;
  const loc = getLocation(locationId);
  s.location = { systemId: loc.systemId, dockedAt: locationId, flight: null, lastDockId: locationId };
  markVisited(s, loc.systemId, locationId);
  useWorldLog(s.world);
  return s;
}

describe('the comets', () => {
  it('are JPL’s fourteen, with Horizons’ elements on the snapshot’s day and the Small-Body Database’s sizes', () => {
    expect(COMET_DATA.comets.map((c) => c.designation)).toEqual(['1P', '2P', '9P', '12P', '13P', '19P', '21P', '29P', '46P', '55P', '67P', '81P', '103P', '109P']);
    expect(COMET_EPOCH_JD).toBe(jdOf(COMET_DATA.retrieved));
    // The raw records, as fetched, give Halley's name, size and elements.
    const dir = `data/snapshot/orbits/${COMET_DATA.retrieved}`;
    const sbdb = JSON.parse(readFileSync(`${dir}/jpl-sbdb-1P.json`, 'utf8')) as { object: { fullname: string }; phys_par: { name: string; value: string }[] };
    expect(halley.name).toBe(sbdb.object.fullname);
    expect(halley.diameterKm).toBe(Number(sbdb.phys_par.find((p) => p.name === 'diameter')!.value));
    const horizons = (JSON.parse(readFileSync(`${dir}/jpl-horizons-elements-1P.json`, 'utf8')) as { result: string }).result;
    const row = horizons.slice(horizons.indexOf('$$SOE') + 5).trim().split('\n')[0]!.split(',').map((x) => x.trim());
    expect(Number(row[0])).toBe(COMET_EPOCH_JD);
    expect(halley.elements.e).toBe(Number(row[2]));
    expect(halley.elements.qAu).toBe(Number(row[3]));
    expect(halley.elements.inclinationDeg).toBe(Number(row[4]));
    expect(halley.orbitClass).toBe('Halley-type comet');
    expect(encke.orbitClass).toBe('Encke-type comet');
  });

  it('pass their guardrails', () => {
    expect(validateCometRules()).toEqual([]);
  });

  it('catch broken ones: an orbit not bound, a period that disagrees, elements that miss Horizons, pay above the ceiling, a line with a number', () => {
    const comet = (change: Partial<typeof encke.elements>) => validateCometRules([{ ...encke, elements: { ...encke.elements, ...change } }]).map((i) => i.rule);
    expect(comet({ e: 1.2 })).toContain('elements');
    expect(comet({ periodDays: encke.elements.periodDays * 1.1 })).toContain('elements');
    expect(comet({ nodeDeg: encke.elements.nodeDeg + 20 })).toContain('ephemeris');
    const rules = (change: (r: { image: { odds: number; reward: number } }) => void) => {
      const r = structuredClone(COMETS) as unknown as { image: { odds: number; reward: number } };
      change(r);
      return validateCometRules(COMET_DATA.comets.slice(0, 1), r as unknown as CometRules).map((i) => i.rule);
    };
    expect(rules((r) => (r.image.reward = 5_000))).toContain('image');
    expect(rules((r) => (r.image.odds = 1))).toContain('image');
    const lines = COMET_LINES as unknown as { headline: string };
    const was = lines.headline;
    try {
      lines.headline = '{comet} comes round once every 76 years.';
      expect(validateCometRules(COMET_DATA.comets.slice(0, 1)).map((i) => i.rule)).toContain('lines');
    } finally {
      lines.headline = was;
    }
  });
});

describe('the reckoning', () => {
  it('matches Horizons within a tenth of a degree for a year either side of the snapshot, and within a few degrees over six years', () => {
    for (const c of COMET_DATA.comets) {
      const m = cometMisses(c);
      expect(m.checked, c.name).toBeGreaterThan(70);
      expect(m.nearDeg, c.name).toBeLessThan(COMET_TOLERANCE.nearDeg);
      expect(m.nearFraction, c.name).toBeLessThan(COMET_TOLERANCE.nearFraction);
      expect(m.farDeg, c.name).toBeLessThan(COMET_TOLERANCE.farDeg);
      expect(m.farFraction, c.name).toBeLessThan(COMET_TOLERANCE.farFraction);
    }
  });

  it('gives the physics of real comets: Halley back in 2061, Encke in February 2027, and a whole period bringing one back', () => {
    const h = perihelia(halley, COMET_EPOCH_JD);
    expect(new Date((h.next - 2_440_587.5) * 86_400_000).getUTCFullYear()).toBe(2061);
    expect(new Date((h.last - 2_440_587.5) * 86_400_000).getUTCFullYear()).toBe(1986);
    expect(dateText(perihelia(encke, COMET_EPOCH_JD).next)).toBe('10 February 2027');
    // Encke at perihelion is about its perihelion distance from the Sun, and far brighter than now.
    const p = perihelia(encke, COMET_EPOCH_JD).next;
    expect(cometAt(encke, p).r).toBeCloseTo(encke.elements.qAu, 6);
    expect(cometMagnitude(encke, p)!).toBeLessThan(cometMagnitude(encke, COMET_EPOCH_JD)! - 3);
    const later = cometAt(encke, COMET_EPOCH_JD + encke.elements.periodDays);
    const now = cometAt(encke, COMET_EPOCH_JD);
    later.xyz.forEach((x, i) => expect(x).toBeCloseTo(now.xyz[i]!, 6));
  });

  it('is said with every number from the elements and the date, a far perihelion only by its year', () => {
    const f = cometFacts(encke, COMET_EPOCH_JD);
    expect(f.headline).toBe('2P/Encke comes round once every 3.30 years.');
    expect(f.nextPerihelion).toBe('10 February 2027');
    expect(f.perihelion).toBe(`${encke.elements.qAu.toFixed(2)} AU from the Sun`);
    expect(f.now).toMatch(/^\d\.\d\d AU from the Sun; \d\.\d\d AU from Earth$/);
    expect(f.unsure).toBeNull();
    const h = cometFacts(halley, COMET_EPOCH_JD);
    expect(h.nextPerihelion).toBe('In 2061');
    expect(h.lastPerihelion).toBe('In 1986');
    expect(h.brightness).toBe(COMET_LINES.faint);
    expect(cometFacts(encke, COMET_EPOCH_JD + 3_000).unsure).toBe(COMET_LINES.unsure);
    expect(perihelionText(COMET_EPOCH_JD + 10)).not.toMatch(/^In /);
    // What it takes to see one.
    expect([sightOf(4), sightOf(8), sightOf(12), sightOf(18)]).toEqual(['the naked eye', 'binoculars', 'a small telescope', 'a large telescope']);
  });
});

describe('in flight', () => {
  it('each comet stands in its real direction from the Sun on the game’s date, its tails away from the Sun while it is active', () => {
    for (const jd of [COMET_EPOCH_JD, perihelia(encke, COMET_EPOCH_JD).next, COMET_EPOCH_JD + 900]) {
      const def = sceneDefFor('sol', jd);
      expect(def.comets).toHaveLength(COMET_DATA.comets.length);
      for (const d of def.comets!) {
        const c = cometOf(d.id)!;
        const at = cometAt(c, jd);
        expect(d.position.angleTo(eclipticToScene(at.xyz)), d.id).toBeLessThan(0.01);
        expect(d.tail > 0, d.id).toBe(activity(at.r) > 0);
        if (d.tail > 0) expect(d.gasDir.angleTo(d.position)).toBeLessThan(1e-6);
      }
    }
    // Encke near the Sun in full flow; Halley far out and quiet.
    const atPerihelion = sceneDefFor('sol', perihelia(encke, COMET_EPOCH_JD).next).comets!;
    expect(atPerihelion.find((c) => c.id === 'comet-2p')!.tail).toBe(COMETS.activity.tail);
    expect(atPerihelion.find((c) => c.id === 'comet-1p')!.tail).toBe(0);
  });

  it('is on the planets’ own compressed scale', () => {
    const def = sceneDefFor('sol', COMET_EPOCH_JD);
    const earth = def.planets.find((p) => p.id === 'earth')!;
    expect(compressedSolDistance(1.00000261)).toBeCloseTo(earth.position.length(), 0);
    const ds = [0.3, 0.6, 1, 2, 5, 10, 20, 35, 50].map((au) => compressedSolDistance(au)!);
    ds.slice(1).forEach((d, i) => expect(d).toBeGreaterThan(ds[i]!));
    expect(ds[0]).toBeGreaterThanOrEqual(COMETS.nearest);
  });
});

describe('the News', () => {
  it('tells of a comet near the Sun, only within its window, at Sol’s stations and research stations within reach', () => {
    const before = cometNews(jdOf('2027-01-20'));
    expect(before.map((n) => n.comet.id)).toContain('comet-2p');
    const e = before.find((n) => n.comet.id === 'comet-2p')!;
    expect(e.passed).toBe(false);
    expect(e.detail).toBe(`2P/Encke passes closest to the Sun on 10 February 2027, ${encke.elements.qAu.toFixed(2)} AU from it.`);
    const after = cometNews(jdOf('2027-03-01')).find((n) => n.comet.id === 'comet-2p')!;
    expect(after.passed).toBe(true);
    expect(cometNews(jdOf('2026-11-01')).map((n) => n.comet.id)).not.toContain('comet-2p');
    expect(hearsOfComets('earth-port')).toBe(true);
    expect(hearsOfComets('ledger-institute')).toBe(true);
    const far = ALL_LOCATIONS.find((l) => l.systemId === 'procyon' && l.stationType !== 'research-station')!;
    expect(hearsOfComets(far.id)).toBe(false);
  });
});

describe('imaging', () => {
  const research = ALL_LOCATIONS.filter((l) => imagingJumps(l.id) !== null);

  it('is posted by research stations near Sol, now and then, passes the contract guardrails, and pays for images taken in Sol in time', () => {
    const giver = getLocation('ledger-institute');
    const epoch = Array.from({ length: 200 }, (_, i) => i + 3).find((e) => imageOffer(giver.id, e))!;
    const offer = imageOffer(giver.id, epoch)!;
    const clock = epoch * CONTRACTS.epochSeconds + 30;
    const s = pilotAt(giver.id, clock);
    const job = boardFor(giver.id, epoch).find((c) => c.contract?.comet === offer.comet.id)!;
    expect(job).toBeDefined();
    expect(job.title).toBe(`Image ${offer.comet.name}`);
    expect(job.reward).toBe(imageReward(offer.jumps));
    expect(contractIssues(job, clock)).toEqual([]);
    expect(postedContracts(s, giver.id).some((c) => c.id === job.id)).toBe(true);
    expect(acceptJob(s, job.id).ok).toBe(true);
    s.location = { ...s.location, dockedAt: null };
    expect(describeObjective(s, job.id)).toMatchObject({ targetSystemId: 'sol' });
    // Elsewhere, a reading counts for nothing; in Sol it does.
    recordObservation(s, offer.comet.id, 'wolf-359' as SystemId);
    expect(advanceJobs(s, { dockedAt: null, systemId: 'wolf-359' as SystemId })).toEqual([]);
    s.location = { ...s.location, systemId: 'sol' as SystemId };
    expect(describeObjective(s, job.id)).toMatchObject({ targetId: `comet:${offer.comet.id}` });
    recordObservation(s, offer.comet.id, 'sol' as SystemId);
    expect(advanceJobs(s, { dockedAt: null, systemId: 'sol' as SystemId }).map((e) => e.kind)).toEqual(['objective']);
    const credits = s.credits;
    s.location = { ...s.location, systemId: giver.systemId };
    expect(dockAt(s, giver.id).jobEvents.some((e) => e.kind === 'complete')).toBe(true);
    expect(s.credits - credits).toBe(job.reward);
    assertValidState(s);
  });

  it('comes about as often as the rules say, only at research stations within reach, every one sound', () => {
    expect(research.length).toBeGreaterThanOrEqual(3);
    let posted = 0;
    let slots = 0;
    for (const l of research) {
      for (let epoch = 0; epoch < 120; epoch++) {
        slots++;
        const job = boardFor(l.id, epoch).find((c) => c.contract?.comet);
        if (!job) continue;
        posted++;
        expect(contractIssues(job, epoch * CONTRACTS.epochSeconds), job.id).toEqual([]);
      }
    }
    expect(posted / slots).toBeGreaterThan(COMETS.image.odds - 0.08);
    expect(posted / slots).toBeLessThan(COMETS.image.odds + 0.08);
    expect(imagingJumps('earth-port')).toBeNull();
  });
});
