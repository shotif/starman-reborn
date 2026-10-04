import { COMMODITIES, PRICE_BAND, type CommodityId } from '../content/economy/goods.ts';
import { STATION_MARKETS } from '../content/economy/rules.ts';
import { OUTPOSTS } from '../content/outposts/rules.ts';
import { beltSiteId, isOutpostId, outpostSites, type OutpostSite } from '../content/outposts/sites.ts';
import type { Issue } from '../content/validate.ts';
import { julianDate } from '../data/solar.ts';
import { BELTS } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { segmentDistance } from '../world/courses.ts';
import type { SystemSceneDef } from '../world/sceneTypes.ts';
import { siteDock } from '../world/siteDock.ts';
import { sceneDefFor } from '../world/systems/index.ts';
import type { OutpostRules } from './outpostGuards.ts';

/**
 * Guardrails for outposts in the belts (docs/PROCGEN.md §36.7): every cited belt has one site, in
 * its ring and clear of stations, beacons, bodies, lanes and other sites (Sol's on dates through
 * several Earth–Mars cycles, as its planets, stations and lane move); a belt outpost is a refinery;
 * refining pays above what any market can pay for the raw good, takes more an hour as the outpost
 * grows and yields half the raw in refined goods its kind makes; at most three outposts, a sale
 * fetching half.
 */

/** Sol's scene schematic and on dates five days apart from 2026 through 2031 (more than two Earth–Mars cycles). */
function scenesOf(systemId: SystemId): SystemSceneDef[] {
  if (systemId !== 'sol') return [sceneDefFor(systemId)];
  const start = julianDate(Date.UTC(2026, 0, 1));
  return [sceneDefFor('sol'), ...Array.from({ length: 400 }, (_, i) => sceneDefFor('sol', start + i * 5))];
}

/** What is wrong with a belt site's place in a scene: each problem in words, none when it is clear. */
export function beltSiteIssues(def: SystemSceneDef, site: OutpostSite, clear: OutpostRules['belts']['clear'] = OUTPOSTS.belts.clear): string[] {
  const dock = siteDock(def, site);
  const ring = def.belts.find((b) => b.beltId === site.beltId && b.shape === 'ring');
  if (!dock || !ring) return ['no ring for it in the scene'];
  const p = dock.position;
  const out: string[] = [];
  const radial = Math.hypot(p.x - ring.center.x, p.z - ring.center.z);
  if (radial < ring.innerRadius || radial > ring.outerRadius || Math.abs(p.y - ring.center.y) > ring.thickness / 2) out.push('not in its ring');
  // The world's stations (not the save's own), and the beacons ships arrive at.
  for (const s of def.stations) if (!isOutpostId(s.locationId) && s.position.distanceTo(p) < clear.station) out.push(`near ${s.locationId}`);
  for (const b of def.beacons) if (b.position.distanceTo(p) < clear.station) out.push(`near the beacon ${b.id}`);
  for (const b of def.planets) if (b.position.distanceTo(p) - b.radius < clear.body) out.push(`near ${b.id}`);
  for (const s of def.stars) if (s.position.distanceTo(p) - s.radius * 1.3 < clear.body) out.push(`near ${s.id}`);
  for (const l of def.lanes) if (segmentDistance(p, l.from, l.to) < clear.lane) out.push(`on the lane ${l.id}`);
  for (const other of outpostSites()) {
    if (other.id === site.id || other.systemId !== site.systemId) continue;
    const at = siteDock(def, other)?.position;
    if (at && at.distanceTo(p) < clear.station) out.push(`near the site ${other.id}`);
  }
  return out;
}

export function validateBeltOutposts(rules: OutpostRules = OUTPOSTS, sites: readonly OutpostSite[] = outpostSites()): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });

  // How many a pilot may run, what the journal keeps, and what a sale fetches.
  if (!Number.isInteger(rules.max) || rules.max < 1 || rules.max > 5) report('rules', 'max', 'outposts to a pilot out of range (1–5)');
  if (!Number.isInteger(rules.former) || rules.former < 1 || rules.former > 12) report('rules', 'former', 'former outposts kept out of range (1–12)');
  if (!(rules.sale > 0 && rules.sale < 1)) report('rules', 'sale', 'a sale fetches nothing, or more than went in');

  // A belt outpost is a refinery, a kind outposts can be, with a market that makes the refined goods.
  if (rules.belts.kinds.length !== 1 || rules.belts.kinds[0] !== 'refinery' || !(rules.kinds as readonly string[]).includes('refinery')) report('rules', 'belts', 'a belt outpost is not a refinery');

  // Refining: raw goods in, goods a refinery makes out, paid above any market's price, more an hour as it grows, half the raw.
  const R = rules.refining;
  for (const [raw, made] of Object.entries(R.goods) as [CommodityId, CommodityId][]) {
    const base = COMMODITIES[raw]?.basePrice;
    if (COMMODITIES[raw]?.category !== 'raw') report('refining', raw, 'not a raw good');
    if (!(STATION_MARKETS.refinery.produce as readonly string[]).includes(made)) report('refining', raw, `${made}: not a good a refinery makes`);
    if (base && Math.round(base * R.pay) <= Math.floor(base * PRICE_BAND[1]) - 1) report('refining', raw, 'pays no more than a market can');
  }
  if (R.perHour.length !== rules.stages.length || !R.perHour.every((n, i) => Number.isInteger(n) && n > 0 && (i === 0 || n > R.perHour[i - 1]!))) report('refining', 'perHour', 'the hourly allowance does not rise with the stages');
  if (R.per !== 2) report('refining', 'per', 'the refined yield is not half the raw');

  // The angles set by hand: for cited belts, on the circle.
  for (const [id, a] of Object.entries(rules.belts.angle)) {
    if (!BELTS.some((b) => b.id === id)) report('belts', id, 'an angle set for a belt that is not cited');
    if (a === undefined || !(a >= 0 && a < 360)) report('belts', id, 'an angle off the circle');
  }

  // One site in every cited belt, Sol's included, and none elsewhere: in its ring, clear.
  const beltSites = sites.filter((s) => s.beltId);
  for (const b of BELTS) {
    const mine = beltSites.filter((s) => s.beltId === b.id);
    if (mine.length !== 1) report('belts', b.id, `${mine.length} sites (one wanted)`);
  }
  for (const site of beltSites) {
    const belt = BELTS.find((b) => b.id === site.beltId);
    if (!belt) {
      report('belts', site.id, 'a site in a belt that is not cited');
      continue;
    }
    if (site.id !== beltSiteId(belt.id) || site.systemId !== belt.systemId || site.planetId || !site.ring) report('belts', site.id, 'a site that is not its belt’s');
    if (site.kinds.length !== 1 || site.kinds[0] !== 'refinery') report('belts', site.id, 'can be something other than a refinery');
    const seen = new Set<string>();
    for (const def of scenesOf(site.systemId)) {
      for (const p of beltSiteIssues(def, site, rules.belts.clear)) {
        if (seen.has(p)) continue;
        seen.add(p);
        report('belts', site.id, p);
      }
    }
  }
  return issues;
}
