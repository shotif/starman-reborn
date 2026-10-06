import type { EventKind } from '../content/events/rules.ts';
import { getComponent, getLocation, getSystem } from '../data/systems.ts';
import type { GameState } from '../app/state.ts';
import { borderNews, type FrontPhase } from '../economy/border.ts';
import { battleNews } from '../economy/battles.ts';
import { densDownNear } from '../economy/dens.ts';
import type { SystemId } from '../data/types.ts';
import { eventEnd, marksNear, minutes, newsAt, type NewsItem, type WorldEvent } from '../economy/events.ts';
import { haulsLostNear, reliefNews, shipsOut } from '../economy/hauls.ts';
import { COMMODITIES } from '../content/economy/goods.ts';
import type { RivalStyle } from '../content/rivals/rules.ts';
import { rivalName, rivalNews } from '../economy/rivals.ts';
import { outpostRaidNews } from '../economy/outpostRaids.ts';
import { skyNews } from '../economy/stellar.ts';
import { edgeNews, fillEdge } from '../economy/doomed.ts';
import { flareNews } from '../economy/flares.ts';
import { cometNews, hearsOfComets } from '../economy/comets.ts';
import { FLARE_WORD } from '../content/stellar/flareLines.ts';
import { EDGE_EARTH, EDGE_FICTION } from '../content/stellar/doomedLines.ts';
import { DOOMED } from '../content/stellar/doomed.ts';
import { dataBadge } from './components.ts';
import { h } from './dom.ts';
import { glyph, type GlyphName } from './glyphs.ts';
import { COMMODITY_GLYPH } from './station/trader.ts';

/** World events as the player hears of them: the station News window and the star map. */

export const EVENT_LABEL: Record<EventKind, string> = {
  shortage: 'Shortage',
  glut: 'Glut',
  boom: 'Boom',
  strike: 'Strike',
  raid: 'Raid',
  sweep: 'Security sweep',
  harvest: 'Harvest',
  survey: 'Survey season',
  stranded: 'Drive failure',
};

export function eventGlyph(e: Pick<WorldEvent, 'kind' | 'goods'>): GlyphName {
  if (e.kind === 'raid') return 'gun';
  if (e.kind === 'sweep') return 'shieldgen';
  if (e.kind === 'survey') return 'scanner';
  if (e.kind === 'stranded') return 'shipparts';
  return e.goods[0] ? COMMODITY_GLYPH[e.goods[0]] : 'trader';
}

function when(n: NewsItem, clock: number): string {
  const e = n.event;
  const end = eventEnd(e);
  // A glut is cleared: bought up by a pilot, or shipped out by its haulers (docs/PROCGEN.md §21.6).
  const glut = shipsOut(e);
  if (n.endedEarly) return `${e.kind === 'raid' ? 'broken' : glut ? 'bought up' : 'relieved'} by a pilot ${minutes(clock - end)} min ago`;
  if (end < e.end && end <= clock) return `${glut ? 'shipped out' : 'relieved'} by its haulers ${minutes(clock - end)} min ago`;
  // What is left: to when it is due to end, or sooner when its relief or shipments will end it.
  return n.active ? `for ${minutes(clock - e.start)} min, about ${minutes(end - clock)} min to go` : `over ${minutes(clock - end)} min ago`;
}

function where(n: NewsItem): string {
  return n.jumps === 0 ? 'this system' : `${getSystem(n.event.systemId).displayName}, ${n.jumps} jump${n.jumps > 1 ? 's' : ''}`;
}

