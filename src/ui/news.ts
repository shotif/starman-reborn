import type { EventKind } from '../content/events/rules.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import type { GameState } from '../app/state.ts';
import { densDownNear } from '../economy/dens.ts';
import type { SystemId } from '../data/types.ts';
import { eventEnd, minutes, newsAt, type NewsItem, type WorldEvent } from '../economy/events.ts';
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
};

export function eventGlyph(e: Pick<WorldEvent, 'kind' | 'goods'>): GlyphName {
  if (e.kind === 'raid') return 'gun';
  if (e.kind === 'sweep') return 'shieldgen';
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
