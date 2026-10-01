import type { EventKind } from '../content/events/rules.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import type { GameState } from '../app/state.ts';
import { borderNews, type FrontPhase } from '../economy/border.ts';
import { densDownNear } from '../economy/dens.ts';
import type { SystemId } from '../data/types.ts';
import { eventEnd, marksNear, minutes, newsAt, type NewsItem, type WorldEvent } from '../economy/events.ts';
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
  if (n.endedEarly) return `${e.kind === 'raid' ? 'broken' : 'relieved'} by a pilot ${minutes(clock - end)} min ago`;
  return n.active ? `for ${minutes(clock - e.start)} min, about ${minutes(e.end - clock)} min to go` : `over ${minutes(clock - end)} min ago`;
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
  if (!news.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'border-news' },
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
        ),
      ),
    ),
  );
}