/** Raider dens knocked out within reach: dark for now, and their systems quiet (docs/PROCGEN.md §15). */
export function denNews(state: GameState, systemId: SystemId): HTMLElement | null {
  const down = densDownNear(state, systemId);
  if (!down.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'den-news' },
    down.map((d) => {
      const loc = getLocation(d.locationId);
      const hours = Math.max(1, Math.round(d.left / 3600));
      return h(
        'li',
        { class: 'news-item kind-sweep' },
        glyph('shieldgen'),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, `${loc.name} knocked out`),
          h('span', { class: 'row-sub' }, `Raider den · ${d.jumps === 0 ? 'this system' : `${getSystem(loc.systemId).displayName}, ${d.jumps} jump${d.jumps > 1 ? 's' : ''}`} · dark for about ${hours} h more`),
          h('span', { class: 'news-detail' }, `Its reactor is down: no raider packs at ${getSystem(loc.systemId).displayName} until the Wake rebuilds it.`),
        ),
      );
    }),
  );
}

/** Stations a story's ending changed for good, within reach (docs/PROCGEN.md §14.7). */
export function markNews(systemId: SystemId): HTMLElement | null {
  const near = marksNear(systemId);
  if (!near.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'mark-news' },
    near.map(({ mark, jumps }) => {
      const loc = getLocation(mark.locationId);
      return h(
        'li',
        { class: 'news-item kind-mark', 'data-testid': `mark-${mark.id}` },
        glyph(COMMODITY_GLYPH[mark.market.goods[0]!]),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, mark.headline),
          h('span', { class: 'row-sub' }, `For good · ${loc.name} · ${jumps === 0 ? 'this system' : `${getSystem(loc.systemId).displayName}, ${jumps} jump${jumps > 1 ? 's' : ''}`}`),
          h('span', { class: 'news-detail' }, mark.detail),
        ),
      );
    }),
  );
}

const PHASE_GLYPH: Record<FrontPhase, GlyphName> = { 'pushed-back': 'shieldgen', skirmish: 'gun', blockade: 'gun', fallen: 'gun', truce: 'shieldgen' };
const PHASE_LABEL: Record<FrontPhase, string> = { 'pushed-back': 'Border: the law advances', skirmish: 'Border: skirmishes', blockade: 'Border: blockade', fallen: 'Border: a station fallen', truce: 'Border: truce' };

/** The border war within reach (docs/PROCGEN.md §20): each front as it stands. */
export function borderNewsList(systemId: SystemId, clock: number): HTMLElement | null {
  const news = borderNews(systemId, clock);
  // Turning battles the pilot fought in and won (docs/PROCGEN.md §35.5), first.
  const battles = battleNews(systemId, clock);
  if (!news.length && !battles.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'border-news' },
    battles.map((b, i) =>
      h(
        'li',
        { class: 'news-item kind-border', 'data-testid': `battle-news-${i}` },
        glyph('gun'),
        h('span', { class: 'news-text' }, h('span', { class: 'row-name' }, b.headline), h('span', { class: 'row-sub' }, 'Border battle'), h('span', { class: 'news-detail' }, b.detail)),
      ),
    ),
    news.map((n) =>
      h(
        'li',
        { class: `news-item kind-border phase-${n.state.phase}`, 'data-testid': `border-${n.state.front.id}` },
        glyph(PHASE_GLYPH[n.state.phase]),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, n.headline),
          h('span', { class: 'row-sub' }, `${PHASE_LABEL[n.state.phase]} · ${n.jumps === 0 ? 'this system' : `${n.jumps} jump${n.jumps > 1 ? 's' : ''}`}`),
          h('span', { class: 'news-detail' }, n.detail),
        ),
      ),
    ),
  );
}

/** The news within reach of a system, nearest first (events under way, then recently over). */
export function newsList(systemId: SystemId, clock: number): HTMLElement {
  const news = newsAt(systemId, clock);
  if (!news.length) return h('p', { class: 'list-empty' }, 'Quiet lanes: nothing to report within two jumps.');
  return h(
    'ul',
    { class: 'list news-list' },
    news.map((n) =>
      h(
        'li',
        { class: `news-item kind-${n.event.kind}${n.active ? '' : ' over'}${n.endedEarly ? ' answered' : ''}`, 'data-testid': `news-${n.event.id}` },
        glyph(eventGlyph(n.event)),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, n.event.headline),
          h('span', { class: 'row-sub' }, `${EVENT_LABEL[n.event.kind]} · ${where(n)} · ${when(n, clock)}`),
          h('span', { class: 'news-detail' }, n.event.detail),
          n.event.kind === 'shortage' ? reliefLine(n.event, clock) : shipsOut(n.event) ? shipmentLine(n.event, clock) : null,
        ),
      ),
    ),
  );
}

