import { EVENTS, FRONTIER_EVENTS, STRANDED_NAMES, type EventKind } from '../content/events/rules.ts';
import { COMMODITIES, PRICE_BAND } from '../content/economy/goods.ts';
import { CURATED_MARKETS } from '../content/economy/rules.ts';
import type { Issue } from '../content/validate.ts';
import { ALL_LOCATIONS, getLocation, isFrontier, WORLD } from '../data/systems.ts';
import { trafficFor } from '../world/traffic/setup.ts';
import { baseThreat, eventPriceChange, eventsAt, surveyPlanets, windowPhase, type WorldEvent } from './events.ts';
import { marketTables, quote } from './markets.ts';

/**
 * World event guardrails (docs/PROCGEN.md §11.4): sampled over many hours of game clock, events
 * happen only where they can, touch only goods the station deals in, keep prices inside their
 * bands, say what they do in numbers that match, and happen often enough to notice.
 */

const NEUTRAL_REP = { sta: 0, frontier: 0, 'hollow-wake': 0 };
/** Station events under way at once, on average, per hundred open stations (the neighbourhood grows). */
export const ACTIVE_BAND = [5, 45] as const;

export function validateEvents(hours = 300, stepSeconds = 600): Issue[] {
  const issues: Issue[] = [];
  const report = (rule: string, subject: string, message: string) => issues.push({ rule, subject, message });
  const seen = new Map<string, WorldEvent>();
  const kinds = new Set<EventKind>();
  let stationEvents = 0;
  let samples = 0;
  for (let clock = 0; clock < hours * 3_600; clock += stepSeconds) {
    samples++;
    const now = eventsAt(clock);
    const places = new Set<string>();
    for (const e of now) {
      const place = e.locationId ?? e.systemId;
      if (places.has(place)) report('overlap', e.id, `two events at once at ${place}`);
      places.add(place);
      kinds.add(e.kind);
      if (e.locationId) stationEvents++;
      if (!seen.has(e.id)) {
        seen.set(e.id, e);
        checkEvent(e, report);
      }
      if (e.locationId) checkPrices(e, clock, report);
      else checkTraffic(e, clock, report);
    }
  }
  const open = ALL_LOCATIONS.filter((l) => l.status === 'functional' && l.dockable !== false && l.services.includes('market')).length;
  const average = (stationEvents / Math.max(1, samples)) * (100 / Math.max(1, open));
  if (average < ACTIVE_BAND[0] || average > ACTIVE_BAND[1]) report('density', 'stations', `${average.toFixed(1)} station events under way per hundred stations on average (want ${ACTIVE_BAND[0]}–${ACTIVE_BAND[1]})`);
  for (const k of ['shortage', 'glut', 'boom', 'strike', 'raid', 'sweep', 'harvest', 'survey', 'stranded'] as EventKind[]) if (!kinds.has(k)) report('coverage', k, 'never happens');
  return issues;
}

