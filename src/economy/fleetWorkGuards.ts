import type { OwnedShip } from '../app/state.ts';
import { getCatalog } from '../content/catalog.ts';
import { FLEET } from '../content/fleet/rules.ts';
import { MINING } from '../content/mining/rules.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { isOutpostId, outpostSites } from '../content/outposts/sites.ts';
import type { Issue } from '../content/validate.ts';
import { julianDate } from '../data/solar.ts';
import { COMMODITIES } from './commodities.ts';
import { miningEstimate } from './fleet.ts';
import { miningSpot } from './fleetWork.ts';
import { newShipState } from './loadout.ts';
import { sceneDefFor } from '../world/systems/index.ts';

/** The rules a guardrail checks (the real ones, or a broken copy in the tests). */
export type WorkRules = typeof FLEET.work;

/**
 * Guardrails for captains who work for the pilot's outposts (docs/PROCGEN.md §37.7): the share and
 * cut in range; a mining cycle, for every laser the catalogue sells, taking a few minutes at least
 * and paying the pilot no more an hour than 70% of a port's allowance at the dearest raw good's
 * refining price; every belt refinery's spot in its ring and clear of stations (Sol's on dates
 * through several Earth–Mars cycles); whole numbers where they must be.
 */
export function validateFleetWork(rules: WorkRules = FLEET.work): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });

  if (!(rules.share > 0 && rules.share <= 0.2)) report('rules', 'share', 'a supply captain’s share out of range (above nothing, a fifth at most)');
  if (!(rules.cut > 0 && rules.cut <= 0.5)) report('rules', 'cut', 'a mining captain’s cut out of range (above nothing, a half at most)');
  for (const k of ['transit', 'spot', 'clear', 'maxSteps'] as const) if (!Number.isInteger(rules[k]) || rules[k] <= 0) report('rules', k, 'not a whole number above nothing');
  if (rules.transit !== MINING.income.transit) report('rules', 'transit', 'not the mining estimates’ transit (§19)');
  if (rules.spot <= rules.clear) report('rules', 'spot', 'the spot within its own clearance of the refinery');

  // Mining: every laser the catalogue sells, in the ship that takes it with the most hold, at a port.
  const lasers = getCatalog().gear.filter((g) => g.family === 'mining-laser');
  if (!lasers.length) report('rules', 'lasers', 'no mining laser for sale');
  const R = OUTPOSTS.refining;
  const dearest = Math.max(...Object.keys(R.goods).map((c) => Math.round(COMMODITIES[c as keyof typeof R.goods].basePrice * R.pay)));
  const cap = R.perHour.at(-1)! * dearest * 0.7;
  const site = outpostSites().find((s) => s.beltId)!;
  const port = { site: site.id, kind: 'refinery' as const, name: 'Guardrail Works', founded: 0, stage: OUTPOSTS.stages.length, delivered: {}, since: 0, earned: 0, opened: 0 };
  for (const laser of lasers) {
    const ships = getCatalog().ships.filter((m) => m.slots.some((s) => s.type === 'utility' && laser.tier <= s.maxClass));
    const big = [...ships].sort((a, b) => b.cargo - a.cargo)[0];
    if (!big) continue;
    const ship = newShipState(big.id);
    const slot = big.slots.find((s) => s.type === 'utility' && laser.tier <= s.maxClass)!;
    ship.fittings = { ...ship.fittings, [slot.id]: laser.id };
    const o: OwnedShip = { id: 'guard', ship, locationId: 'earth-port' };
    const est = miningEstimate(o, port);
    if (!(est.cycle >= 180)) report('mining', laser.id, `a cycle of ${Math.round(est.cycle)} s (three minutes at least)`);
    if (est.payPerHour > cap + 1) report('mining', laser.id, `pays ${est.payPerHour} cr an hour (at most ${Math.round(cap)})`);
  }

  // Every belt refinery's spot: in its ring, clear of stations.
  const start = julianDate(Date.UTC(2026, 0, 1));
  for (const s of outpostSites().filter((x) => x.beltId)) {
    const defs = s.systemId === 'sol' ? [sceneDefFor('sol'), ...Array.from({ length: 120 }, (_, i) => sceneDefFor('sol', start + i * 15))] : [sceneDefFor(s.systemId)];
    for (const def of defs) {
      const p = miningSpot(def, s);
      const ring = def.belts.find((b) => b.beltId === s.beltId && b.shape === 'ring');
      if (!p || !ring) {
        report('spots', s.id, 'no spot in the scene');
        break;
      }
      const radial = Math.hypot(p.x - ring.center.x, p.z - ring.center.z);
      if (radial < ring.innerRadius || radial > ring.outerRadius) report('spots', s.id, 'not in its ring');
      const near = def.stations.find((st) => !isOutpostId(st.locationId) && st.position.distanceTo(p) < rules.clear);
      if (near) {
        report('spots', s.id, `within ${rules.clear} m of ${near.locationId}`);
        break;
      }
    }
  }
  return issues;
}