const units = (qty: number, c: keyof typeof COMMODITIES) => `${qty} ${COMMODITIES[c].name.toLowerCase()}`;

/** The haulers a shortage drew (docs/PROCGEN.md §21): on their way, in, or lost. */
function reliefLine(e: WorldEvent, clock: number): HTMLElement | null {
  const relief = reliefNews(e);
  if (!relief.length) return null;
  const said = relief.map(({ haul, fate }) => {
    const from = getLocation(haul.from).name;
    if (!fate.delivered && fate.at <= clock) return `the ${haul.name} (${units(haul.qty, haul.commodity)} from ${from}) was lost to ${fate.by === 'player' ? 'a pirate' : 'raiders'} in ${getSystem(fate.lostIn!).displayName}`;
    if (fate.escort) return `the ${haul.name} is with its escort, bringing ${units(haul.qty, haul.commodity)} from ${from}`;
    if (fate.delivered && fate.at <= clock) return `the ${haul.name} brought ${units(haul.qty, haul.commodity)} from ${from}`;
    if (haul.depart > clock) return `the ${haul.name} is loading ${units(haul.qty, haul.commodity)} at ${from}`;
    return `the ${haul.name} is on its way from ${from} with ${units(haul.qty, haul.commodity)}, due in about ${minutes(haul.arrive - clock)} min`;
  });
  const text = said.join('; ');
  return h('span', { class: 'news-relief', 'data-testid': `relief-${e.id}` }, `Relief: ${text.charAt(0).toUpperCase()}${text.slice(1)}.`);
}

/** What a glut ships out (docs/PROCGEN.md §21.6): loading, on its way, delivered, or lost. */
function shipmentLine(e: WorldEvent, clock: number): HTMLElement | null {
  const out = reliefNews(e);
  if (!out.length) return null;
  const said = out.map(({ haul, fate }) => {
    const to = getLocation(haul.to).name;
    const cargo = units(haul.qty, haul.commodity);
    if (!fate.delivered && fate.at <= clock) return `the ${haul.name} (${cargo} for ${to}) was lost to ${fate.by === 'player' ? 'a pirate' : 'raiders'} in ${getSystem(fate.lostIn!).displayName}`;
    if (fate.escort) return `the ${haul.name} is with its escort, taking ${cargo} to ${to}`;
    if (fate.delivered && fate.at <= clock) return `the ${haul.name} took ${cargo} to ${to}`;
    if (haul.depart > clock) return `the ${haul.name} is loading ${cargo} for ${to}, leaving in about ${minutes(haul.depart - clock)} min`;
    return `the ${haul.name} is on its way to ${to} with ${cargo}, due in about ${minutes(haul.arrive - clock)} min`;
  });
  const text = said.join('; ');
  return h('span', { class: 'news-relief', 'data-testid': `shipments-${e.id}` }, `Shipping out: ${text.charAt(0).toUpperCase()}${text.slice(1)}.`);
}

