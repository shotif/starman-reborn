import type { EventKind } from '../content/events/rules.ts';
import { getSystem } from '../data/systems.ts';
import type { SystemId } from '../data/types.ts';
import { minutes, newsAt, type NewsItem, type WorldEvent } from '../economy/events.ts';
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
  return n.active ? `for ${minutes(clock - e.start)} min, about ${minutes(e.end - clock)} min to go` : `over ${minutes(clock - e.end)} min ago`;
}

function where(n: NewsItem): string {
  return n.jumps === 0 ? 'this system' : `${getSystem(n.event.systemId).displayName}, ${n.jumps} jump${n.jumps > 1 ? 's' : ''}`;
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
        { class: `news-item kind-${n.event.kind}${n.active ? '' : ' over'}`, 'data-testid': `news-${n.event.id}` },
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