function checkEvent(e: WorldEvent, report: (rule: string, subject: string, message: string) => void): void {
  const text = `${e.headline} ${e.detail}`;
  if (!e.headline.trim() || !e.detail.trim() || /undefined|NaN|\{|\}/.test(text)) report('text', e.id, 'text missing or unfilled');
  const [window, [lo, hi]] = e.locationId ? [EVENTS.stationWindow, EVENTS.stationDuration] : [EVENTS.systemWindow, EVENTS.systemDuration];
  const length = e.end - e.start;
  if (length < lo - 60 || length > hi + 60) report('timing', e.id, `lasts ${length} s`);
  const phase = windowPhase(e.locationId ?? e.systemId, window);
  if (Math.floor((e.start + phase) / window) !== Math.floor((e.end - 1 + phase) / window)) report('timing', e.id, 'spills out of its window');
  if (e.locationId) {
    const loc = getLocation(e.locationId);
    if (loc.systemId === 'sol') report('place', e.id, 'events never touch Sol');
    const table = marketTables().get(e.locationId);
    const fixed = Object.keys(CURATED_MARKETS[e.locationId]?.anchors ?? {});
    const roles: Record<string, readonly string[]> = { shortage: ['consume'], glut: ['produce'], strike: ['produce'], boom: ['consume', 'trade'], harvest: ['produce'], survey: ['consume'] };
    // The frontier's own: harvests at its farms, survey seasons at its research posts, of a real planet nearby.
    if (e.kind === 'harvest' && (!isFrontier(loc.systemId) || loc.stationType !== 'agri-station' || !e.goods.every((g) => FRONTIER_EVENTS.harvestGoods.includes(g)))) report('place', e.id, 'a harvest comes in only at a frontier farm, of what it grows');
    if (e.kind === 'survey') {
      if (!isFrontier(loc.systemId) || loc.stationType !== 'research-station') report('place', e.id, 'survey seasons are for frontier research posts');
      const planet = surveyPlanets(e.locationId).find((p) => p.id === e.bodyId);
      if (!planet) report('survey', e.id, `${e.bodyId} is not a planet within reach`);
      else if (planet.contested && !/archives disagree about/.test(e.detail)) report('survey', e.id, 'a contested planet must be said to be contested');
      if (/\b(settled|settles it|proves?|confirms)\b/i.test(e.detail)) report('survey', e.id, 'readings never settle what the archives say');
    }
    if (!e.goods.length) report('goods', e.id, 'no goods');
    for (const g of e.goods) {
      const role = table?.entries.get(g)?.role;
      if (!role || !roles[e.kind]!.includes(role)) report('goods', e.id, `${e.locationId} does not ${e.kind === 'glut' || e.kind === 'strike' || e.kind === 'harvest' ? 'make' : 'want'} ${g}`);
      if (fixed.includes(g) || g === 'weapons') report('goods', e.id, `${g} is off limits`);
    }
    const fx = EVENTS.effects[e.kind as keyof typeof EVENTS.effects];
    if (!fx || e.price < fx.price[0] - 0.005 || e.price > fx.price[1] + 0.005 || e.stock !== fx.stock) report('effect', e.id, `price ×${e.price}, stock ×${e.stock}`);
    // The news quotes the change it causes.
    const pct = Math.round(Math.abs(eventPriceChange(e) - 1) * 100);
    if (!e.detail.includes(`${pct}%`)) report('text', e.id, `detail does not state the ${pct}% change`);
  } else {
    const security = WORLD.profiles.get(e.systemId)?.security ?? 1;
    const owner = WORLD.profiles.get(e.systemId)?.owner ?? null;
    if (e.kind === 'raid') {
      if (security >= EVENTS.raidBelowSecurity) report('place', e.id, `raid in secure space (${security})`);
      if (e.level !== Math.min(3, (baseThreat(e.systemId) ?? 0) + 1)) report('effect', e.id, `raid threat ${e.level}`);
    } else if (e.kind === 'sweep') {
      if (owner !== 'sta' && owner !== 'frontier') report('place', e.id, 'sweep in unclaimed space');
      if (baseThreat(e.systemId) === null) report('place', e.id, 'sweep where no raiders roam');
    } else if (e.kind === 'stranded') {
      if (!isFrontier(e.systemId)) report('place', e.id, 'drive failures far from any dock are the frontier’s');
      if (!e.ship || !STRANDED_NAMES.includes(e.ship) || !e.detail.includes(e.ship)) report('text', e.id, 'a stranded hauler needs its name');
    } else report('kind', e.id, `station event ${e.kind} without a station`);
  }
}

function checkPrices(e: WorldEvent, clock: number, report: (rule: string, subject: string, message: string) => void): void {
  for (const g of e.goods) {
    const q = quote(e.locationId!, g, NEUTRAL_REP, { clock, markets: {} });
    const base = COMMODITIES[g].basePrice;
    for (const p of [q.buy, q.sell]) {
      if (p !== null && (p < base * PRICE_BAND[0] - 1 || p > base * PRICE_BAND[1] + 1)) report('prices', e.id, `${g} at ${p} cr is outside its band`);
    }
    if (q.buy !== null && q.sell !== null && q.buy <= q.sell) report('prices', e.id, `${g}: buy ${q.buy} not above sell ${q.sell}`);
  }
}

function checkTraffic(e: WorldEvent, clock: number, report: (rule: string, subject: string, message: string) => void): void {
  const plan = trafficFor(e.systemId, 'high', clock).plan;
  if (e.kind === 'raid' && (!plan.packs || plan.packs.level !== e.level)) report('traffic', e.id, 'raid does not change the packs');
  if (e.kind === 'sweep' && plan.packs) report('traffic', e.id, 'packs still roam during a sweep');
}