/** Hauls lost to raiders within reach, lately (docs/PROCGEN.md §21). */
export function haulNews(systemId: SystemId, clock: number): HTMLElement | null {
  const lost = haulsLostNear(systemId, clock);
  if (!lost.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'haul-news' },
    lost.map(({ haul, fate, jumps }) => {
      const to = getLocation(haul.to);
      return h(
        'li',
        { class: 'news-item kind-raid over', 'data-testid': `haul-${haul.id}` },
        glyph(COMMODITY_GLYPH[haul.commodity]),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, `The ${haul.name} lost to raiders`),
          h('span', { class: 'row-sub' }, `Hauler · ${jumps === 0 ? 'this system' : `${getSystem(fate.lostIn!).displayName}, ${jumps} jump${jumps > 1 ? 's' : ''}`} · ${minutes(clock - fate.at)} min ago`),
          h('span', { class: 'news-detail' }, `It was carrying ${units(haul.qty, haul.commodity)} from ${getLocation(haul.from).name} to ${to.name}, which will miss ${haul.qty > 1 ? 'them' : 'it'}.`),
        ),
      );
    }),
  );
}

const STYLE_GLYPH: Record<RivalStyle, GlyphName> = { trader: 'trader', hunter: 'gun', runner: 'cargopod' };

/** What rival pilots did within reach, lately (docs/PROCGEN.md §24). */
export function rivalNewsList(systemId: SystemId, clock: number): HTMLElement | null {
  const items = rivalNews(systemId, clock);
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'rival-news' },
    items.map((n) =>
      h(
        'li',
        { class: 'news-item kind-rival', 'data-rival': n.rival.id },
        glyph(STYLE_GLYPH[n.rival.style]),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, rivalName(n.rival)),
          h('span', { class: 'row-sub' }, `Rival pilot · ${n.jumps === 0 ? 'this system' : `${n.jumps} jump${n.jumps > 1 ? 's' : ''} away`} · ${clock - n.at < 60 ? 'just now' : `${minutes(clock - n.at)} min ago`}`),
          h('span', { class: 'news-detail' }, n.text),
        ),
      ),
    ),
  );
}

/** Raids on the player's outpost within two jumps, over the last hour (docs/PROCGEN.md §29): fiction, marked so. */
export function outpostRaidNewsList(systemId: SystemId, clock: number): HTMLElement | null {
  const items = outpostRaidNews(systemId, clock);
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'outpost-raid-news' },
    items.map((n) =>
      h(
        'li',
        { class: 'news-item kind-raid' },
        glyph('gun'),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, 'Your outpost ', dataBadge('fictional')),
          h('span', { class: 'row-sub' }, `${n.jumps === 0 ? 'this system' : `${n.jumps} jump${n.jumps > 1 ? 's' : ''} away`} · ${clock - n.at < 60 ? 'just now' : `${minutes(clock - n.at)} min ago`}`),
          h('span', { class: 'news-detail' }, n.text),
        ),
      ),
    ),
  );
}

/**
 * The far stars' deaths (docs/PROCGEN.md §25), told the same in every station: fiction, marked so,
 * about real stars whose catalogue values are marked as real (or pending verification).
 */
export function skyNewsList(clock: number): HTMLElement | null {
  const items = skyNews(clock);
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'sky-news' },
    items.map((n) =>
      h(
        'li',
        { class: `news-item kind-sky${n.kind.endsWith('gone') || n.kind === 'remnant' ? ' over' : ''}`, 'data-sky': n.kind },
        glyph('scanner'),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, n.headline, ' ', dataBadge('fictional')),
          h('span', { class: 'row-sub' }, `The sky · ${clock - n.at < 60 ? 'just now' : `${minutes(clock - n.at)} min ago`}`),
          h(
            'span',
            { class: 'news-detail' },
            n.detail,
            ' ',
            h('em', null, `Fiction: ${n.star.name} is a real star, and has not ${n.kind.startsWith('bh') ? 'collapsed' : 'exploded'}. `),
            dataBadge(n.star.verification === 'provisional' ? 'provisional' : 'observed', `${n.star.name}: ${n.star.spectralType}, ${Math.round(n.star.distanceLightYears).toLocaleString('en-GB')} ly`),
          ),
        ),
      ),
    ),
  );
}


