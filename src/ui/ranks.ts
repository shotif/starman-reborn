import type { GameState } from '../app/state.ts';
import { RANK_FICTION, RANK_NOTES } from '../content/ranks/lines.ts';
import { getLocation, getSystem } from '../data/systems.ts';
import { FACTIONS } from '../economy/factions.ts';
import { minutes } from '../economy/events.ts';
import { wakeFriendly } from '../economy/law.ts';
import { heldRank, nextRankNeeds, perkRank, perksOf, RANK_FACTIONS, rankName, rankNews, type RankNote } from '../economy/ranks.ts';
import { dataBadge, showModal } from './components.ts';
import { h } from './dom.ts';
import { glyph } from './glyphs.ts';

/**
 * A promotion's card (docs/PROCGEN.md §32.2): the rank, the little ceremony, what it opens, and the
 * fiction line. Shown at the dock where it was given, after any story there.
 */
export async function showPromotion(note: RankNote): Promise<void> {
  await showModal({
    title: note.title,
    testId: 'rank-dialog',
    body: h(
      'div',
      { class: 'stack rank-card' },
      h('p', { class: 'dialogue-text' }, note.text),
      h('div', { class: 'list-head' }, h('span', null, RANK_NOTES.opens), h('span', null, '')),
      h('ul', { class: 'plain small rank-perks', 'data-testid': 'rank-perks' }, note.perks.map((p) => h('li', null, glyph('jobs'), h('span', null, p)))),
      h('p', { class: 'muted small' }, dataBadge('fictional'), ' ', RANK_FICTION),
    ),
    actions: [{ label: 'Continue', value: 'ok', variant: 'primary', testId: 'rank-continue' }],
    dismissValue: 'ok',
  });
}

/** Promotions told in the News here (docs/PROCGEN.md §32.5). */
export function rankNewsList(state: GameState, locationId: string): HTMLElement | null {
  const items = rankNews(state, locationId);
  if (!items.length) return null;
  return h(
    'ul',
    { class: 'list news-list', 'data-testid': 'rank-news' },
    items.map((n) =>
      h(
        'li',
        { class: 'news-item kind-rank', 'data-testid': `rank-news-${n.faction}` },
        glyph('news'),
        h(
          'span',
          { class: 'news-text' },
          h('span', { class: 'row-name' }, n.headline, ' ', dataBadge('fictional')),
          h('span', { class: 'row-sub' }, state.clock - n.at < 60 ? 'just now' : `${minutes(state.clock - n.at)} min ago`),
          h('span', { class: 'news-detail' }, n.text),
        ),
      ),
    ),
  );
}

/**
 * The journal's ranks (docs/PROCGEN.md §32.5): with each lawful faction, and with the Wake once it
 * trusts the pilot or they hold a rank there: the rank held, what it opens now (or that its perks
 * wait while hunted), and what the next needs, with the pilot's own numbers.
 */
export function ranksRecord(state: GameState): HTMLElement {
  const rows = RANK_FACTIONS.filter((f) => f !== 'hollow-wake' || wakeFriendly(state) || heldRank(state, f) > 0).map((f) => {
    const r = heldRank(state, f);
    const name = rankName(f, r);
    const paused = r > 0 && perkRank(state, f) === 0;
    const next = nextRankNeeds(state, f);
    const rec = state.ranks?.[f];
    return h(
      'li',
      { 'data-testid': `rank-${f}` },
      h('strong', null, FACTIONS[f].name),
      ': ',
      name ?? 'no rank yet',
      rec && name ? h('span', { class: 'muted' }, ` · since ${getLocation(rec.where).name}, ${getSystem(getLocation(rec.where).systemId).displayName}`) : null,
      r > 0 ? h('div', { class: 'small' }, paused ? RANK_NOTES.paused.replace('{faction}', FACTIONS[f].name) : perksOf(f, r).join(' · ')) : null,
      next
        ? h(
            'div',
            { class: 'muted small' },
            `Next, ${next.name}: standing ${next.standing} (you have ${next.have}), and ${next.record}${next.met ? ' (you have it)' : ''}.`,
          )
        : null,
    );
  });
  return h(
    'section',
    { class: 'ranks-record', 'aria-label': 'Ranks', 'data-testid': 'ranks' },
    h('div', { class: 'list-head' }, h('span', null, 'Ranks'), h('span', null, dataBadge('fictional'))),
    h('ul', { class: 'plain small' }, rows),
  );
}