/**
 * Pyre, the invented star (docs/PROCGEN.md §26), as told at a station: each moment as it comes
 * there, marked as fiction and said to be about a star that does not exist; at Sol's stations, once
 * its light has come, what it would mean for Earth.
 */
export function edgeNewsList(systemId: SystemId, clock: number): HTMLElement | null {
  const items = edgeNews(systemId, clock);
  if (!items.length) return null;
  const fiction = fillEdge(EDGE_FICTION);
  const ago = (at: number) => (clock - at < 60 ? 'just now' : `${minutes(clock - at)} min ago`);
  const light = systemId === 'sol' ? items.find((n) => n.kind === 'light') : undefined;
  const item = (kind: string, headline: string, detail: string, at: number) =>
    h(
      'li',
      { class: `news-item kind-sky${kind === 'fading' ? ' over' : ''}`, 'data-edge': kind },
      glyph('scanner'),
      h(
        'span',
        { class: 'news-text' },
        h('span', { class: 'row-name' }, headline, ' ', dataBadge('fictional')),
        h('span', { class: 'row-sub' }, `${DOOMED.star.name} · ${ago(at)}`),
        h('span', { class: 'news-detail' }, detail, ' ', h('em', null, fiction)),
      ),
    );
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'edge-news' },
    light ? item('earth', fillEdge(EDGE_EARTH.headline), fillEdge(EDGE_EARTH.detail), light.at) : null,
    items.map((n) => item(n.kind, n.headline, n.detail, n.at)),
  );
}

/**
 * Comets near the Sun (docs/PROCGEN.md §45.4), at Sol's stations and research stations within reach:
 * real comets and real perihelia, on the game's date, badged as observed.
 */
export function cometNewsList(locationId: string, jd: number | null): HTMLElement | null {
  if (jd === null || !hearsOfComets(locationId)) return null;
  const items = cometNews(jd);
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'comet-news' },
    items.map((n) => {
      const days = Math.round(Math.abs(n.perihelionJd - jd));
      const when = days === 0 ? 'today' : n.passed ? `${days} day${days > 1 ? 's' : ''} ago` : `in ${days} day${days > 1 ? 's' : ''}`;
      return h(
        'li',
        { class: `news-item kind-comet${n.passed ? ' over' : ''}`, 'data-testid': `news-${n.comet.id}` },
        glyph('science'),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, n.headline, ' ', dataBadge('observed')),
          h('span', { class: 'row-sub' }, `Comet · Sol · nearest the Sun ${when}`),
          h('span', { class: 'news-detail' }, n.detail, ' ', n.brightness),
        ),
      );
    }),
  );
}

/**
 * Flares within two jumps (docs/PROCGEN.md §43.4), under way first, then nearest: the stars and that
 * they flare are real, badged as observed; when they flare and what it does to ships is fiction, said so.
 */
export function flareNewsList(systemId: SystemId, clock: number): HTMLElement | null {
  const items = flareNews(systemId, clock);
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'flare-news' },
    items.map((n) => {
      const f = n.flare;
      const c = getComponent(f.star)!;
      const place = n.jumps === 0 ? 'this system' : `${getSystem(f.systemId).displayName}, ${n.jumps} jump${n.jumps > 1 ? 's' : ''}`;
      const when = n.active ? `about ${minutes(f.end - clock)} min to go` : `over ${minutes(clock - f.end)} min ago`;
      return h(
        'li',
        { class: `news-item kind-flare${n.active ? '' : ' over'}`, 'data-testid': `news-${f.id}` },
        glyph('science'),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, n.headline, ' ', dataBadge('fictional')),
          h('span', { class: 'row-sub' }, `${FLARE_WORD[f.kind]} · ${place} · ${when}`),
          h('span', { class: 'news-detail' }, n.detail, ' ', h('em', null, n.fiction), ' ', dataBadge('observed', `${c.name}: ${c.spectralType}, ${c.distanceLightYears.toFixed(1)} ly`)),
        ),
      );
    }),
  );
}
